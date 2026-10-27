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
	type DrainEvent,
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

// Handoff, child steer and queue change all report as the one `progress` event.
const steered = transition(armed({ noProgressStreak: 3, nextAllowedAt: 999_999 }), { type: "progress" }, 50_000);
assert.equal(steered.state.noProgressStreak, 0);
assert.equal(steered.state.nextAllowedAt, 50_000);

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
assert.equal(fin.state.nudgeCount, 1);
assert.equal(fin.state.noProgressStreak, 1);
assert.equal(fin.state.nextAllowedAt, T + 3 * MIN);

// 6b. FINALIZING is bounded: ignored finalize nudges escalate the cooldown 3/6/12/24
// and the Kth-after pauses (breaker) instead of nudging every 3 minutes forever.
{
	const finObs = { ...baseObs(), pickable: 0, hasClosingSteps: true };
	let fs: DrainState = armed();
	let at = T;
	const finCooldowns: number[] = [];
	for (let i = 1; i <= BREAKER_K; i++) {
		const r = transition(fs, { type: "tick", obs: finObs }, at);
		assert.deepEqual(r.action, { type: "finalizeNudge" }, `finalize nudge ${i}`);
		assert.equal(r.state.nudgeCount, i);
		assert.equal(r.state.noProgressStreak, i);
		finCooldowns.push(r.state.nextAllowedAt - at);
		fs = r.state;
		at = r.state.nextAllowedAt;
	}
	assert.deepEqual(finCooldowns, [3, 6, 12, 24].map((m) => m * MIN));
	const stopped8 = transition(fs, { type: "tick", obs: finObs }, at);
	assert.equal(stopped8.state.phase, "paused");
	assert.equal(stopped8.action.type, "pause");
	// 8 consecutive ignored finalize ticks never produce 8 nudges.
	let nudges = 0;
	let ph: DrainState = armed();
	let t8 = T;
	for (let i = 0; i < 8; i++) {
		const r = transition(ph, { type: "tick", obs: finObs }, t8);
		if (r.action.type === "finalizeNudge") nudges++;
		ph = r.state;
		t8 = Math.max(t8, ph.nextAllowedAt);
	}
	assert.equal(nudges, BREAKER_K);
	assert.equal(ph.phase, "paused");
	// The hard cap also binds finalize nudges.
	const capFin = transition(armed({ nudgeCount: HARD_CAP }), { type: "tick", obs: finObs }, T);
	assert.equal(capFin.state.phase, "paused");
}

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
		// Tick is the only recorder: exactly one count/streak per nudge.
		assert.equal(r.state.nudgeCount, i);
		assert.equal(r.state.noProgressStreak, i);
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

// 11. Tick-path cooldown ladder 3 → 6 → 12 → 24 → 30 → 30 (capped), exactly one count per tick.
let nudgeState: DrainState = armed();
const cooldowns: number[] = [];
for (let i = 1; i <= 6; i++) {
	const at = 200_000 + i * HOUR;
	const r = transition({ ...nudgeState, noProgressStreak: 0 }, { type: "tick", obs: baseObs() }, at);
	assert.deepEqual(r.action, { type: "nudge" });
	assert.equal(r.state.nudgeCount, i);
	cooldowns.push(r.state.nextAllowedAt - at);
	nudgeState = r.state;
}
assert.deepEqual(cooldowns, [3, 6, 12, 24, 30, 30].map((m) => m * MIN));
// Hard cap pauses instead of nudging.
assert.equal(transition(armed({ nudgeCount: HARD_CAP }), { type: "tick", obs: baseObs() }, T).state.phase, "paused");

// 12. Done is terminal: no resurrect from stray events.
const doneState = done.state;
assert.equal(transition(doneState, { type: "resume" }, T + 1).state.phase, "done");
assert.equal(transition(doneState, { type: "abort" }, T + 1).state.phase, "done");

// 13. Transitions never mutate the input state.
const snapshot = armed({ noProgressStreak: 2 });
const before = JSON.stringify(snapshot);
transition(snapshot, { type: "tick", obs: baseObs() }, T);
assert.equal(JSON.stringify(snapshot), before);

// 14. Full event × phase matrix: a phase that does not own an event stays put.
{
	const phases = ["off", "armed", "backoff", "paused", "done", "finalizing"] as const;
	const events: DrainEvent[] = [
		{ type: "arm", queueOk: true, pickable: 3 },
		{ type: "off" },
		{ type: "resume" },
		{ type: "abort" },
		{ type: "tick", obs: { ...baseObs(), lastError: "500 Internal Server Error" } },
		{ type: "tick", obs: baseObs() },
		{ type: "providerError", kind: "transient" },
		{ type: "providerError", kind: "quota" },
		{ type: "providerError", kind: "auth" },
		{ type: "providerError", kind: "unknown" },
		{ type: "probeOk" },
		{ type: "llmStop" },
		{ type: "llmDone" },
		{ type: "progress" },
		{ type: "breaker" },
		{ type: "hardCap" },
	];
	// Phases allowed to act per event; everything else must be a pure no-op.
	const owners: Record<string, readonly string[]> = {
		arm: ["off"],
		off: ["armed", "backoff", "finalizing"],
		resume: ["paused"],
		abort: ["armed", "backoff", "finalizing"],
		tick: ["armed", "finalizing"],
		providerError: ["armed", "backoff", "finalizing"],
		probeOk: ["backoff"],
		llmStop: ["armed", "backoff", "finalizing"],
		llmDone: ["armed", "backoff", "finalizing"],
		progress: ["armed", "backoff", "finalizing"],
		breaker: ["armed", "backoff", "finalizing"],
		hardCap: ["armed", "backoff", "finalizing"],
	};
	let checked = 0;
	for (const phase of phases) {
		for (const ev of events) {
			if (owners[ev.type].includes(phase)) continue;
			const start: DrainState = { ...INITIAL_STATE, phase, pausedReason: phase === "paused" ? "x" : null };
			const before = JSON.stringify(start);
			const r = transition(start, ev, T);
			assert.equal(r.state.phase, phase, `${ev.type} must not move ${phase}`);
			assert.equal(JSON.stringify(r.state), before, `${ev.type} must not change ${phase} state`);
			assert.equal(r.action.type, "wait", `${ev.type} from ${phase} is a no-op`);
			checked++;
		}
	}
	assert.ok(checked > 40);
	// Resume from OFF never arms (arming needs the arm event and its refusal check).
	assert.equal(transition(INITIAL_STATE, { type: "resume" }, T).state.phase, "off");
	// Only resume leaves PAUSED; a late provider error + probe cannot self-resume it.
	const pausedS: DrainState = { ...INITIAL_STATE, phase: "paused", pausedReason: "x" };
	const lateErr = transition(pausedS, { type: "providerError", kind: "transient" }, T).state;
	assert.equal(transition(lateErr, { type: "probeOk" }, T).state.phase, "paused");
	assert.equal(transition(pausedS, { type: "resume" }, T).state.phase, "armed");
	// DONE is terminal for every event, including arm.
	for (const ev of events) assert.equal(transition(done.state, ev, T).state.phase, "done", `done survives ${ev.type}`);
}

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
assert.equal(classifyProviderError("socket hang up after status 500 response"), "transient");
assert.equal(classifyProviderError("request timed out after status 524 (service unavailable)"), "transient");
// Quota is checked first, then auth, then transient.
assert.equal(classifyProviderError("You have hit your usage limit for this model"), "quota");
assert.equal(classifyProviderError("insufficient_quota: you exceeded your current quota"), "quota");
assert.equal(classifyProviderError("Your available balance is too low"), "quota");
assert.equal(classifyProviderError("Billing problem: out of budget; quota exceeded"), "quota");
assert.equal(classifyProviderError("401 Unauthorized: invalid api key"), "auth");
assert.equal(classifyProviderError("403 Forbidden"), "auth");
// Cross-markers: quota/auth win over transient-looking words or numbers.
assert.equal(classifyProviderError("429 insufficient_quota"), "quota");
assert.equal(classifyProviderError("403 Forbidden: network policy blocks"), "auth");
assert.equal(classifyProviderError("Request failed with status 401: network error"), "auth");
// Bare numbers are not HTTP status context.
assert.equal(classifyProviderError("Request failed with status 413: 512 tokens exceeded"), "unknown");
assert.equal(classifyProviderError("512"), "unknown");
assert.equal(classifyProviderError("request id 503 rejected"), "unknown");
// Retryable strings still match.
assert.equal(classifyProviderError("429 Too Many Requests"), "transient");
assert.equal(classifyProviderError("rate limit reached"), "transient");
assert.equal(classifyProviderError("HTTP 503"), "transient");
assert.equal(classifyProviderError("status: 502 Bad Gateway"), "transient");
assert.equal(classifyProviderError("Provider returned error, response code 500"), "transient");
assert.equal(classifyProviderError("Service Unavailable"), "transient");
assert.equal(classifyProviderError("network error"), "transient");
assert.equal(classifyProviderError("The operation timed out"), "transient");
assert.equal(classifyProviderError("Error: timeout of 30000ms exceeded"), "transient");
assert.equal(classifyProviderError("Request failed: unauthorized (no api key)"), "auth");
assert.equal(classifyProviderError("Something went profoundly sideways"), "unknown");
assert.equal(classifyProviderError("model emitted garbage tokens"), "unknown");

// --- Ladders ---------------------------------------------------------------------------------

// Full expected sequence per rung (rungs beyond the top clamp).
assert.deepEqual(
	[0, 1, 2, 3, 4, 5, 6, 7, -1].map((r) => nextLadderDelayMs("transient", r)),
	[1, 2, 5, 10, 20, 30, 30, 30, 1].map((m) => m * MIN),
);
assert.deepEqual(
	[0, 1, 2, 3, 4, 5, -1].map((r) => nextLadderDelayMs("quota", r)),
	[30, 60, 120, 180, 180, 180, 30].map((m) => m * MIN),
);
// Core stays deterministic; the ±20% jitter belongs to the #30 effect layer.
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
