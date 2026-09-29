/**
 * Self-check for pi-idle-compact pure helpers. Run:
 *   node --experimental-strip-types pi-idle-compact/pi-idle-compact.self-check.ts
 */
import assert from "node:assert/strict";
import { BG_ARM_TOOLS, isArmTool, isTerminalBgNotice, readIntEnv, shouldAttemptCompact } from "./index.ts";

// isArmTool: patty background-arming tools only.
for (const tool of ["bash_bg", "agent_bg", "monitor"]) {
	assert.ok(isArmTool(tool), `${tool} must arm`);
}
for (const tool of ["bash", "jobs", "job_decide", "bash_bg_typo"]) {
	assert.ok(!isArmTool(tool), `${tool} must NOT arm`);
}

// Terminal notices: patty job-finished customType (EVENT.jobFinished) and
// timeout path. Non-terminal stream/stall notices must NOT disarm.
assert.ok(isTerminalBgNotice("job-finished"));
assert.ok(isTerminalBgNotice("bg-timeout"));
assert.ok(!isTerminalBgNotice("bg-monitor-event"));
assert.ok(!isTerminalBgNotice("bg-stall"));
assert.ok(!isTerminalBgNotice(undefined));
assert.ok(!isTerminalBgNotice(42));

// Threshold: compact at or above, never below; missing token count never arms.
assert.ok(shouldAttemptCompact(150_000, 150_000));
assert.ok(shouldAttemptCompact(151_234, 150_000));
assert.ok(!shouldAttemptCompact(149_999, 150_000));
assert.ok(!shouldAttemptCompact(undefined, 150_000));

// Env parsing: valid values win, everything else falls back.
const probe = (value: string | undefined) => {
	process.env.PI_IDLE_COMPACT_PROBE = value;
	const out = readIntEnv("PI_IDLE_COMPACT_PROBE", 5000);
	delete process.env.PI_IDLE_COMPACT_PROBE;
	return out;
};
assert.equal(probe("7000"), 7000);
assert.equal(probe(undefined), 5000);
assert.equal(probe(""), 5000);
assert.equal(probe("nonsense"), 5000);
assert.equal(probe("-3"), 5000);
assert.equal(probe("0"), 5000);

// Arm set stays in sync with the documented patty tool names.
assert.deepEqual([...BG_ARM_TOOLS].sort(), ["agent_bg", "bash_bg", "monitor"]);

console.log("pi-idle-compact self-check: OK");
