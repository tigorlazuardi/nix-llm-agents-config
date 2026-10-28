import assert from "node:assert/strict";
import noUntilLoop, { findUntilLoop } from "./index.ts";

// --- Detection: until-loops must be caught.
for (const command of [
	"until grep -q ready log; do sleep 1; done",
	"until grep -q ready log; do sleep 1; done; echo next",
	"echo start; until curl -sf localhost:3000; do sleep 2; done",
	"until false; do :; done",
	"\nuntil [ -f /tmp/x ]; do sleep 1; done",
	"foo & until x; do :; done",
	"! until x; do :; done",
	"(until x; do :; done)",
	"echo 'a' && until x; do :; done",
	"until$(true) x; do :; done",
	"until $(curl -sf localhost:3000); do sleep 1; done",
	"until( ) { :; }",
	"tail -f x | until read line; do :; done",
]) {
	assert.match(findUntilLoop(command) ?? "", /until/, `missed: ${command}`);
}

// --- Detection: not until-loops, must pass.
for (const command of [
	"grep --until=5 file",
	"echo until done",
	"echo 'waiting until ready' # prose in quotes after word",
	"git log --until 2024-01-01",
	"echo $((x)) | grep until= ",
	"sleep 5",
	"while true; do sleep 1; done", // while-loop: different house rule, not gated here
	"jq '.until' f.json",
	"echo \"don't stop until\"",
	"a|b|c",
]) {
	assert.equal(findUntilLoop(command), null, `false positive: ${command}`);
}

// --- Handler: harness the extension, gate only bash/bash_bg.
type ToolCallResult = { block: boolean; reason?: string } | undefined;
type Handler = (event: { toolName: string; input: unknown }) => Promise<ToolCallResult>;
let handler: Handler | undefined;
noUntilLoop({
	on(event: string, h: never) {
		if (event === "tool_call") handler = h as Handler;
	},
} as never);
assert(handler);

const bashCall = (command: string) => handler!({ toolName: "bash", input: { command } });
const bgCall = (command: string) => handler!({ toolName: "bash_bg", input: { command } });

const blocked = await bashCall("until x; do sleep 1; done");
assert.equal(blocked?.block, true);
assert.match(blocked?.reason ?? "", /until/);
assert.match(blocked?.reason ?? "", /background job/);

assert.equal((await bashCall("echo hi"))?.block, undefined);
assert.equal((await bgCall("until x; do :; done"))?.block, true);
assert.equal((await bgCall("echo hi"))?.block, undefined);

// Non-bash tools pass even with until-loop text.
assert.equal(
	(await handler!({ toolName: "monitor", input: { command: "until x; do :; done" } }))?.block,
	undefined,
);
// Missing/malformed input passes (own tool's problem, not this gate).
assert.equal((await handler!({ toolName: "bash", input: {} }))?.block, undefined);
assert.equal((await handler!({ toolName: "bash", input: { command: 42 } }))?.block, undefined);

console.log("no-until-loop self-check passed");
