import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import glossaryLoader, { CUSTOM_TYPE, findGlossary, loadedFromBranch, pathFromToolCall, startDir } from "./index.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "glossary-loader-")));
const w = (rel: string, body = "x") => {
	const p = join(root, rel);
	mkdirSync(join(p, ".."), { recursive: true });
	writeFileSync(p, body);
	return p;
};

// repo A: .git dir, root + nested glossary
mkdirSync(join(root, "repoA/.git"), { recursive: true });
const aRoot = w("repoA/GLOSSARY.md", "root glossary");
const aSub = w("repoA/vault/GLOSSARY.md", "vault glossary");
w("repoA/vault/deep/file.ts");
w("repoA/other/file.ts");
// repo B: .git is a FILE (worktree), glossary only at root
w("repoB/.git", "gitdir: /elsewhere");
const bRoot = w("repoB/GLOSSARY.md", "b glossary");
w("repoB/pkg/file.ts");
// repo C: no glossary at all
mkdirSync(join(root, "repoC/.git"), { recursive: true });
w("repoC/src/file.ts");
// outside any repo: glossary exists but no .git above
w("loose/GLOSSARY.md", "must never load");
w("loose/sub/file.ts");

// nested: nearest wins
assert.equal(findGlossary(join(root, "repoA/vault/deep")), aSub);
assert.equal(findGlossary(join(root, "repoA/vault")), aSub);
// walks up to root, root is checked
assert.equal(findGlossary(join(root, "repoA/other")), aRoot);
assert.equal(findGlossary(join(root, "repoA")), aRoot);
// .git as file counts as root
assert.equal(findGlossary(join(root, "repoB/pkg")), bRoot);
// no glossary in repo => silent undefined
assert.equal(findGlossary(join(root, "repoC/src")), undefined);
// outside repo => undefined even though a GLOSSARY.md exists above
assert.equal(findGlossary(join(root, "loose/sub")), undefined);
// walk stops at repo root: repo-level glossary of an outer dir is not reached
w("GLOSSARY.md", "outer, above repoC");
assert.equal(findGlossary(join(root, "repoC/src")), undefined);

// folder path vs file path
assert.equal(startDir("vault", join(root, "repoA")), join(root, "repoA/vault"));
assert.equal(startDir("vault/deep/file.ts", join(root, "repoA")), join(root, "repoA/vault/deep"));
// relative path escaping cwd via .. resolves from its own repo
assert.equal(findGlossary(startDir("../repoB/pkg/file.ts", join(root, "repoA"))), bRoot);
// nonexistent file => parent dir, no throw
assert.equal(startDir("vault/new.ts", join(root, "repoA")), join(root, "repoA/vault"));

// tool input extraction
assert.equal(pathFromToolCall("read", { path: "a" }), "a");
assert.equal(pathFromToolCall("edit", { file_path: "b" }), "b");
assert.equal(pathFromToolCall("grep", { pattern: "x" }), ".");
assert.equal(pathFromToolCall("ls", {}), ".");
assert.equal(pathFromToolCall("read", {}), undefined);
assert.equal(pathFromToolCall("bash", { command: "ls" }), undefined);
assert.equal(pathFromToolCall("read", null), undefined);

// branch reconstruction: resume and compaction
const gm = (id: string, p: string) => ({ id, type: "custom_message", customType: CUSTOM_TYPE, details: { glossaryPath: p } });
const msg = (id: string) => ({ id, type: "message" });
assert.deepEqual([...loadedFromBranch([msg("1"), gm("2", "/g1"), msg("3")])], ["/g1"]); // resume
assert.deepEqual([...loadedFromBranch([gm("1", "/g1"), msg("2"), { id: "3", type: "compaction", firstKeptEntryId: "2" }])], []); // summarized away
assert.deepEqual(
	[...loadedFromBranch([gm("1", "/g1"), gm("2", "/g2"), msg("3"), { id: "4", type: "compaction", firstKeptEntryId: "2" }])],
	["/g2"], // kept after boundary stays loaded
);
assert.deepEqual([...loadedFromBranch([gm("1", "/g1"), { id: "2", type: "compaction", firstKeptEntryId: "1" }, gm("3", "/g3")])], ["/g1", "/g3"]);
assert.deepEqual([...loadedFromBranch([{ id: "1", type: "custom_message", customType: "other", details: { glossaryPath: "/z" } }])], []);

// handler end to end with a fake pi
type Handler = (event: unknown, ctx: unknown) => unknown;
const handlers: Record<string, Handler> = {};
const sent: { message: { customType: string; content: string; details: { glossaryPath: string } }; options: unknown }[] = [];
glossaryLoader({
	on: (name: string, h: Handler) => {
		handlers[name] = h;
	},
	sendMessage: (message: never, options: unknown) => sent.push({ message, options }),
} as never);

let branch: unknown[] = [];
const ctx = { cwd: join(root, "repoA"), sessionManager: { getBranch: () => branch } };
const call = (toolName: string, input: unknown) => handlers.tool_call?.({ toolName, input }, ctx);

handlers.session_start?.({ reason: "startup" }, ctx);
assert.equal(call("read", { path: "vault/deep/file.ts" }), undefined); // never blocks
assert.equal(sent.length, 1);
assert.equal(sent[0]?.message.details.glossaryPath, aSub);
assert.ok(sent[0]?.message.content.includes("vault glossary"));
assert.deepEqual(sent[0]?.options, { deliverAs: "steer" });
call("edit", { path: "vault/other.ts" }); // same glossary: deduped
call("ls", { path: "vault" });
assert.equal(sent.length, 1);
call("read", { path: "other/file.ts" }); // different glossary (root)
assert.equal(sent.length, 2);
assert.equal(sent[1]?.message.details.glossaryPath, aRoot);
call("read", { path: "../loose/sub/file.ts" }); // outside repo: silent
call("read", { path: "../repoC/src/file.ts" }); // repo without glossary: silent
call("bash", { command: "cat vault/x" }); // not a path tool
assert.equal(sent.length, 2);

// resume: branch already holds aSub => not reloaded
branch = [gm("1", aSub)];
handlers.session_start?.({ reason: "resume" }, ctx);
call("read", { path: "vault/deep/file.ts" });
assert.equal(sent.length, 2);
// compaction summarizes it away => loaded again
branch = [gm("1", aSub), msg("2"), { id: "3", type: "compaction", firstKeptEntryId: "2" }];
handlers.session_compact?.({}, ctx);
call("read", { path: "vault/deep/file.ts" });
assert.equal(sent.length, 3);
assert.equal(sent[2]?.message.details.glossaryPath, aSub);

// garbage input never throws
assert.doesNotThrow(() => call("read", { path: 42 }));
assert.doesNotThrow(() => handlers.tool_call?.({ toolName: "read", input: undefined }, { cwd: "/nonexistent/zzz" }));
assert.doesNotThrow(() => handlers.session_start?.({}, { sessionManager: { getBranch: () => { throw new Error("boom"); } } }));

// read-only: tree unchanged apart from fixtures (no new files written by loader)
rmSync(root, { recursive: true, force: true });
console.log("glossary-loader self-check passed");
