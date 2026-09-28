import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Load `${cwd}/.env` into the process environment at session start, before any
 * MCP server spawns. pi-mcp-adapter interpolates `${VAR}` / `$env:VAR` /
 * `{env:VAR}` from `process.env` at spawn time and passes `process.env` to
 * stdio servers (inheritEnv), so values land in both mcp.json substitution and
 * the server process itself.
 *
 * Real environment always wins: existing variables are never overwritten.
 * Values are never logged or echoed (may contain secrets).
 *
 * ponytail: fixed to simple `KEY=VALUE` lines (optional `export`, single-level
 * quotes, `#` comments); no multi-line values, no variable expansion inside
 * values. Extend when a real .env needs them.
 */

export function parseDotEnv(content: string): Record<string, string> {
	const vars: Record<string, string> = {};
	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
		const eq = withoutExport.indexOf("=");
		if (eq <= 0) continue;
		const key = withoutExport.slice(0, eq).trim();
		let value = withoutExport.slice(eq + 1).trim();
		const quote = value[0];
		if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
			value = value.slice(1, -1);
		}
		if (key) vars[key] = value;
	}
	return vars;
}

/** Load `.env` from `dir` into `env`. Returns the number of variables set. */
export function loadDotEnvInto(env: NodeJS.ProcessEnv, dir: string): number {
	let content: string;
	try {
		content = readFileSync(join(dir, ".env"), "utf8");
	} catch {
		return 0;
	}
	let loaded = 0;
	for (const [key, value] of Object.entries(parseDotEnv(content))) {
		if (env[key] === undefined) {
			env[key] = value;
			loaded++;
		}
	}
	return loaded;
}

export default function (pi: ExtensionAPI) {
	// session_start re-fires (and extensions rebind) on new/resume/fork, so a
	// session that starts in a different cwd picks up that directory's .env.
	pi.on("session_start", (_event, ctx) => {
		loadDotEnvInto(process.env, ctx.cwd);
	});
}
