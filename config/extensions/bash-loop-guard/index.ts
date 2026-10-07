import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Bash AST gate: block bash tool calls whose command can hang forever.
 *
 * Replaces regex-based no-until-loop. Parses each command with the vendored
 * pure-JS @aliou/sh parser (sensitive-guard dependency, see vendor/) and walks
 * the AST, so prose/flags/heredocs that merely contain loop keywords pass.
 *
 * Rules (house rules from AGENTS.md execution kernel):
 *  1. any `until ... do ... done` clause — forbidden, one missed pattern hangs
 *     the turn until timeout;
 *  2. tautological loop (`while true` / `while :` / `while 1` / `for ((;;))`
 *     without condition) with no break/exit/return in the body;
 *  3. sleep-polling while-loop (body has `sleep`, no bound exit, and no
 *     assignment updating a variable that appears in the condition);
 *  4. `tail -f/-F` — unbounded stream follower; live streams belong in the
 *     monitor tool, finite reads use plain tail;
 *  5. `cmd | tail …` — tail buffering a command stream. tail is only for
 *     finite file reads; as a later pipeline stage the stream side could be
 *     a live/infinite source and tail also buffers until stage 1 exits.
 *
 * ponytail: guards `bash` and `bash_bg` only; extends when another tool
 * misbehaves. No command denylist yet — add when a concrete command list
 * exists (AST makes exact-argument matching easy).
 * ponytail: vendored @aliou/sh 0.3.4; bump by regenerating vendor/.
 */

// --- vendored parser (ESM, self-contained) ----------------------------------
// Minimal structural types; the vendored bundle is untyped JS.
type Pos = { offset: number; line: number; col: number };
type Literal = { type: "Literal"; value: string };
type ParamExp = { type: "ParamExp"; short: boolean; param: Literal };
type Word = { parts: Array<{ type: string; value?: string }> };
type Assignment = { type: "Assignment"; name: string };
type SimpleCommand = { type: "SimpleCommand"; words: Word[]; assignments?: Assignment[] };
type WhileClause = { type: "WhileClause"; cond: unknown[]; body: unknown[]; until?: boolean };
type CStyleLoop = { type: "CStyleLoop"; cond?: unknown; body: unknown[] };
// eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents
type LoopNode = WhileClause | CStyleLoop;

type ParseResult = {
	ast: {
		type: "Program";
		body: unknown[];
	};
	errors?: { message: string }[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let parseFn: ((src: string) => ParseResult) | undefined;

async function parseCommand(src: string): Promise<ParseResult> {
	if (parseFn === undefined) {
		parseFn = (await import("./vendor/aliou-sh-0.3.4.mjs")).parse as typeof parseFn;
	}
	return parseFn(src);
}

// --- AST walking ------------------------------------------------------------

const LOOP_TYPES = new Set(["WhileClause", "CStyleLoop", "SelectClause"]);
const BOUND_NAMES = new Set(["break", "exit", "return"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walk(node: unknown, out: any[] = []): any[] {
	if (Array.isArray(node)) {
		for (const n of node) walk(n, out);
		return out;
	}
	if (node && typeof node === "object") {
		out.push(node);
		for (const v of Object.values(node as Record<string, unknown>)) {
			if (v && typeof v === "object") walk(v, out);
		}
	}
	return out;
}

const loopsOf = (node: unknown) => walk(node).filter((n) => LOOP_TYPES.has(n.type)) as LoopNode[];

function wordText(command: SimpleCommand | undefined): string {
	return (command?.words ?? [])
		.map((w) => (w.parts ?? []).filter((p) => p.type === "Literal").map((p) => p.value ?? "").join(""))
		.join(" ");
}

function isSimpleCommand(node: unknown): node is SimpleCommand {
	return (node as SimpleCommand)?.type === "SimpleCommand";
}

/** Literal command name of a SimpleCommand (first word), if any. */
function commandName(command: SimpleCommand | undefined): string | undefined {
	const first = command?.words?.[0]?.parts?.filter((p) => p.type === "Literal").map((p) => p.value ?? "").join("");
	return first === "" ? undefined : first;
}

const isLiteralCommand = (command: unknown, names: Set<string>) =>
	isSimpleCommand(command) && names.has(commandName(command) ?? "");

/** break/exit/return inside loop body = a bound exists. */
function bodyHasBound(body: unknown[]): boolean {
	return walk(body).some(
		(n) =>
			(isLiteralCommand(n, BOUND_NAMES)) ||
			(n?.type === "Assignment" && BOUND_NAMES.has(n.name as string)) === true,
	);
}

/** `cmd | tail …` = tail as a non-first pipeline stage (stream consumer). */
function isPipeTail(ast: unknown[]): boolean {
	return walk(ast).some((node) => {
		if (node?.type !== "Pipeline") return false;
		const stages = node.commands as unknown[];
		return stages.slice(1).some((stage) => isLiteralCommand((stage as { command?: unknown }).command, new Set(["tail"])));
	});
}

/** Does the body assign any of the variables referenced in the condition? */
function condVarsAreAssigned(clause: WhileClause): boolean {
	const condWords = walk(clause.cond)
		.filter((n) => n.type === "ParamExp")
		.map((n) => n.param?.value)
		.filter((v): v is string => typeof v === "string");
	const condVarSet = new Set(condWords);
	if (condVarSet.size === 0) return false; // condition never reads a variable
	return walk(clause.body).some((n) => {
		if (n?.type === "Assignment") return condVarSet.has(n.name as string);
		if (!isSimpleCommand(n)) return false;
		return (n.words ?? []).some((w) => {
			const text = (w.parts ?? []).filter((p) => p.type === "Literal").map((p) => p.value ?? "").join("");
			const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(text);
			return m !== null && condVarSet.has(m[1]);
		});
	});
}

const isTautologicalWhile = (clause: WhileClause) =>
	((clause.cond ?? []).length === 1 && ["true", ":", "1", "0", "/bin/true"].includes(wordText(clause.cond[0].command as SimpleCommand)));

const bodyHasSleep = (body: unknown[]) => walk(body).some((n) => isLiteralCommand(n, new Set(["sleep"])));

const bodyHasTailF = (body: unknown[]) =>
	walk(body).some((n) => {
		if (!isSimpleCommand(n) || commandName(n) !== "tail") return false;
		return (n.words ?? []).some((w) => {
			const text = (w.parts ?? []).filter((p) => p.type === "Literal").map((p) => p.value ?? "").join("");
			return /^-(f|F)$/.test(text) || text === "--follow";
		});
	});

// --- regex until fallback (no-until-loop lineage, for unparseable input) ----
const UNTIL_KEYWORD = /(?:^|[;&|(!'"])[ 	]*until(?=[ 	]|$|[$(])/g;
const UNTIL_CALL = /(?:^|[ 	])until[ 	]*[(]/;

export function findUntilLoop(command: string): string | null {
	for (const pattern of [UNTIL_KEYWORD, UNTIL_CALL]) {
		pattern.lastIndex = 0;
		const match = pattern.exec(command);
		if (match) return match[0].trim();
	}
	return null;
}

// --- detection --------------------------------------------------------------

export interface BashLoopFinding {
	blocked: boolean;
	rule: string | null;
	detail: string | null;
}

const NOT_BLOCKED: BashLoopFinding = { blocked: false, rule: null, detail: null };

/** Pure detector; exported for the self-check. */
export async function inspectCommand(command: string): Promise<BashLoopFinding> {
	let ast: ParseResult;
	try {
		ast = await parseCommand(command);
	} catch {
		// Parser threw entirely (recoverErrors off-path): fall back to the
		// proven until regex, fail open for everything else.
		const snippet = findUntilLoop(command);
		return snippet === null
			? NOT_BLOCKED
			: { blocked: true, rule: "until", detail: snippet };
	}

	for (const loop of loopsOf(ast.ast.body)) {
		const kind = loop.type === "WhileClause" ? (loop.until === true ? "until" : "while") : "cfor";
		const bounded = bodyHasBound(loop.body);

		// 1. until-loops are always forbidden (house rule).
		if (kind === "until") {
			return {
				blocked: true,
				rule: "until",
				detail: `until ${wordText((loop as WhileClause).cond?.[0]?.command as SimpleCommand)}; do ...; done`,
			};
		}

		// 2. Tautological loop without a bound exit.
		const tautology =
			kind === "cfor"
				? (loop as CStyleLoop).cond === undefined
				: isTautologicalWhile(loop as WhileClause);
		if (tautology && !bounded) {
			return {
				blocked: true,
				rule: "tautology",
				detail: kind === "cfor" ? "for ((;;)); do ...; done" : `while ${wordText((loop as WhileClause).cond?.[0]?.command as SimpleCommand)}; do ...; done`,
			};
		}

		// 3. Sleep-polling loop: waits on a condition that an external process
		//    must satisfy, no bound exit, and the condition variable is never
		//    written in the body.
		if (
			kind === "while" &&
			!bounded &&
			bodyHasSleep(loop.body) &&
			!condVarsAreAssigned(loop as WhileClause)
		) {
			return {
				blocked: true,
				rule: "polling",
				detail: `while ${wordText((loop as WhileClause).cond?.[0]?.command as SimpleCommand)}; do ... sleep ...; done`,
			};
		}
	}

	// 2b. tail -f anywhere in the command (incl. inside loops, cond, subshells).
	if (bodyHasTailF([ast.ast.body])) {
		return { blocked: true, rule: "tail-f", detail: "tail -f/-F" };
	}

	// 5. `cmd | tail …` (tail as a later pipeline stage).
	if (isPipeTail([ast.ast.body])) {
		return { blocked: true, rule: "pipe-tail", detail: "cmd | tail" };
	}

	// 4. Unparseable input: regex until fallback only (fail-open for others).
	if ((ast.errors?.length ?? 0) > 0) {
		const snippet = findUntilLoop(command);
		if (snippet !== null) return { blocked: true, rule: "until", detail: snippet };
	}

	// Command-substitution forms the parser recovers but applies as arguments.
	// `until$(true) x; do :; done` and `until $(cmd); do …; done`: regex catch.
	const untilSnippet = findUntilLoop(command);
	if (untilSnippet !== null) return { blocked: true, rule: "until", detail: untilSnippet };

	return NOT_BLOCKED;
}

const BASH_TOOLS = new Set(["bash", "bash_bg"]);

const blockReason = (finding: BashLoopFinding): string => {
	switch (finding.rule) {
		case "until":
			return (
				`Blocked: bash "until" loop (${finding.detail}). House rule forbids until-loops: ` +
				"one missed pattern hangs the turn until timeout. Use a bounded loop " +
				"(fixed counter + break), run the command once with a timeout, or wait " +
				"on a background job's completion instead of polling."
			);
		case "tautology":
			return (
				`Blocked: unbounded bash loop (${finding.detail}) with no break/exit/return. ` +
				"Every loop carries a counter + break; run it under `timeout` instead, " +
				"or wait on a background job's completion."
			);
		case "polling":
			return (
				`Blocked: sleep-polling bash loop (${finding.detail}). One never-met condition ` +
				"hangs the turn until timeout. Add a counter + break, run the wait under " +
				"`timeout`, or wait on the background job's completion exit."
			);
		case "tail-f":
			return (
				"Blocked: `tail -f` (unbounded stream follower). tail is for finite file " +
				"reads; live log streams run in a monitor pane or a background job's " +
				"completion notification."
			);
		case "pipe-tail":
			return (
				"Blocked: `cmd | tail …` — tail buffers its input until the producing " +
				"stage exits, so a live source hangs and output is truncated. tail is " +
				"only for finite file reads (`tail -n 50 f.log`); for command streams " +
				"use grep -m, wc -l, sort -r | head, or capture to a file first."
			);
		default:
			return "Blocked: unbounded bash loop.";
	}
};

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (!BASH_TOOLS.has(event.toolName)) return;
		const command = (event.input as { command?: unknown } | undefined)?.command;
		if (typeof command !== "string") return;

		let finding: BashLoopFinding;
		try {
			finding = await inspectCommand(command);
		} catch (error) {
			// Detector must never take the session down: fail open.
			console.error?.("[bash-loop-guard] inspect failed", error);
			return;
		}
		if (!finding.blocked) return;
		return { block: true, reason: blockReason(finding) };
	});
}
