import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	getAgentDir,
	hasTrustRequiringProjectResources,
	ProjectTrustStore,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { parseMcpJson } from "./parse.ts";

/**
 * Register `${cwd}/.mcp.json` servers with Pi's native MCP via
 * `pi.registerMcpServer`. Pi itself only reads `.pi/mcp.json`.
 *
 * No approval dialog (it would block subagents). The only gate is Pi's project
 * trust. `ctx.isProjectTrusted()` alone is not enough: Pi skips the trust
 * decision when a repo has no `.pi` resources, so a repo shipping only
 * `.mcp.json` reports trusted even if never approved. In that case honour the
 * saved decision and `defaultProjectTrust` ourselves.
 */

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
		const path = join(ctx.cwd, ".mcp.json");
		if (!existsSync(path) || !projectMcpAllowed(ctx.cwd, ctx.isProjectTrusted())) return;
		let content: string;
		try {
			content = readFileSync(path, "utf8");
		} catch {
			return;
		}
		const { servers, warnings } = parseMcpJson(content);
		for (const { name, config } of servers) {
			try {
				// Pi validates the entry; cast because the shape is user JSON.
				pi.registerMcpServer(name, config as Parameters<typeof pi.registerMcpServer>[1]);
			} catch (error) {
				warnings.push(`.mcp.json server "${name}" not registered: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		if (ctx.hasUI) for (const warning of warnings) ctx.ui.notify(`project-mcp-json: ${warning}`, "warning");
	});
}
