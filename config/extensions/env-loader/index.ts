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
 * Real environment always wins: pre-existing variables are never overwritten.
 * Keys the loader set itself are refreshed on /reload and removed when deleted.
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

/**
 * Load `.env` from `dir` into `env`. Returns the number of variables set.
 *
 * `owned` tracks keys this loader set earlier. Owned keys are refreshed on
 * reload and removed when gone from `.env`; keys from the real environment
 * (not in `owned`) are never touched.
 */
export function loadDotEnvInto(env: NodeJS.ProcessEnv, dir: string, owned: Set<string> = new Set()): number {
	let content = "";
	try {
		content = readFileSync(join(dir, ".env"), "utf8");
	} catch {
		// missing .env: treated as empty so stale owned keys get cleaned up
	}
	const vars = parseDotEnv(content);
	for (const key of [...owned]) {
		if (!(key in vars)) {
			delete env[key];
			owned.delete(key);
		}
	}
	let loaded = 0;
	for (const [key, value] of Object.entries(vars)) {
		if (env[key] === undefined || owned.has(key)) {
			env[key] = value;
			owned.add(key);
			loaded++;
		}
	}
	return loaded;
}

// globalThis, not module state: /reload re-imports this module, and the set
// must survive so the new runtime knows which keys it may overwrite.
const OWNED = Symbol.for("env-loader.owned");
const ownedKeys = (): Set<string> => ((globalThis as any)[OWNED] ??= new Set<string>());

export default function (pi: ExtensionAPI) {
	// session_start re-fires (and extensions rebind) on new/resume/fork, so a
	// session that starts in a different cwd picks up that directory's .env.
	pi.on("session_start", (_event, ctx) => {
		loadDotEnvInto(process.env, ctx.cwd, ownedKeys());
	});
}
