import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * glossary-loader: harness-side loading of the nearest `GLOSSARY.md`.
 *
 * Design (see README.md next to this file):
 * - Hook: `tool_call`. The touched path is only known when a tool is called, so
 *   a system-prompt hook cannot work (and would also bust the prompt cache).
 *   The handler never blocks, never mutates tool input, and never throws.
 * - Delivery: `pi.sendMessage({ customType: "glossary" }, { deliverAs: "steer" })`.
 *   A separate custom message, so tool output (and pix-* hash anchors) stays
 *   untouched. While streaming it is queued and appended after the tool batch,
 *   before the next model request.
 * - Lookup: start at the path's folder (the path itself if it is a folder), walk
 *   up, stop after checking the folder that contains `.git` (file or dir, so git
 *   worktrees work). Nearest GLOSSARY.md wins. No `.git` above the path => treated
 *   as "no glossary" (never search outside a repo). Failure is always silent.
 * - Dedup: key = absolute GLOSSARY.md path. State is rebuilt from the session
 *   branch on session_start / session_compact, so resume, fork and tree stay
 *   correct and a glossary summarized away by compaction is loaded again.
 * - Read-only: only `readFileSync` on GLOSSARY.md. Nothing is ever written.
 *
 * ponytail: fixed to built-in file/dir tool inputs (`path`, `file_path`);
 * bash commands are not parsed. Dedup is by path, not content: a GLOSSARY.md
 * edited mid-session is not reloaded. File size capped at 64 KiB; make
 * configurable when a real glossary needs more.
 */

const GLOSSARY_NAME = "GLOSSARY.md";
export const CUSTOM_TYPE = "glossary";
const MAX_BYTES = 64 * 1024;
const PATH_TOOLS = new Set(["read", "edit", "write", "ls", "find", "grep"]);
// These tools default to cwd when `path` is omitted.
const CWD_DEFAULT_TOOLS = new Set(["ls", "find", "grep"]);

function isDir(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function isFile(p: string): boolean {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
}

/** Folder to start the walk from: the path itself if a folder, else its parent. */
export function startDir(pathArg: string, cwd: string): string {
	const abs = resolve(cwd, pathArg);
	return isDir(abs) ? abs : dirname(abs);
}

/**
 * Nearest GLOSSARY.md at or above `start`, bounded by the repo root (the folder
 * containing `.git`, which is itself checked). Returns undefined when none is
 * found or when `start` is not inside a repo.
 */
export function findGlossary(start: string): string | undefined {
	let dir = start;
	let nearest: string | undefined;
	for (;;) {
		const candidate = join(dir, GLOSSARY_NAME);
		if (nearest === undefined && isFile(candidate)) nearest = candidate; // nearest wins
		if (existsSync(join(dir, ".git"))) return nearest; // repo root checked: stop (.git may be a file)
		const parent = dirname(dir);
		if (parent === dir) return undefined; // hit filesystem root without .git: outside a repo
		dir = parent;
	}
}

/** Path a tool call touches, or undefined if the call is not a path tool. */
export function pathFromToolCall(toolName: string, input: unknown): string | undefined {
	if (!PATH_TOOLS.has(toolName) || typeof input !== "object" || input === null) return undefined;
	const rec = input as Record<string, unknown>;
	const p = rec.path ?? rec.file_path;
	if (typeof p === "string" && p.length > 0) return p;
	return CWD_DEFAULT_TOOLS.has(toolName) ? "." : undefined;
}

interface BranchEntry {
	id?: string;
	type?: string;
	customType?: string;
	details?: unknown;
	firstKeptEntryId?: string;
}

/**
 * Glossary paths still present in model context for this branch. Entries
 * before the last compaction's kept boundary were summarized away, so they do
 * not count and get loaded again on next touch.
 */
export function loadedFromBranch(branch: readonly BranchEntry[]): Set<string> {
	let lastCompaction = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		if (branch[i]?.type === "compaction") {
			lastCompaction = i;
			break;
		}
	}
	let from = 0;
	if (lastCompaction >= 0) {
		const keptId = branch[lastCompaction]?.firstKeptEntryId;
		const keptIdx = keptId ? branch.findIndex((e) => e.id === keptId) : -1;
		from = keptIdx >= 0 && keptIdx < lastCompaction ? keptIdx : lastCompaction + 1;
	}
	const loaded = new Set<string>();
	for (const e of branch.slice(from)) {
		if (e.type !== "custom_message" || e.customType !== CUSTOM_TYPE) continue;
		const p = (e.details as { glossaryPath?: unknown } | undefined)?.glossaryPath;
		if (typeof p === "string") loaded.add(p);
	}
	return loaded;
}

function readGlossary(path: string): string | undefined {
	try {
		if (statSync(path).size > MAX_BYTES) return undefined;
		const text = readFileSync(path, "utf8");
		return text.trim() ? text : undefined;
	} catch {
		return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	let loaded = new Set<string>();

	const rebuild = (ctx: { sessionManager: { getBranch(): unknown[] } }) => {
		try {
			loaded = loadedFromBranch(ctx.sessionManager.getBranch() as BranchEntry[]);
		} catch {
			loaded = new Set();
		}
	};

	pi.on("session_start", (_event, ctx) => rebuild(ctx));
	pi.on("session_compact", (_event, ctx) => rebuild(ctx));

	pi.on("tool_call", (event, ctx) => {
		try {
			const pathArg = pathFromToolCall(event.toolName, event.input);
			if (pathArg === undefined) return;
			const glossary = findGlossary(startDir(pathArg, ctx.cwd));
			if (glossary === undefined || loaded.has(glossary)) return;
			const text = readGlossary(glossary);
			if (text === undefined) return;
			loaded.add(glossary); // mark before delivery: parallel tool calls must not double-load
			pi.sendMessage(
				{
					customType: CUSTOM_TYPE,
					content: `Glossary for the area you are working in (${glossary}), loaded automatically by the harness:\n\n${text}`,
					display: false,
					details: { glossaryPath: glossary },
				},
				{ deliverAs: "steer" },
			);
		} catch {
			// Silent by contract: a missing or unreadable glossary must never surface.
		}
		return undefined; // never block
	});
}
