/**
 * Self-check for the drain-watchdog pure core. Run:
 *   node --experimental-strip-types drain-watchdog/drain-watchdog.self-check.ts
 *
 * Asserts every acceptance criterion of issue #29:
 * state transitions (incl. Esc-always-wins and child no-op), queue output
 * parsing (valid/0/garbage/non-zero — never "done"), provider error
 * classification, backoff ladder sequences, the SPLIT predicate, and the arm
 * refusal condition.
 */
import assert from "node:assert/strict";
import {
	BREAKER_K,
	HARD_CAP,
	INITIAL_STATE,
	QUOTA_OUTAGE_BUDGET_MS,
	SPEC_REVIEW_BUDGET_MS,
	STALL_LIMIT_MS,
	STANDARDS_REVIEW_BUDGET_MS,
	SPLIT_DEPTH_CAP,
	TRANSIENT_OUTAGE_BUDGET_MS,
	armRefusal,
	classifyProviderError,
	isChildSession,
	nextLadderDelayMs,
	parseQueueOutput,
	shouldSplit,
	transition,
	type DrainState,
	type TickObservation,
} from "./index.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;

const armed = (tweaks: Partial<DrainState> = {}): DrainState => ({
	...INITIAL_STATE,
	phase: "armed",
	...tweaks,
});

// tick observation helper — a quiesced session with work available.
const baseObs = (): TickObservation => ({
	running: false,
	pendingMessages: false,
	childCount: 0,
	allIdleForMs: 10 * MIN,
	queueOk: true,
	pickable: 2,
	inflight: 0,
	progressAgeMs: 0,
	lastError: null,
	leftoverBlocked: false,
	hasClosingSteps: false,
});

// --- Transition: arming --------------------------------------------------------

const armOK = transition(INITIAL_STATE, { type: "arm", queueOk: true, pickable: 3 }, 1000);
assert.equal(armOK.state.phase, "armed");
assert.equal(armOK.refusal, null);
assert.equal(armOK.state.nudgeCount, 0);
assert.equal(armOK.state.noProgressStreak, 0);

// Arm refusal: pickable 0 and failed queue command both refuse; refusal never arms.
assert.equal(armRefusal(0, true), "no pickable work (pickable = 0); refusing to arm");
assert.equal(armRefusal(0, false), "drain-queue command failed; refusing to arm");
assert.equal(armRefusal(7, true), null);
const refusedZero = transition(INITIAL_STATE, { type: "arm", queueOk: true, pickable: 0 }, 1000);
assert.equal(refusedZero.state.phase, "off");
assert.ok(refusedZero.refusal !== null);
const refusedFail = transition(INITIAL_STATE, { type: "arm", queueOk: false, pickable: 5 }, 1000);
assert.equal(refusedFail.state.phase, "off");
assert.ok(refusedFail.refusal !== null);

// --- Transition: off / resume ---------------------------------------------------

assert.equal(transition(armOK.state, { type: "off" }, 2000).state.phase, "off");

const pausedStuck: DrainState = {
	...armed(),
	phase: "paused",
	pausedReason: "x",
	noProgressStreak: BREAKER_K,
};
const resumed = transition(pausedStuck, { type: "resume" }, 3000);
assert.equal(resumed.state.phase, "armed");
assert.equal(resumed.state.noProgressStreak, 0);
// Resume outside paused is a no-op.
assert.equal(transition(armOK.state, { type: "resume" }, 4000).state.phase, "armed");

// --- Transition: Esc/abort always wins --------------------------------------------

for (const phase of ["armed", "backoff", "finalizing"] as const) {
	const s = transition({ ...armed(), phase }, { type: "abort" }, 5000);
	assert.equal(s.state.phase, "paused", `abort must win from ${phase}`);
	assert.equal(s.action.type, "pause");
}
// Abort never auto-resumes: paused stays paused until an explicit resume event.
assert.equal(transition(resumed.state, { type: "abort" }, 6000).state.phase, "paused");
// A paused run never self-resumes: Esc wins, only an explicit resume event continues.
assert.equal(transition(pausedStuck, { type: "tick", obs: baseObs() }, 6000).state.phase, "paused");

// --- Transition: provider errors → backoff ladder ------------------------------------

const backoffIn = transition(armOK.state, { type: "providerError", kind: "transient" }, 8000);
assert.equal(backoffIn.state.phase, "backoff");
assert.equal(backoffIn.state.backoffKind, "transient");
assert.equal(backoffIn.state.backoffRung, 0);
assert.deepEqual(backoffIn.action, { type: "probe", delayMs: 1 * MIN });

// Transient: each later error escalates one rung; rungs clamp at the ladder top.
const transientDelays: number[] = [];
let b = backoffIn.state;
for (let i = 1; i <= 6; i++) {
	const s = transition(b, { type: "providerError", kind: "transient" }, 9000 + i * MIN);
	assert.equal(s.state.phase, "backoff");
	assert.equal(s.state.backoffRung, i);
	transientDelays.push(s.action.type === "probe" ? s.action.delayMs : -1);
	b = s.state;
}
assert.deepEqual(transientDelays, [2, 5, 10, 20, 30, 30].map((m) => m * MIN));

// Quota: rung 0 from armed, then 1 h / 2 h / 3 h, clamped at 3 h.
const quotaIn = transition(armOK.state, { type: "providerError", kind: "quota" }, 12_000);
assert.equal(quotaIn.state.backoffKind, "quota");
assert.deepEqual(quotaIn.action, { type: "probe", delayMs: 30 * MIN });
const quotaDelays: number[] = [];
let q = quotaIn.state;
for (let i = 1; i <= 4; i++) {
	const s = transition(q, { type: "providerError", kind: "quota" }, 12_000 + i * HOUR);
	assert.equal(s.state.phase, "backoff");
	quotaDelays.push(s.action.type === "probe" ? s.action.delayMs : -1);
	q = s.state;
}
assert.deepEqual(quotaDelays, [60, 120, 180, 180].map((m) => m * MIN));

// Outage budgets: 6 h transient, 12 h quota → paused, not nudges forever.
const transOut = transition(
	{ ...armed(), phase: "backoff", backoffKind: "transient", backoffRung: 1, backoffStartMs: 0 },
	{ type: "providerError", kind: "transient" },
	TRANSIENT_OUTAGE_BUDGET_MS + MIN,
);
assert.equal(transOut.state.phase, "paused");
assert.equal(transOut.action.type, "pause");
const quotaOut = transition(
	{ ...armed(), phase: "backoff", backoffKind: "quota", backoffRung: 1, backoffStartMs: 0 },
	{ type: "providerError", kind: "quota" },
	QUOTA_OUTAGE_BUDGET_MS + MIN,
);
assert.equal(quotaOut.state.phase, "paused");
// Inside the budget it stays in backoff and escalates.
const withinBudget = transition(
	{ ...armed(), phase: "backoff", backoffKind: "transient", backoffRung: 1, backoffStartMs: 0 },
	{ type: "providerError", kind: "transient" },
	MIN,
);
assert.equal(withinBudget.state.phase, "backoff");
assert.equal(withinBudget.state.backoffRung, 2);

// Auth pauses immediately; it is never retried.
const authOut = transition(armOK.state, { type: "providerError", kind: "auth" }, 20_000);
assert.equal(authOut.state.phase, "paused");
assert.equal(authOut.action.type, "pause");

// probeOk: one success → ARMED with a reset ladder.
const probed = transition(
	{ ...b, backoffStartMs: 1000 },
	{ type: "probeOk" },
	30_000,
);
assert.equal(probed.state.phase, "armed");
assert.equal(probed.state.backoffKind, null);
assert.equal(probed.state.backoffRung, 0);
assert.equal(probed.state.backoffStartMs, null);

// UNKNOWN rides the transient ladder but counts toward the breaker.
const unknown1 = transition(armOK.state, { type: "providerError", kind: "unknown" }, 31_000);
assert.equal(unknown1.state.phase, "backoff");
assert.equal(unknown1.state.backoffKind, "transient");
assert.equal(unknown1.state.noProgressStreak, 1);
let u = unknown1.state;
for (let i = 2; i < BREAKER_K; i++) {
	u = transition(u, { type: "providerError", kind: "unknown" }, 31_000 + i * MIN).state;
}
const unknownBreak = transition(u, { type: "providerError", kind: "unknown" }, 31_000 + BREAKER_K * MIN);
assert.equal(unknownBreak.state.phase, "paused");
assert.equal(unknownBreak.state.noProgressStreak, BREAKER_K);

// --- Transition: llmStop / llmDone -----------------------------------------------------

const stopped = transition(armOK.state, { type: "llmStop" }, 40_000);
assert.equal(stopped.state.phase, "paused");
assert.equal(stopped.action.type, "pause");

const finisher = transition({ ...armed(), phase: "finalizing" }, { type: "llmDone" }, 41_000);
assert.equal(finisher.state.phase, "done");
assert.equal(transition(armOK.state, { type: "llmDone" }, 42_000).state.phase, "done");

// --- Transition: progress sources reset the streak ---------------------------------------

const steered = transition(armed({ noProgressStreak: 3, nextAllowedAt: 999_999 }), { type: "completionSteer" }, 50_000);
assert.equal(steered.state.noProgressStreak, 0);
assert.equal(steered.state.nextAllowedAt, 50_000);
assert.equal(transition(armed({ noProgressStreak: 3 }), { type: "handoffRecorded" }, 51_000).state.noProgressStreak, 0);
assert.equal(transition(armed({ noProgressStreak: 3 }), { type: "progress" }, 52_000).state.noProgressStreak, 0);

// Breaker and hardCap events pause with a named reason.
assert.equal(transition(armOK.state, { type: "breaker" }, 53_000).state.phase, "paused");
const capped = transition(armed({ nudgeCount: HARD_CAP }), { type: "hardCap" }, 54_000);
assert.equal(capped.state.phase, "paused");

// --- Tick order --------------------------------------------------------------------------

const T = 100_000;

// 1. Running or pending messages → wait, no nudge.
assert.deepEqual(transition(armed(), { type: "tick", obs: { ...baseObs(), running: true } }, T).action, { type: "wait" });
assert.deepEqual(
	transition(armed(), { type: "tick", obs: { ...baseObs(), pendingMessages: true } }, T).action,
	{ type: "wait" },
);

// 2. Idle grace not reached → wait.
assert.deepEqual(transition(armed(), { type: "tick", obs: { ...baseObs(), allIdleForMs: 1 * MIN } }, T).action, {
	type: "wait",
});

// 3. Cooldown active (now < nextAllowedAt) → wait, even with pickable work.
const cooling = transition(armed({ nextAllowedAt: T + MIN }), { type: "tick", obs: baseObs() }, T);
assert.deepEqual(cooling.action, { type: "wait" });

// 4. Queue failure → pause; never "done", never an empty-queue interpretation.
const queueFail = transition(armed(), { type: "tick", obs: { ...baseObs(), queueOk: false } }, T);
assert.equal(queueFail.state.phase, "paused");
assert.equal(queueFail.action.type, "pause");

// 5. Frontier 0 + inflight 0 + children 0 → DONE (report leftovers, do not nudge).
const done = transition(armed(), { type: "tick", obs: { ...baseObs(), pickable: 0 } }, T);
assert.equal(done.state.phase, "done");
assert.deepEqual(done.action, { type: "done", leftovers: false });
const doneLeftover = transition(
	armed(),
	{ type: "tick", obs: { ...baseObs(), pickable: 0, leftoverBlocked: true } },
	T,
);
assert.equal(doneLeftover.state.phase, "done");
assert.deepEqual(doneLeftover.action, { type: "done", leftovers: true });

// 6. FINALIZING: pickable 0 + closing steps → one finalize nudge.
const fin = transition(armed(), { type: "tick", obs: { ...baseObs(), pickable: 0, hasClosingSteps: true } }, T);
assert.equal(fin.state.phase, "finalizing");
assert.deepEqual(fin.action, { type: "finalizeNudge" });
assert.ok(fin.state.nextAllowedAt > T);

// 7. Children running: progress within stall limit → wait; stalled → notify only, never a nudge.
assert.deepEqual(transition(armed(), { type: "tick", obs: { ...baseObs(), childCount: 1 } }, T).action, {
	type: "wait",
});
const stalled = transition(
	armed(),
	{ type: "tick", obs: { ...baseObs(), childCount: 1, progressAgeMs: STALL_LIMIT_MS } },
	T,
);
assert.deepEqual(stalled.action, { type: "stallNotify" });
assert.equal(stalled.state.phase, "armed");

// 8. Children running with frontier 0 is NOT done; in-flight work keeps the run alive.
assert.deepEqual(
	transition(armed(), { type: "tick", obs: { ...baseObs(), pickable: 0, inflight: 1, childCount: 1 } }, T)
		.action,
	{ type: "wait" },
);

// 9. Provider error on the last run → backoff path, not a plain nudge.
const tickBackoff = transition(armed(), { type: "tick", obs: { ...baseObs(), lastError: "500 Internal Server Error" } }, T);
assert.equal(tickBackoff.state.phase, "backoff");
assert.deepEqual(tickBackoff.action, { type: "probe", delayMs: 1 * MIN });

// 10. Breaker: BREAKER_K consecutive no-progress nudges, then pause — not nudges forever.
let s: DrainState = armed();
for (let i = 1; i <= BREAKER_K + 1; i++) {
	const r = transition(s, { type: "tick", obs: baseObs() }, T + i * HOUR);
	if (i <= BREAKER_K) {
		assert.deepEqual(r.action, { type: "nudge" }, `nudge ${i} fires before the breaker`);
		s = r.state;
	} else {
		// The tick AFTER the Kth unanswered nudge pauses instead of nudging again.
		assert.equal(r.state.phase, "paused");
		assert.equal(r.action.type, "pause");
	}
}
// Progress (queue change reported by the effect layer) unsticks the breaker.
const unstuck = transition(s, { type: "progress" }, T + 10 * HOUR);
assert.equal(unstuck.state.phase, "armed");
assert.equal(unstuck.state.noProgressStreak, 0);

// 11. Nudge event raises the cooldown ladder 3 → 6 → 12 → 24 → 30 (capped).
let nudgeState: DrainState = armed();
const cooldowns: number[] = [];
for (let i = 1; i <= 6; i++) {
	const at = 200_000 + i * MIN;
	const r = transition(nudgeState, { type: "nudge" }, at);
	cooldowns.push(r.state.nextAllowedAt - at);
	nudgeState = r.state;
}
assert.deepEqual(cooldowns, [3, 6, 12, 24, 30, 30].map((m) => m * MIN));

// 12. Done is terminal: no resurrect from stray events.
const doneState = done.state;
assert.equal(transition(doneState, { type: "resume" }, T + 1).state.phase, "done");
assert.equal(transition(doneState, { type: "abort" }, T + 1).state.phase, "done");

// 13. Transitions never mutate the input state.
const snapshot = armed({ noProgressStreak: 2 });
const before = JSON.stringify(snapshot);
transition(snapshot, { type: "tick", obs: baseObs() }, T);
assert.equal(JSON.stringify(snapshot), before);

// --- parseQueueOutput ---------------------------------------------------------------------

assert.deepEqual(parseQueueOutput("3\n", 0), { ok: true, count: 3 });
assert.deepEqual(parseQueueOutput("0", 0), { ok: true, count: 0 });
assert.deepEqual(parseQueueOutput("  12 \n", 0), { ok: true, count: 12 });

// Refusal rule (docs/agents/issue-tracker.md): non-zero exit, empty, or garbage output
// refuses — it is never "done" or an empty queue.
assert.equal(parseQueueOutput("3\n", 1).ok, false);
assert.equal(parseQueueOutput("", 1).ok, false);
assert.equal(parseQueueOutput("", 0).ok, false);
assert.equal(parseQueueOutput("garbage", 0).ok, false);
assert.equal(parseQueueOutput("3\n4\n", 0).ok, false);
assert.equal(parseQueueOutput("3 4", 0).ok, false);
assert.equal(parseQueueOutput("-1", 0).ok, false);
assert.equal(parseQueueOutput("12.5", 0).ok, false);
assert.equal(parseQueueOutput("3\n", 2).count, null);

// --- classifyProviderError -------------------------------------------------------------------

assert.equal(classifyProviderError("429 Too Many Requests: rate limit exceeded"), "transient");
assert.equal(classifyProviderError("Provider overloaded, high demand right now"), "transient");
assert.equal(classifyProviderError("fetch failed: ENOTFOUND api.example.com (EAI_AGAIN)"), "transient");
assert.equal(classifyProviderError("socket hang up after 500 response"), "transient");
assert.equal(classifyProviderError("request timed out after 524 (service unavailable)"), "transient");
// "usage limit" without transient markers is quota (transient checked first — design order).
assert.equal(classifyProviderError("You have hit your usage limit for this model"), "quota");
assert.equal(classifyProviderError("insufficient_quota: you exceeded your current quota"), "quota");
assert.equal(classifyProviderError("Your available balance is too low"), "quota");
assert.equal(classifyProviderError("Billing problem: out of budget; quota exceeded"), "quota");
assert.equal(classifyProviderError("401 Unauthorized: invalid api key"), "auth");
assert.equal(classifyProviderError("403 Forbidden"), "auth");
assert.equal(classifyProviderError("Request failed: unauthorized (no api key)"), "auth");
assert.equal(classifyProviderError("Something went profoundly sideways"), "unknown");
assert.equal(classifyProviderError("model emitted garbage tokens"), "unknown");

// --- Ladders ---------------------------------------------------------------------------------

const transientSeq: number[] = [];
for (let i = 0; i < 8; i++) transientSeq.push(nextLadderDelayMs("transient", i));
assert.deepEqual(
	transientSeq,
	[1, 2, 5, 10, 20, 30, 30, 30].map((m) => m * MIN),
);
const quotaSeq: number[] = [];
for (let i = 0; i < 6; i++) quotaSeq.push(nextLadderDelayMs("quota", i));
assert.deepEqual(quotaSeq, [30, 60, 120, 180, 180, 180].map((m) => m * MIN));
// Core stays deterministic; the ±20% jitter belongs to the effect layer.
assert.equal(nextLadderDelayMs("transient", 0), nextLadderDelayMs("transient", 0));

// --- SPLIT predicate --------------------------------------------------------------------------

// FAIL after the axis budget splits (10 min standards, 20 min spec).
assert.equal(shouldSplit("standards", "fail", STANDARDS_REVIEW_BUDGET_MS + 1, 0), true);
assert.equal(shouldSplit("spec", "fail", SPEC_REVIEW_BUDGET_MS + 1, 0), true);
// FAIL within budget stays in the fix loop; exactly at budget is not over it.
assert.equal(shouldSplit("standards", "fail", STANDARDS_REVIEW_BUDGET_MS, 0), false);
assert.equal(shouldSplit("spec", "fail", SPEC_REVIEW_BUDGET_MS, 0), false);
assert.equal(shouldSplit("standards", "fail", 5 * MIN, 0), false);
// PASS never splits; a hung review (no verdict) never splits.
assert.equal(shouldSplit("standards", "pass", STANDARDS_REVIEW_BUDGET_MS * 10, 0), false);
assert.equal(shouldSplit("spec", null, SPEC_REVIEW_BUDGET_MS * 10, 0), false);
assert.equal(shouldSplit("spec", undefined, SPEC_REVIEW_BUDGET_MS * 10, 0), false);
// Depth cap: at SPLIT_DEPTH_CAP the caller hands off instead of splitting.
assert.equal(shouldSplit("standards", "fail", STANDARDS_REVIEW_BUDGET_MS + 1, SPLIT_DEPTH_CAP - 1), true);
assert.equal(shouldSplit("standards", "fail", STANDARDS_REVIEW_BUDGET_MS + 1, SPLIT_DEPTH_CAP), false);
assert.equal(shouldSplit("standards", "fail", STANDARDS_REVIEW_BUDGET_MS + 1, SPLIT_DEPTH_CAP + 1), false);

// --- Child sessions ----------------------------------------------------------------------------

assert.equal(isChildSession({ PI_SUBAGENT_ID: "abc" }), true);
assert.equal(isChildSession({ PI_SUBAGENT_ID: "" }), false);
assert.equal(isChildSession({}), false);

console.log("drain-watchdog self-check OK");
