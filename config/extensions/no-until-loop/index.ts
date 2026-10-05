import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Reject every bash tool call whose command contains an `until ... done` loop.
 *
 * House rule (AGENTS.md execution kernel): "Never wait via `until grep ...; do
 * sleep` polling - one missed pattern hangs the turn until timeout." The model
 * keeps writing them, so this gate blocks the call before it runs and tells the
 * model what to do instead.
 *
 * Detection is position-based: `until` must sit in a shell keyword position
 * (line start, after `;` `&` `|` `!` `(` or an open quote, or `until(` function
 * syntax) AND be followed by whitespace/end, so flags like `--until`, values
 * like `until=5`, and prose like `echo until done` pass.
 *
 * ponytail: guards `bash` and `bash_bg` only. Other tools that run shell
 * (monitor, mcp tools) are not gated; extend when one actually misbehaves.
 */

// `until` in shell keyword position: start of line/command, or after a command
// separator, negation, subshell open, or opening quote.
const UNTIL_KEYWORD = /(?:^|[;&|(!'"])\s*until(?=\s|$)/gm;
// `until(` conditional-function syntax.
const UNTIL_CALL = /(?:^|\s)until\s*\(/m;
// `until $(...)` command-substitution condition.
const UNTIL_SUBST = /(?:^|[;&|(!'"\ ])?\s*until\s*\$\(/m;

/** Return the matched snippet if `command` contains an until-loop, else null. */
export function findUntilLoop(command: string): string | null {
	for (const pattern of [UNTIL_KEYWORD, UNTIL_CALL, UNTIL_SUBST]) {
		pattern.lastIndex = 0;
		const match = pattern.exec(command);
		if (match) return match[0].trim();
	}
	return null;
}

const BASH_TOOLS = new Set(["bash", "bash_bg"]);

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (!BASH_TOOLS.has(event.toolName)) return;
		const command = (event.input as { command?: unknown } | undefined)?.command;
		if (typeof command !== "string") return;
		const snippet = findUntilLoop(command);
		if (snippet === null) return;
		return {
			block: true,
			reason:
				`Blocked: bash "until" loop (${snippet}). House rule forbids until-loops: ` +
				"one missed pattern hangs the turn until timeout. Use a bounded loop " +
				"(fixed counter + break), run the command once with a timeout, or wait " +
				"on a background job's completion instead of polling.",
		};
	});
}
