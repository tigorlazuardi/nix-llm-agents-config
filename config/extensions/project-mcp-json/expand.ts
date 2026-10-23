import { spawnSync } from "node:child_process";

/**
 * Expand `${VAR}`, `${VAR:-default}` and `!(shell command)` inside `.mcp.json`
 * server fields. Pure apart from `runShell`; no Pi imports.
 *
 * Two modes, because Pi expands `env`/`headers` values itself at connect time
 * (`$VAR`, `${VAR}`, whole-value `!cmd`, `$$`, `$!`):
 * - plain fields (command, args, url, cwd): Pi expands nothing, so handle all forms.
 * - native fields (env, headers): only handle `${VAR:-default}` and `!(...)`,
 *   which Pi lacks, and escape substituted text so Pi does not expand it again.
 *
 * Errors never include variable values or command output (may be secrets).
 *
 * ponytail: command is `sh -c`, 10s timeout, parens must balance (no quote
 * awareness), no nesting of `${...}`; make configurable when a real file needs it.
 */

export interface ExpandOptions {
	env: Record<string, string | undefined>;
	run: (command: string) => string | undefined;
	native: boolean;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function runShell(command: string, cwd: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
	const result = spawnSync("sh", ["-c", command], {
		encoding: "utf8",
		timeout: 10_000,
		stdio: ["ignore", "pipe", "ignore"],
		cwd,
		env,
	});
	if (result.error || result.status !== 0) return undefined;
	return result.stdout.trim() || undefined;
}

function matchingParen(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === "(") depth++;
		else if (text[i] === ")" && --depth === 0) return i;
	}
	return -1;
}

export function expandString(input: string, options: ExpandOptions): string {
	const pieces: Array<{ text: string; substituted: boolean }> = [];
	const literal = (text: string) => text && pieces.push({ text, substituted: false });
	let index = 0;
	while (index < input.length) {
		const dollar = input.indexOf("$", index);
		const bang = input.indexOf("!(", index);
		const next = [dollar, bang].filter((position) => position >= 0).sort((a, b) => a - b)[0];
		if (next === undefined) {
			literal(input.slice(index));
			break;
		}
		literal(input.slice(index, next));
		if (input.startsWith("$$", next)) {
			// Pi unescapes `$$` itself in native fields; elsewhere emit one `$`.
			literal(options.native ? "$$" : "$");
			index = next + 2;
		} else if (input.startsWith("$!(", next)) {
			// Escaped literal. In native fields keep the `$!` so Pi does not run it as a command.
			literal(options.native ? "$!(" : "!(");
			index = next + 3;
		} else if (input.startsWith("!(", next)) {
			const close = matchingParen(input, next + 1);
			if (close < 0) {
				literal("!(");
				index = next + 2;
				continue;
			}
			const value = options.run(input.slice(next + 2, close));
			if (value === undefined) throw new Error("shell command failed or printed nothing");
			pieces.push({ text: value, substituted: true });
			index = close + 1;
		} else if (input[next + 1] === "{") {
			const close = input.indexOf("}", next + 2);
			const body = close < 0 ? "" : input.slice(next + 2, close);
			const split = body.indexOf(":-");
			const name = split < 0 ? body : body.slice(0, split);
			const fallback = split < 0 ? undefined : body.slice(split + 2);
			if (close < 0 || !NAME.test(name) || (options.native && fallback === undefined)) {
				// Not ours: invalid name, or Pi expands plain ${VAR} in native fields.
				literal("$");
				index = next + 1;
				continue;
			}
			const value = options.env[name] || fallback;
			if (value === undefined) throw new Error(`variable ${name} is not set`);
			pieces.push({ text: value, substituted: true });
			index = close + 1;
		} else {
			literal("$");
			index = next + 1;
		}
	}
	if (options.native) {
		for (const piece of pieces) if (piece.substituted) piece.text = piece.text.replaceAll("$", () => "$$");
		const first = pieces[0];
		if (first?.substituted && first.text.startsWith("!")) first.text = `$${first.text}`;
	}
	return pieces.map((piece) => piece.text).join("");
}

type Json = Record<string, unknown>;

function expandMap(value: unknown, field: string, options: ExpandOptions): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const out: Json = {};
	for (const [key, entry] of Object.entries(value as Json)) {
		out[key] = typeof entry === "string" ? expandField(entry, `${field}.${key}`, options) : entry;
	}
	return out;
}

function expandField(value: string, field: string, options: ExpandOptions): string {
	try {
		return expandString(value, options);
	} catch (error) {
		throw new Error(`${field}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Returns a copy of `config` with all string fields expanded; throws `field: reason`. */
export function expandServer(config: Json, base: Omit<ExpandOptions, "native">): Json {
	const plain: ExpandOptions = { ...base, native: false };
	const native: ExpandOptions = { ...base, native: true };
	const out: Json = { ...config };
	for (const key of ["command", "cwd", "url"]) {
		if (typeof out[key] === "string") out[key] = expandField(out[key] as string, key, plain);
	}
	if (Array.isArray(out.args)) {
		out.args = out.args.map((arg, i) => (typeof arg === "string" ? expandField(arg, `args[${i}]`, plain) : arg));
	}
	if ("env" in out) out.env = expandMap(out.env, "env", native);
	if ("headers" in out) out.headers = expandMap(out.headers, "headers", native);
	return out;
}
