import assert from "node:assert/strict";
import bashLoopGuard, { findUntilLoop, inspectCommand } from "./index.ts";

// --- until-loops are always blocked (rule 1) --------------------------------
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
	const finding = await inspectCommand(command);
	assert.equal(finding.blocked, true, `missed: ${command}`);
	assert.equal(finding.rule, "until", `wrong rule for: ${command}`);
}

// --- tautological loops without a bound (rule 2) ----------------------------
for (const command of [
	"while true; do sleep 60; done",
	"while :; do :; done",
	"while 1; do echo spin; done",
	"for ((;;)); do :; done",
	"(while true; do :; done)",
	"x=$(while :; do :; done)",
]) {
	const finding = await inspectCommand(command);
	assert.equal(finding.blocked, true, `missed: ${command}`);
	assert.equal(finding.rule, "tautology", `wrong rule for: ${command}`);
}

// --- tautological loops WITH a bound exit pass ------------------------------
for (const command of [
	"while :; do line=$(read); [ -z \"$line\" ] && break; done",
	"while true; do sleep 1; if [ -f f ]; then exit 0; fi; done",
]) {
	assert.equal((await inspectCommand(command)).blocked, false, `false positive: ${command}`);
}

// Tautological echo-only loop: no bound, no sleep → still rule 2.
{
	const finding = await inspectCommand("while true; do echo waiting; done");
	assert.equal(finding.blocked, true);
	assert.equal(finding.rule, "tautology");
}

// --- sleep-polling loops without a bound (rule 3) ---------------------------
for (const command of [
	"while ! grep -q done f.log; do sleep 1; done",
	"i=0; while [ ! -f f ]; do sleep 2; done",
	"cat f | while read x; do sleep 1; done",
	"n=0; while [ ! -f f ]; do n=$((n+1)); sleep 1; done", // counter never read by cond = still unbounded
]) {
	const finding = await inspectCommand(command);
	assert.equal(finding.blocked, true, `missed: ${command}`);
	assert.equal(finding.rule, "polling", `wrong rule for: ${command}`);
}

// --- bounded/counted/finite loops pass --------------------------------------
for (const command of [
	"i=0; while [ $i -lt 10 ]; do i=$((i+1)); sleep 0.1; done", // counter
	"n=0; while [ ! -f f ] && [ $n -lt 60 ]; do n=$((n+1)); sleep 1; done", // counter read in cond
	"while read -r line; do echo x; done < f", // finite input
	"cat f | while read x; do :; done", // finite stream
	"for i in 1 2 3; do sleep 1; done",
	"for ((i=0; i<10; i++)); do sleep 1; done",
	"while :; do line=$(read); [ -z \"$line\" ] && break; done",
	"while true; do sleep 1; if [ -f f ]; then exit 0; fi; done",
	"timeout 30 bash -c 'while :; do sleep 1; done'", // inner quoted; bash -c child
	"sleep 5",
]) {
	assert.equal((await inspectCommand(command)).blocked, false, `false positive: ${command}`);
}

// --- tail -f (rule 4) --------------------------------------------------------
for (const command of [
	"tail -f /var/log/app.log",
	"tail -F a.log",
	"tail -f a.log | grep error",
]) {
	const finding = await inspectCommand(command);
	assert.equal(finding.blocked, true, `missed: ${command}`);
	assert.equal(finding.rule, "tail-f", `wrong rule for: ${command}`);
}

for (const command of ["tail -n 50 f.log", "ls -f", "echo tail", "timeout 60 tail -f a.log"]) {
	assert.equal((await inspectCommand(command)).blocked, false, `false positive: ${command}`);
}

// --- `cmd | tail …` (rule 5): tail after stage 1 = stream buffer -------------
for (const command of [
	"cat f | tail -5",
	"echo a; grep x f | tail -n 2",
	"git log --oneline | tail -20",
	"(ps aux | tail -1)",
	"journalctl -u x | tail -50 --no-pager",
	"echo hi | tail", // tail with no args still a stage-2 consumer
]) {
	const finding = await inspectCommand(command);
	assert.equal(finding.blocked, true, `missed: ${command}`);
	assert.equal(finding.rule, "pipe-tail", `wrong rule for: ${command}`);
}

for (const command of [
	"tail -n 50 f.log", // tail alone = finite read
	"tail -5 f.log | grep x", // tail first stage, file operand
	"grep x f | grep y", // pipes without tail pass
	"echo $(cat f | wc -l)",
]) {
	assert.equal((await inspectCommand(command)).blocked, false, `false positive: ${command}`);
}

// --- prose, flags, heredocs that merely contain loop keywords pass ----------
for (const command of [
	"grep --until=5 file",
	"echo until done",
	"echo 'waiting until ready' # prose in quotes after word",
	"git log --until 2024-01-01",
	"echo $((x)) | grep until= ",
	"jq '.until' f.json",
	"echo \"don't stop until\"",
	"a|b|c",
	"cat <<EOF\nuntil grep x f.log\ndone\nEOF",
]) {
	assert.equal((await inspectCommand(command)).blocked, false, `false positive: ${command}`);
}

// --- regex fallback only: still catches until in garbage input --------------
assert.match(findUntilLoop("until $(curl -sf localhost:3000); do sleep 1; done") ?? "", /until/);
assert.equal(findUntilLoop("sleep 5"), null);

// --- Handler: harness the extension, gate only bash/bash_bg -----------------
type ToolCallResult = { block: boolean; reason?: string } | undefined;
type Handler = (event: { toolName: string; input: unknown }) => Promise<ToolCallResult>;
let handler: Handler | undefined;
bashLoopGuard({
	on(event: string, h: never) {
		if (event === "tool_call") handler = h as Handler;
	},
} as never);
assert(handler);

const bashCall = (command: string) => handler!({ toolName: "bash", input: { command } });
const bgCall = (command: string) => handler!({ toolName: "bash_bg", input: { command } });

const untilBlocked = await bashCall("until grep -q ready log; do sleep 1; done");
assert.equal(untilBlocked?.block, true);
assert.match(untilBlocked?.reason ?? "", /until/);
assert.match(untilBlocked?.reason ?? "", /background job/);

const tautBlocked = await bashCall("while true; do sleep 60; done");
assert.equal(tautBlocked?.block, true);
assert.match(tautBlocked?.reason ?? "", /counter \+ break|background job/);

const pollBlocked = await bashCall("while ! grep -q done f.log; do sleep 1; done");
assert.equal(pollBlocked?.block, true);
assert.match(pollBlocked?.reason ?? "", /sleep-polling|timeout/);

const tailBlocked = await bashCall("tail -f /var/log/app.log");
assert.equal(tailBlocked?.block, true);
assert.match(tailBlocked?.reason ?? "", /monitor|background job/);

const pipeTailBlocked = await bashCall("journalctl -u x | tail -50 --no-pager");
assert.equal(pipeTailBlocked?.block, true);
assert.match(pipeTailBlocked?.reason ?? "", /tail buffered|finite file reads/);

assert.equal((await bashCall("echo hi"))?.block, undefined);
assert.equal((await bashCall("timeout 60 bash -c 'while :; do sleep 1; done'"))?.block, undefined);
assert.equal((await bgCall("while :; do [ -n \"$x\" ] && break; done"))?.block, undefined);
assert.equal((await bgCall("until x; do :; done"))?.block, true);

// Non-bash tools pass even with loop text.
assert.equal(
	(await handler!({ toolName: "monitor", input: { command: "until x; do :; done" } }))?.block,
	undefined,
);
// Missing/malformed input passes (own tool's problem, not this gate).
assert.equal((await handler!({ toolName: "bash", input: {} }))?.block, undefined);
assert.equal((await handler!({ toolName: "bash", input: { command: 42 } }))?.block, undefined);

console.log("bash-loop-guard self-check passed");
