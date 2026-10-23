import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	getAgentDir,
	hasTrustRequiringProjectResources,
	ProjectTrustStore,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { parseDotEnv } from "./dotenv.ts";
import { expandServer, runShell } from "./expand.ts";
import { mergeServers, parseMcpJson } from "./parse.ts";

/**
 * Register `${cwd}/.mcp.json` and `${cwd}/.mcp.local.json` servers with Pi's native MCP via
 * `pi.registerMcpServer`. Pi itself only reads `.pi/mcp.json`.
 * `.mcp.local.json` is the per-machine file (gitignore it); its servers
 * override same-named ones from `.mcp.json`.
 *
 * No approval dialog (it would block subagents). The only gate is Pi's project
 * trust. `ctx.isProjectTrusted()` alone is not enough: Pi skips the trust
 * decision when a repo has no `.pi` resources, so a repo shipping only
 * `.mcp.json` reports trusted even if never approved. In that case honour the
 * saved decision and `defaultProjectTrust` ourselves.
 */

// Order matters: later files override earlier ones.
const FILES = [".mcp.json", ".mcp.local.json"];

function projectMcpAllowed(cwd: string, isProjectTrusted: boolean): boolean {
	if (!isProjectTrusted) return false;
	if (hasTrustRequiringProjectResources(cwd)) return true;
	const saved = new ProjectTrustStore(getAgentDir()).get(cwd);
	if (saved !== null) return saved === true;
	try {
		return SettingsManager.create(cwd, getAgentDir(), { projectTrusted: false }).getDefaultProjectTrust() === "always";
	} catch {
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		const files = FILES.map((name) => join(ctx.cwd, name)).filter((path) => existsSync(path));
		if (files.length === 0 || !projectMcpAllowed(ctx.cwd, ctx.isProjectTrusted())) return;
		// Load `.env` here too: env-loader is a sibling extension and load order
		// between the two is not guaranteed. Real environment always wins.
		try {
			for (const [key, value] of Object.entries(parseDotEnv(readFileSync(join(ctx.cwd, ".env"), "utf8")))) {
				if (process.env[key] === undefined) process.env[key] = value;
			}
		} catch {}
		const warnings: string[] = [];
		const lists: ReturnType<typeof parseMcpJson>["servers"][] = [];
		for (const path of files) {
			let content: string;
			try {
				content = readFileSync(path, "utf8");
			} catch {
				continue;
			}
			const parsed = parseMcpJson(content, basename(path));
			warnings.push(...parsed.warnings);
			lists.push(parsed.servers);
		}
		const servers = mergeServers(...lists);
		const commandCache = new Map<string, string | undefined>();
		const run = (command: string) => {
			if (!commandCache.has(command)) commandCache.set(command, runShell(command, ctx.cwd));
			return commandCache.get(command);
		};
		for (const { name, config } of servers) {
			try {
				const expanded = expandServer(config, { env: process.env, run });
				// Pi validates the entry; cast because the shape is user JSON.
				pi.registerMcpServer(name, expanded as Parameters<typeof pi.registerMcpServer>[1]);
			} catch (error) {
				warnings.push(`server "${name}" not registered: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		if (ctx.hasUI) for (const warning of warnings) ctx.ui.notify(`project-mcp-json: ${warning}`, "warning");
	});
}
