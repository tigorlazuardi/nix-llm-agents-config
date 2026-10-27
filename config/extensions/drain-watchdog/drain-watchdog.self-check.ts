/**
 * Self-check for the drain-watchdog pure core. Run:
 *   node --experimental-strip-types drain-watchdog/drain-watchdog.self-check.ts
 *
 * Asserts every acceptance criterion of issue #29:
 * state transitions (incl. Esc-always-wins and child no-op), queue output
 * parsing (valid/0/garbage/non-zero — never "done"), provider error
 * classification, backoff ladder sequences and jitter bounds, the handoff
 * label mapping, the SPLIT predicate, and the arm refusal condition. Also
 * covers #30's live-loop helpers (env parsing, /watchdog argument grammar,
 * target resolution, queue block extraction, READY/error detection, state
 * restore) and the factory's child-vs-main registration split.
 * Imports index.ts, which imports @earendil-works/pi-ai: run with pi-ai
 * resolvable (checks.nix symlinks it into a node_modules next to the copy).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DrainEvent, DrainState, HandoffKind, TickObservation } from "./index.ts";
import {
	BREAKER_K,
	DEFAULT_TICK_CONFIG,
	HARD_CAP,
	IDLE_GRACE_MS,
	INITIAL_STATE,
	QUOTA_OUTAGE_BUDGET_MS,
	SPEC_REVIEW_BUDGET_MS,
	STALL_LIMIT_MS,
	STANDARDS_REVIEW_BUDGET_MS,
	SPLIT_DEPTH_CAP,
	TRANSIENT_OUTAGE_BUDGET_MS,
	armRefusal,
	classifyProviderError,
	handoffExit,
	isChildSession,
	jitteredDelayMs,
	nextLadderDelayMs,
	parseQueueOutput,
	shouldSplit,
	transition,

	buildNudgeText,
	extractFencedBlock,
	extractIssueNumbers,
	extractLastError,
	isReadyDeclaration,
	isSubagentCompletionNotice,
	isSubagentSpawnTool,
	issueNumberFromBranch,
	messageText,
	parseWatchdogSubcommand,
	pickTarget,
	queueFingerprint,
	readIntEnv,
	restoreDrainState,

// The default export is the #30 factory; imported separately so the named list
// above stays comparable to the core's export list.
} from "./index.ts";
import watchdogExtension from "./index.ts";

const MIN = 60_000;
const pausedStateFor = (): DrainState => ({ ...INITIAL_STATE, phase: "paused", pausedReason: "x" });
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
// off is accepted from PAUSED (a paused run can be switched off) and resets the run.
{
	const offPaused = transition({ ...pausedStateFor(), nudgeCount: 7 }, { type: "off" }, 2001);
	assert.equal(offPaused.state.phase, "off");
	assert.equal(offPaused.state.nudgeCount, 0);
	assert.equal(offPaused.state.pausedReason, null);
}

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
// A probe success is not progress: the no-progress streak survives it, so a stuck run
// still reaches the breaker through a provider blip (3 ignored nudges, blip, probeOk).
{
	const stuck = armed({ noProgressStreak: 3, nudgeCount: 3 });
	const blip = transition(stuck, { type: "providerError", kind: "transient" }, 25_000).state;
	assert.equal(blip.noProgressStreak, 3);
	const back = transition(blip, { type: "probeOk" }, 26_000).state;
	assert.equal(back.phase, "armed");
	assert.equal(back.noProgressStreak, 3);
	// Unknown-error streak increments survive the same way.
	const uBlip = transition(armed({ noProgressStreak: 2 }), { type: "providerError", kind: "unknown" }, 25_000).state;
	assert.equal(transition(uBlip, { type: "probeOk" }, 26_000).state.noProgressStreak, 3);
	// 50 unknown -> probeOk cycles cannot launder the streak: the breaker fires.
	let cyc: DrainState = armed();
	let paused = false;
	for (let i = 0; i < 50 && !paused; i++) {
		cyc = transition(cyc, { type: "providerError", kind: "unknown" }, 30_000 + i).state;
		if (cyc.phase === "paused") paused = true;
		else cyc = transition(cyc, { type: "probeOk" }, 30_000 + i).state;
	}
	assert.ok(paused, "unknown/probeOk cycling reaches the breaker");
}

// Mixed-kind outage: quota after a transient-opened outage switches to the quota ladder
// and the 12 h budget (measured from the outage start); transient/unknown keep the kind.
{
	const t0 = 1_000_000;
	const tr = transition(armOK.state, { type: "providerError", kind: "transient" }, t0);
	assert.equal(tr.state.backoffKind, "transient");
	const up = transition(tr.state, { type: "providerError", kind: "quota" }, t0 + MIN);
	assert.equal(up.state.phase, "backoff");
	assert.equal(up.state.backoffKind, "quota");
	assert.equal(up.state.backoffRung, 0);
	assert.deepEqual(up.action, { type: "probe", delayMs: 30 * MIN });
	assert.equal(up.state.backoffStartMs, t0);
	// Later quota errors climb the quota ladder; the budget is 12 h, not 6 h.
	const q2 = transition(up.state, { type: "providerError", kind: "quota" }, t0 + 7 * HOUR);
	assert.equal(q2.state.phase, "backoff");
	assert.deepEqual(q2.action, { type: "probe", delayMs: 60 * MIN });
	const q3 = transition(q2.state, { type: "providerError", kind: "quota" }, t0 + 12 * HOUR + MIN);
	assert.equal(q3.state.phase, "paused");
	// Opposite order: a transient error inside a quota outage keeps the quota ladder + budget.
	const qFirst = transition(armOK.state, { type: "providerError", kind: "quota" }, t0);
	const tAfter = transition(qFirst.state, { type: "providerError", kind: "transient" }, t0 + HOUR);
	assert.equal(tAfter.state.backoffKind, "quota");
	assert.deepEqual(tAfter.action, { type: "probe", delayMs: 60 * MIN });
	// Unknown inside a quota outage also keeps the quota kind (documented deviation).
	assert.equal(transition(qFirst.state, { type: "providerError", kind: "unknown" }, t0 + HOUR).state.backoffKind, "quota");
}

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
// The model cannot declare victory: llmDone from ARMED/BACKOFF is a no-op (flow.html
// sections 3, 10; #27 story 9). Only FINALIZING accepts it.
{
	const early = transition(armOK.state, { type: "llmDone" }, 42_000);
	assert.equal(early.state.phase, "armed");
	assert.deepEqual(early.state, armOK.state);
	assert.deepEqual(early.action, { type: "wait" });
	const bo = transition(armOK.state, { type: "providerError", kind: "transient" }, 42_001).state;
	assert.equal(transition(bo, { type: "llmDone" }, 42_002).state.phase, "backoff");
	assert.deepEqual(transition(bo, { type: "llmDone" }, 42_002).state, bo);
	assert.equal(finisher.state.pausedReason, null);
}
// FINALIZING accepts the other model/harness events too (positive owners).
{
	const fz: DrainState = { ...armed(), phase: "finalizing", noProgressStreak: 2 };
	assert.equal(transition(fz, { type: "llmStop" }, 43_000).state.phase, "paused");
	assert.equal(transition(fz, { type: "providerError", kind: "transient" }, 43_000).state.phase, "backoff");
	const prog = transition(fz, { type: "progress" }, 43_000);
	assert.equal(prog.state.phase, "finalizing");
	assert.equal(prog.state.noProgressStreak, 0);
	assert.equal(transition(fz, { type: "off" }, 43_000).state.phase, "off");
}

// --- Transition: progress sources reset the streak ---------------------------------------

// Handoff, child steer and queue change all report as the one `progress` event.
const steered = transition(armed({ noProgressStreak: 3, nextAllowedAt: 999_999 }), { type: "progress" }, 50_000);
assert.equal(steered.state.noProgressStreak, 0);
assert.equal(steered.state.nextAllowedAt, 50_000);

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

// M2: idleGraceMs/stallLimitMs used to be decorative — handleTick always read
// its own frozen IDLE_GRACE_MS/STALL_LIMIT_MS constants, so a configured
// (narrower) threshold changed notify/audit text but never the actual gate.
// A custom TickConfig must move both gates for real, in both directions.
assert.equal(
	transition(armed(), { type: "tick", obs: { ...baseObs(), allIdleForMs: 1 * MIN } }, T, { idleGraceMs: 30_000, stallLimitMs: STALL_LIMIT_MS }).action.type,
	"nudge",
	"a shortened idleGraceMs lets a 1m-idle tick nudge instead of waiting out the frozen 3m default",
);
assert.deepEqual(
	transition(armed(), { type: "tick", obs: { ...baseObs(), allIdleForMs: 2 * MIN } }, T, { idleGraceMs: 5 * MIN, stallLimitMs: STALL_LIMIT_MS }).action,
	{ type: "wait" },
	"a widened idleGraceMs still waits past the frozen 3m default",
);
assert.deepEqual(
	transition(armed(), { type: "tick", obs: { ...baseObs(), childCount: 1, progressAgeMs: 5 * MIN } }, T, { idleGraceMs: IDLE_GRACE_MS, stallLimitMs: 2 * MIN }).action,
	{ type: "stallNotify" },
	"a shortened stallLimitMs fires stallNotify well before the frozen 45m default",
);
assert.deepEqual(
	transition(armed(), { type: "tick", obs: { ...baseObs(), childCount: 1, progressAgeMs: 5 * MIN } }, T, DEFAULT_TICK_CONFIG).action,
	{ type: "wait" },
	"the default config still behaves exactly like the frozen pre-M2 constants",
);

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

// 6b. FINALIZING sends exactly ONE closing nudge (design section 10, #34). Idle again with
// closing steps still open pauses visibly: no second nudge, no infinite silent wait.
{
	const finObs = { ...baseObs(), pickable: 0, hasClosingSteps: true };
	const first = transition(armed(), { type: "tick", obs: finObs }, T);
	assert.deepEqual(first.action, { type: "finalizeNudge" });
	assert.equal(first.state.phase, "finalizing");
	// Inside the cooldown it just waits.
	const during = transition(first.state, { type: "tick", obs: finObs }, T + MIN);
	assert.deepEqual(during.action, { type: "wait" });
	assert.equal(during.state.nudgeCount, 1);
	// After the cooldown: pause, never a second finalizeNudge or nudge.
	const after = transition(first.state, { type: "tick", obs: finObs }, first.state.nextAllowedAt);
	assert.equal(after.state.phase, "paused");
	assert.equal(after.action.type, "pause");
	assert.equal(after.state.nudgeCount, 1);
	// Across many idle ticks there is exactly one finalize nudge in total.
	let nudges = 0;
	let ph: DrainState = armed();
	let t8 = T;
	for (let i = 0; i < 8; i++) {
		const r = transition(ph, { type: "tick", obs: finObs }, t8);
		if (r.action.type === "finalizeNudge" || r.action.type === "nudge") nudges++;
		ph = r.state;
		t8 = Math.max(t8, ph.nextAllowedAt);
	}
	assert.equal(nudges, 1);
	assert.equal(ph.phase, "paused");
	// Closing steps done (pickable 0, none left) completes the run from FINALIZING.
	const completes = transition(first.state, { type: "tick", obs: { ...baseObs(), pickable: 0 } }, first.state.nextAllowedAt);
	assert.equal(completes.state.phase, "done");
	// The hard cap still gates the first finalize nudge.
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
assert.equal(stalled.state.lastStallNotifyAt, T, "stallNotify records when it fired");
// M4: a still-stalled run must NOT re-notify (or re-run anything) on every
// following tick; only once another full stall window has elapsed.
const stillStalledSoon = transition(stalled.state, { type: "tick", obs: { ...baseObs(), childCount: 1, progressAgeMs: STALL_LIMIT_MS } }, T + 1000);
assert.deepEqual(stillStalledSoon.action, { type: "wait" }, "no repeat stallNotify inside the cooldown window");
assert.equal(stillStalledSoon.state.lastStallNotifyAt, T, "cooldown timestamp is untouched while it holds");
const stillStalledLater = transition(stalled.state, { type: "tick", obs: { ...baseObs(), childCount: 1, progressAgeMs: STALL_LIMIT_MS } }, T + STALL_LIMIT_MS);
assert.deepEqual(stillStalledLater.action, { type: "stallNotify" }, "a fresh stallNotify fires once the cooldown window elapses");
assert.equal(stillStalledLater.state.lastStallNotifyAt, T + STALL_LIMIT_MS);

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

// 9b. Tick-path auth error pauses immediately (not a probe, not a nudge).
const tickAuth = transition(armed(), { type: "tick", obs: { ...baseObs(), lastError: "401 Unauthorized" } }, T);
assert.equal(tickAuth.state.phase, "paused");
assert.equal(tickAuth.state.pausedReason, "provider auth error; needs human");

// 9c. Tick-path quota error enters the quota ladder, not the transient one.
const tickQuota = transition(armed(), { type: "tick", obs: { ...baseObs(), lastError: "insufficient_quota" } }, T);
assert.equal(tickQuota.state.phase, "backoff");
assert.equal(tickQuota.state.backoffKind, "quota");
assert.deepEqual(tickQuota.action, { type: "probe", delayMs: 30 * MIN });

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
	];
	// Phases allowed to act per event; everything else must be a pure no-op.
	const owners: Record<string, readonly string[]> = {
		arm: ["off"],
		off: ["armed", "backoff", "paused", "finalizing"],
		resume: ["paused"],
		abort: ["armed", "backoff", "finalizing"],
		tick: ["armed", "finalizing"],
		providerError: ["armed", "backoff", "finalizing"],
		probeOk: ["backoff"],
		llmStop: ["armed", "backoff", "finalizing"],
		llmDone: ["finalizing"],
		progress: ["armed", "backoff", "finalizing"],
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
// Runtime-retryable strings (pi-ai isRetryableAssistantError) classify as transient.
for (const m of [
	"Connection error.",
	"503 Service Temporarily Unavailable",
	"terminated",
	"ECONNREFUSED",
	"connect ECONNREFUSED 127.0.0.1:443",
	"Error 429",
	"connection refused",
	"Anthropic stream ended before message_stop",
	"server_busy",
	"model is at capacity",
	"Provider returned error",
]) {
	assert.equal(classifyProviderError(m), "transient", m);
}
// The runtime's own non-retryable quota strings classify as quota, even with a 429.
assert.equal(classifyProviderError("429 GoUsageLimitError"), "quota");
assert.equal(classifyProviderError("FreeUsageLimitError"), "quota");
assert.equal(classifyProviderError("subscription_sharing_usage_limit_exceeded"), "quota");
assert.equal(classifyProviderError("subscription_sharing_workplace_individual_usage_limit_exceeded"), "quota");
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
// Non-retryable, non-quota text stays unknown (runtime regex needs a whole-token 429/5xx).
assert.equal(classifyProviderError("Request failed with status 413: 512 tokens exceeded"), "unknown");
assert.equal(classifyProviderError("512"), "unknown");
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
// Jitter: injected r in [0, 1) keeps the delay within +-20% of the ladder step.
{
	for (const kind of ["transient", "quota"] as const) {
		for (let rung = 0; rung < 6; rung++) {
			const base = nextLadderDelayMs(kind, rung);
			assert.equal(jitteredDelayMs(base, 0), Math.round(base * 0.8), `${kind}[${rung}] r=0`);
			assert.equal(jitteredDelayMs(base, 0.5), base, `${kind}[${rung}] r=0.5`);
			const hi = jitteredDelayMs(base, 0.999999);
			assert.ok(hi <= Math.round(base * 1.2) && hi > base, `${kind}[${rung}] r~1 = ${hi}`);
			for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.999999]) {
				const d = jitteredDelayMs(base, r);
				assert.ok(d >= base * 0.8 - 1 && d <= base * 1.2 + 1, `${kind}[${rung}] r=${r} within +-20%`);
			}
		}
	}
	// Monotonic in r; a bad random source cannot widen the band.
	assert.ok(jitteredDelayMs(MIN, 0.2) < jitteredDelayMs(MIN, 0.8));
	assert.equal(jitteredDelayMs(MIN, -5), jitteredDelayMs(MIN, 0));
	assert.equal(jitteredDelayMs(MIN, 7), jitteredDelayMs(MIN, 1));
	assert.equal(jitteredDelayMs(MIN, Number.NaN), MIN);
}

// --- Handoff exit (flow.html section 5, GitHub tracker) -----------------------------------------

assert.deepEqual(handoffExit("needs-info"), { label: "needs-info" });
assert.deepEqual(handoffExit("human"), { label: "ready-for-human" });
assert.deepEqual(handoffExit("wontfix"), { label: "wontfix" });
// Fail closed: an unknown kind throws; it never yields a label that leaves the ticket queued.
assert.throws(() => handoffExit("ready-for-humans" as HandoffKind));
assert.throws(() => handoffExit("toString" as HandoffKind));

// --- SPLIT predicate --------------------------------------------------------------------------

// FAIL after the axis budget splits (10 min standards, 20 min spec).
assert.equal(shouldSplit("standards", "fail", STANDARDS_REVIEW_BUDGET_MS + 1, 0), "split");
assert.equal(shouldSplit("spec", "fail", SPEC_REVIEW_BUDGET_MS + 1, 0), "split");
// FAIL within budget is the fix loop; exactly at budget is not over it.
assert.equal(shouldSplit("standards", "fail", STANDARDS_REVIEW_BUDGET_MS, 0), "fixLoop");
assert.equal(shouldSplit("spec", "fail", SPEC_REVIEW_BUDGET_MS, 0), "fixLoop");
assert.equal(shouldSplit("standards", "fail", 5 * MIN, 0), "fixLoop");
// Within budget at the depth cap is still the fix loop, not a handoff.
assert.equal(shouldSplit("standards", "fail", 5 * MIN, SPLIT_DEPTH_CAP), "fixLoop");
// PASS never splits; a hung review (no verdict) never splits.
assert.equal(shouldSplit("standards", "pass", STANDARDS_REVIEW_BUDGET_MS * 10, 0), "none");
assert.equal(shouldSplit("spec", null, SPEC_REVIEW_BUDGET_MS * 10, 0), "none");
assert.equal(shouldSplit("spec", undefined, SPEC_REVIEW_BUDGET_MS * 10, 0), "none");
// Depth cap: an over-budget FAIL at SPLIT_DEPTH_CAP hands off (ticket -> ready-for-human).
assert.equal(shouldSplit("standards", "fail", STANDARDS_REVIEW_BUDGET_MS + 1, SPLIT_DEPTH_CAP - 1), "split");
assert.equal(shouldSplit("standards", "fail", STANDARDS_REVIEW_BUDGET_MS + 1, SPLIT_DEPTH_CAP), "handoff");
assert.equal(shouldSplit("standards", "fail", STANDARDS_REVIEW_BUDGET_MS + 1, SPLIT_DEPTH_CAP + 1), "handoff");

// --- Child sessions ----------------------------------------------------------------------------

assert.equal(isChildSession({ PI_SUBAGENT_ID: "abc" }), true);
assert.equal(isChildSession({ PI_SUBAGENT_ID: "" }), false);
assert.equal(isChildSession({}), false);
// NOTE (recorded): the core never branches on child status; the factory test
// below proves the child-session no-op end to end.

// --- Live-loop helpers (#30) --------------------------------------------------

// readIntEnv: fallback wins on missing/garbage/zero.
assert.equal(readIntEnv({ PI_WATCHDOG_TICK_MS: "120000" }, "PI_WATCHDOG_TICK_MS", 60_000), 120_000);
assert.equal(readIntEnv({ PI_WATCHDOG_TICK_MS: "abc" }, "PI_WATCHDOG_TICK_MS", 60_000), 60_000);
assert.equal(readIntEnv({ PI_WATCHDOG_TICK_MS: "0" }, "PI_WATCHDOG_TICK_MS", 60_000), 60_000);
assert.equal(readIntEnv({ PI_WATCHDOG_TICK_MS: "-5" }, "PI_WATCHDOG_TICK_MS", 60_000), 60_000);
assert.equal(readIntEnv({}, "PI_WATCHDOG_TICK_MS", 60_000), 60_000);

// /watchdog argument grammar.
assert.deepEqual(parseWatchdogSubcommand(""), { sub: "prep", ref: null });
assert.deepEqual(parseWatchdogSubcommand("   "), { sub: "prep", ref: null });
assert.deepEqual(parseWatchdogSubcommand("on"), { sub: "prep", ref: null });
assert.deepEqual(parseWatchdogSubcommand("on #30"), { sub: "prep", ref: "#30" });
assert.deepEqual(parseWatchdogSubcommand("#30"), { sub: "prep", ref: "#30" });
assert.deepEqual(parseWatchdogSubcommand("watchdog live loop #30"), { sub: "prep", ref: "watchdog live loop #30" });
assert.deepEqual(parseWatchdogSubcommand("resume"), { sub: "resume", ref: null });
assert.deepEqual(parseWatchdogSubcommand("off"), { sub: "off", ref: null });
assert.deepEqual(parseWatchdogSubcommand("status"), { sub: "status", ref: null });

// Session-context issue mentions are distinct and ascending.
assert.deepEqual(extractIssueNumbers("fix #29 and then close #30, ref #29"), [29, 30]);
assert.deepEqual(extractIssueNumbers("no refs here, q30 x#12abc34"), []);

// Branch fallback: first bare number in the branch name.
assert.equal(issueNumberFromBranch("30-watchdog-live-loop"), 30);
assert.equal(issueNumberFromBranch("issue-30-fix"), 30);
assert.equal(issueNumberFromBranch("main"), null);
assert.equal(issueNumberFromBranch("feature/no-digits"), null);

// Target resolution: never silently choose when ambiguous (flow section 0).
assert.deepEqual(pickTarget("#30", [27, 29]), { status: "resolved", number: 30 });
assert.deepEqual(pickTarget(null, [29]), { status: "resolved", number: 29 });
assert.deepEqual(pickTarget(null, [27, 29, 30]), { status: "ask", candidates: [27, 29, 30] });
assert.deepEqual(pickTarget("#9 #30", [29]), { status: "ask", candidates: [9, 30] });
assert.deepEqual(pickTarget(null, []), { status: "ask" });
assert.deepEqual(pickTarget("no numbers at all", []), { status: "ask" });

// drain-queue/drain-inflight blocks extract from the tracker doc format.
const trackerDoc = [
	"## Drain queue", "prose refusal rule", "```drain-queue", "set -euo pipefail", "echo 3", "```", "```drain-inflight", "echo 1", "```", "```drain-queue-extra", "echo 0", "```", "not a block", ""].join("\n");
assert.equal(extractFencedBlock(trackerDoc, "drain-queue"), "set -euo pipefail\necho 3");
assert.equal(extractFencedBlock(trackerDoc, "drain-inflight"), "echo 1");
assert.equal(extractFencedBlock(trackerDoc, "drain-queue-x"), null, "info string must match exactly");
assert.equal(extractFencedBlock("no blocks at all", "drain-queue"), null);
if (process.env.DRAIN_QUEUE_FIXTURE) {
	// Real repo fixture: checks.nix passes the live docs/agents/issue-tracker.md.
	const doc = readFileSync(process.env.DRAIN_QUEUE_FIXTURE, "utf8");
	const queueBlock = extractFencedBlock(doc, "drain-queue");
	assert(queueBlock !== null, "docs/agents/issue-tracker.md lost its drain-queue block");
	assert(queueBlock.includes("gh"), "drain-queue block must drive gh");
	// drain-inflight is optional by contract; only its presence is checked here.
	assert(extractFencedBlock(doc, "drain-inflight") !== null, "docs/agents/issue-tracker.md lost its drain-inflight block");
}

// Message text extraction and the READY gate.
assert.equal(messageText({ content: [{ type: "text", text: "a" }, { type: "thinking", text: "b" }, { type: "text", text: "c" }] }), "a\nc");
assert.equal(messageText({ content: "READY" }), "READY");
assert.equal(messageText({ content: [{ type: "tool_result" }] }), "");
assert.equal(messageText(null), "");
assert.equal(isReadyDeclaration({ role: "assistant", content: "done.\nREADY\n" }), true);
assert.equal(isReadyDeclaration({ role: "assistant", content: "READY\r\n" }), true);
assert.equal(isReadyDeclaration({ role: "assistant", content: "everything green\n== READY ==\n" }), false, "only a bare final line counts");
assert.equal(isReadyDeclaration({ role: "assistant", content: "READY later" }), false);
assert.equal(isReadyDeclaration({ role: "assistant", content: "" }), false);
// M3: a tool-result (or any non-assistant) message ending in a bare READY line
// is not the model's own readiness proof and must not count.
assert.equal(isReadyDeclaration({ role: "tool", content: "grep output\nREADY\n" }), false, "tool output must not count as readiness");
assert.equal(isReadyDeclaration({ role: "user", content: "READY" }), false, "user message must not count as readiness");
assert.equal(isReadyDeclaration({ content: "READY" }), false, "missing role must not count as readiness");
assert.equal(isReadyDeclaration("READY"), false, "a bare string (no role) must not count as readiness");
assert.equal(isReadyDeclaration(null), false);

// Last failed message of a run end sequence.
assert.equal(extractLastError([{ role: "assistant", stopReason: "toolUse" }, { role: "user", stopReason: "toolUse" }, { role: "assistant", stopReason: "error", errorMessage: "429 Too Many Requests" }]), "429 Too Many Requests");
assert.equal(extractLastError([{ role: "assistant", stopReason: "error", errorMessage: "" }]), "unknown provider error");
assert.equal(extractLastError([{ role: "assistant", stopReason: "error" }]), "unknown provider error");
assert.equal(extractLastError([{ role: "assistant", stopReason: "aborted", errorMessage: "user aborted" }]), null);
assert.equal(extractLastError([]), null);

// pi-herdr-subagents counters.
assert.equal(isSubagentSpawnTool("subagent"), true);
assert.equal(isSubagentSpawnTool("subagent_resume"), true);
assert.equal(isSubagentSpawnTool("subagents_list"), false);
assert.equal(isSubagentSpawnTool("bash"), false);
assert.equal(isSubagentCompletionNotice("subagent_result"), true);
assert.equal(isSubagentCompletionNotice("subagent_status"), false, "mid-run status steers are not completion");
assert.equal(isSubagentCompletionNotice("subagent_ping"), false);
assert.equal(isSubagentCompletionNotice(undefined), false);

// Queue fingerprint / nudge text.
assert.notEqual(queueFingerprint({ pickable: 2, inflight: 0 }), queueFingerprint({ pickable: 3, inflight: 0 }));
assert.notEqual(queueFingerprint({ pickable: 2, inflight: 0 }), queueFingerprint({ pickable: 2, inflight: 1 }));
const nudge = buildNudgeText({ target: 30, pickable: 2 });
assert(nudge.includes("#30"), "nudge names the run target");
assert(nudge.includes("Do not ask the user"), "nudge forbids user questions");
assert(nudge.includes("ready-for-human"), "nudge points at the handoff exit");
assert(buildNudgeText({ target: null, pickable: 1 }).includes("the accepted tickets"));

// Restore: latest valid entry wins, garbage never half-applies.
assert.equal(restoreDrainState([]), null);
assert.equal(restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "bogus" } }]), null);
assert.equal(restoreDrainState([{ type: "custom", customType: "other", data: { phase: "armed" } }]), null);
assert.equal(restoreDrainState([{ type: "message", role: "user" }]), null);
const restoredArmed = { phase: "armed", noProgressStreak: 2, nudgeCount: 5, nextAllowedAt: 123, backoffKind: null, backoffRung: 0, backoffStartMs: null, pausedReason: null };
assert.deepEqual(restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "off" } }, { type: "custom", customType: "drain-watchdog-state", data: restoredArmed }]), { ...INITIAL_STATE, ...restoredArmed }, "latest entry wins");
assert.deepEqual(restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "armed", nudgeCount: "30" } }]), { ...INITIAL_STATE, phase: "armed", nudgeCount: 0 }, "corrupted field types fall back, phase survives");
assert.equal(restoreDrainState([null, "x", { type: "custom", customType: "drain-watchdog-state" }]), null, "entry without data is ignored");
// H4: `typeof value === typeof fallback` broke every nullable field, because
// `typeof null === "object"` never matches a real persisted string/number. A
// restored BACKOFF run must keep its kind/start time (quota ladder, outage
// budget already elapsed), and a restored PAUSED run must keep its reason.
const restoredQuotaBackoff = {
	phase: "backoff",
	backoffKind: "quota",
	backoffRung: 2,
	backoffStartMs: 111_000,
	pausedReason: null,
};
assert.deepEqual(
	restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: restoredQuotaBackoff }]),
	{ ...INITIAL_STATE, ...restoredQuotaBackoff },
	"restored BACKOFF keeps its non-null backoffKind/backoffStartMs",
);
const restoredPaused = { phase: "paused", pausedReason: "provider auth error; needs human" };
assert.deepEqual(
	restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: restoredPaused }]),
	{ ...INITIAL_STATE, ...restoredPaused },
	"restored PAUSED keeps its non-null pausedReason",
);
// A field that explicitly persisted as null (never entered backoff) still restores to null.
assert.deepEqual(
	restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "armed", backoffKind: null, backoffStartMs: null } }]),
	{ ...INITIAL_STATE, phase: "armed" },
	"an explicit null still restores to null",
);
// A wrong-typed nullable field still falls back rather than being trusted.
assert.deepEqual(
	restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "backoff", backoffKind: "bogus" } }]),
	{ ...INITIAL_STATE, phase: "backoff" },
	"an invalid backoffKind enum value still falls back",
);

// --- M5(b): handler-driving harness -----------------------------------------------
// Every self-check row above this line asserts against the pure core only; the ~500
// line effect layer (restore/re-arm, timer wiring, tick composition, queue exec) was
// otherwise exercised by nothing but "the factory registers these listener names"
// (below). Fake the global timer functions and pi.exec/appendEntry/sendMessage to
// drive the real registered handlers end-to-end.
type FakeTimer = { id: number; kind: "interval" | "timeout"; fire: () => unknown; cleared: boolean };

type FakeClock = { advance: (ms: number) => void };

/** Replace the global timer functions (and Date.now) for the duration of `run`; never a real timer fires. */
async function withFakeTimers<T>(
	run: (timers: FakeTimer[], flush: () => Promise<void>, clock: FakeClock) => Promise<T> | T,
): Promise<T> {
	const realSetInterval = globalThis.setInterval;
	const realSetTimeout = globalThis.setTimeout;
	const realClearInterval = globalThis.clearInterval;
	const realClearTimeout = globalThis.clearTimeout;
	const timers: FakeTimer[] = [];
	let nextId = 1;
	(globalThis as any).setInterval = (fn: (...args: unknown[]) => unknown, _delay: number, ...args: unknown[]) => {
		const t: FakeTimer = { id: nextId++, kind: "interval", fire: () => fn(...args), cleared: false };
		timers.push(t);
		return t as any;
	};
	(globalThis as any).setTimeout = (fn: (...args: unknown[]) => unknown, _delay: number, ...args: unknown[]) => {
		const t: FakeTimer = { id: nextId++, kind: "timeout", fire: () => fn(...args), cleared: false };
		timers.push(t);
		return t as any;
	};
	(globalThis as any).clearInterval = (t: unknown) => {
		if (t) (t as FakeTimer).cleared = true;
	};
	(globalThis as any).clearTimeout = (t: unknown) => {
		if (t) (t as FakeTimer).cleared = true;
	};
	// The code under test fires timers via `void tick()` (fire-and-forget): calling
	// `fire()` starts the async work but does not return its promise. `flush` drains
	// pending microtasks via one REAL macrotask tick so `await pi.exec(...)` and
	// everything after it inside `tick` has settled before assertions run.
	// armed()'s idle-grace gate (`now - idleSinceMs < idleGraceMs`) and the stall/cooldown
	// windows all read the real wall clock; a handler-driving test cannot wait 3 real
	// minutes; fake Date.now() too so a test can jump straight past any such gate.
	const realDateNow = Date.now;
	let clockMs = realDateNow();
	Date.now = () => clockMs;
	const clock: FakeClock = { advance: (ms) => { clockMs += ms; } };
	const flush = () => new Promise<void>((resolve) => realSetTimeout(resolve, 0));
	try {
		return await run(timers, flush, clock);
	} finally {
		globalThis.setInterval = realSetInterval;
		globalThis.setTimeout = realSetTimeout;
		globalThis.clearInterval = realClearInterval;
		globalThis.clearTimeout = realClearTimeout;
		Date.now = realDateNow;
	}
}

// The self-check must not trust the ambient environment: it may itself run inside a
// pi-herdr-subagents child (PI_SUBAGENT_ID set), so force the "main session" branch.
async function withNoAmbientSubagent<T>(run: () => Promise<T> | T): Promise<T> {
	const ambient = process.env.PI_SUBAGENT_ID;
	delete process.env.PI_SUBAGENT_ID;
	try {
		return await run();
	} finally {
		if (ambient === undefined) delete process.env.PI_SUBAGENT_ID;
		else process.env.PI_SUBAGENT_ID = ambient;
	}
}

type Harness = {
	handlers: Record<string, (...args: any[]) => unknown>;
	audits: { type: string; data: Record<string, unknown> }[];
	notifications: { message: string; level: string }[];
	sent: { customType: string; content: string }[];
	execCalls: { command: string; args: string[] }[];
	setExec: (impl: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>) => void;
	ctx: any;
};

/** A fresh factory instance wired to capturing mocks, plus a real drain-queue fixture on
 * disk (`pi.exec` is mocked, but `runQueueCommand` reads the markdown file for real). */
function makeHarness(cwd: string): Harness {
	const handlers: Record<string, (...args: any[]) => unknown> = {};
	const audits: { type: string; data: Record<string, unknown> }[] = [];
	const notifications: { message: string; level: string }[] = [];
	const sent: { customType: string; content: string }[] = [];
	let execImpl: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean }> = async () => ({
		stdout: "0\n",
		stderr: "",
		code: 0,
		killed: false,
	});
	const execCalls: { command: string; args: string[] }[] = [];
	const pi = {
		on(name: string, handler: (...args: any[]) => unknown) {
			handlers[name] = handler;
			return () => {};
		},
		registerCommand(name: string, spec: { handler: (...args: any[]) => unknown }) {
			handlers[`command:${name}`] = spec.handler;
		},
		appendEntry(type: string, data: Record<string, unknown>) {
			if (type === "drain-watchdog-audit") audits.push({ type: String(data.event), data });
		},
		sendMessage(msg: { customType: string; content: string }) {
			sent.push({ customType: msg.customType, content: msg.content });
		},
		sendUserMessage() {},
		exec: async (command: string, args: string[]) => {
			execCalls.push({ command, args });
			return execImpl(command, args);
		},
	};
	watchdogExtension(pi as any);
	const ctx: any = {
		hasUI: true,
		cwd,
		ui: { notify: (message: string, level = "info") => notifications.push({ message, level }) },
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager: { getEntries: () => [] },
	};
	return { handlers, audits, notifications, sent, execCalls, setExec: (impl) => { execImpl = impl; }, ctx };
}

// A real drain-queue + drain-inflight fixture on disk at <tmp>/docs/agents/issue-tracker.md.
// A second fenced block is what the res2/dead-code bug above needed to trigger:
// runQueueCommand threw a ReferenceError on every real queue read while
// docs/agents/issue-tracker.md (which carries both blocks) was armed, a regression the
// pure-core self-check rows above could never see.
function makeFixtureCwd(): string {
	const cwd = mkdtempSync(join(tmpdir(), "dw-harness-"));
	mkdirSync(join(cwd, "docs", "agents"), { recursive: true });
	writeFileSync(join(cwd, "docs", "agents", "issue-tracker.md"), "```drain-queue\necho 0\n```\n```drain-inflight\necho 0\n```\n");
	return cwd;
}

const armedEntry = (tweaks: Record<string, unknown> = {}) => ({
	type: "custom",
	customType: "drain-watchdog-state",
	data: { phase: "armed", ...tweaks },
});

// H3 (regression guard): a restored BACKOFF run keeps its probe timer alive. startLoop()
// used to call clearTimers() (tick timer AND probe timer). session_start restores BACKOFF
// by calling scheduleProbe(...) then startLoop() to keep ticks alive for probeOk, and
// startLoop immediately cancelled the probe it had just scheduled, wedging BACKOFF forever.
await withNoAmbientSubagent(() =>
	withFakeTimers((timers) => {
		const h = makeHarness(makeFixtureCwd());
		h.ctx.sessionManager = {
			getEntries: () => [
				{ type: "custom", customType: "drain-watchdog-state", data: { phase: "backoff", backoffKind: "quota", backoffRung: 1, backoffStartMs: 1000 } },
			],
		};
		h.handlers.session_start({}, h.ctx);
		const live = timers.filter((t) => !t.cleared);
		assert.equal(live.filter((t) => t.kind === "interval").length, 1, "restoring BACKOFF starts the tick interval");
		assert.equal(live.filter((t) => t.kind === "timeout").length, 1, "restoring BACKOFF keeps its probe timer alive (H3)");
	}),
);

// M5(b): session_start restoring an ARMED run starts only the tick interval (no probe:
// that is BACKOFF-only), and a tick that observes idle+pickable-work delivers a nudge
// through the real pi.sendMessage/appendEntry surface — including reading the real
// on-disk drain-queue AND drain-inflight blocks (the dead-code `res2` bug above only
// ever showed up on this exact path).
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		h.ctx.sessionManager = { getEntries: () => [armedEntry()] };
		h.handlers.session_start({}, h.ctx);
		const live = timers.filter((t) => !t.cleared);
		assert.equal(live.filter((t) => t.kind === "interval").length, 1, "restoring ARMED starts the tick interval");
		assert.equal(live.filter((t) => t.kind === "timeout").length, 0, "restoring ARMED schedules no probe (BACKOFF-only)");
		h.setExec(async (_cmd, args) => ({ stdout: args[1]?.includes("drain-inflight") ? "1\n" : "2\n", stderr: "", code: 0, killed: false }));
		clock.advance(IDLE_GRACE_MS + 1000); // past the idle-grace gate so the tick actually evaluates
		const tickTimer = timers.find((t) => t.kind === "interval" && !t.cleared)!;
		tickTimer.fire();
		await flush();
		await flush();
		assert.equal(h.sent.length, 1, "an idle armed tick with pickable work delivers exactly one nudge");
		assert.equal(h.sent[0]!.customType, "drain-watchdog-nudge");
		assert(h.audits.some((a) => a.type === "nudge"), "the nudge is audited");
		assert.equal(h.execCalls.length, 2, "both the drain-queue and drain-inflight blocks ran (res2/dead-code regression guard)");
	}),
);

// M5(b): a tick whose queue command fails (exec throws) pauses — fail-closed, never a
// nudge, never DONE — and the pause is both audited and notified with the failure reason.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		h.ctx.sessionManager = { getEntries: () => [armedEntry()] };
		h.handlers.session_start({}, h.ctx);
		h.setExec(async () => {
			throw new Error("boom: drain-queue command threw");
		});
		clock.advance(IDLE_GRACE_MS + 1000); // past the idle-grace gate so the tick actually evaluates
		const tickTimer = timers.find((t) => t.kind === "interval" && !t.cleared)!;
		tickTimer.fire();
		await flush();
		await flush();
		assert.equal(h.sent.length, 0, "a failed queue command never nudges");
		const pauseAudit = h.audits.find((a) => a.type === "paused");
		assert(pauseAudit !== undefined, "a failed queue command is audited as paused, not silently ignored");
		assert(String(pauseAudit!.data.reason).includes("queue"), "the pause reason names the queue failure");
		assert(h.notifications.some((n) => n.message.includes("PAUSED")), "the pause is also surfaced to the UI");
	}),
);

// M1/M5(b): session_shutdown clears every live timer so no pending tick/probe survives
// past teardown.
await withNoAmbientSubagent(() =>
	withFakeTimers((timers) => {
		const h = makeHarness(makeFixtureCwd());
		h.ctx.sessionManager = { getEntries: () => [armedEntry()] };
		h.handlers.session_start({}, h.ctx);
		assert(timers.some((t) => !t.cleared), "sanity: the tick interval is live before shutdown");
		h.handlers.session_shutdown();
		assert(timers.every((t) => t.cleared), "session_shutdown clears every timer");
	}),
);

// L1: `/watchdog resume` goes through `apply` but had no case in its action switch (the
// transition's action is "wait", not a dedicated "resume" action) — before the fix the
// phase change from paused to armed was persisted but never audited.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, _flush, _clock) => {
		const h = makeHarness(makeFixtureCwd());
		h.ctx.sessionManager = { getEntries: () => [{ type: "custom", customType: "drain-watchdog-state", data: { phase: "paused", pausedReason: "x" } }] };
		h.handlers.session_start({}, h.ctx);
		await h.handlers["command:watchdog"]("resume", h.ctx);
		const transitionAudit = h.audits.find((a) => a.type === "transition");
		assert(transitionAudit !== undefined, "resume is audited as a transition, not silently persisted (L1)");
		assert.equal(transitionAudit!.data.from, "paused");
		assert.equal(transitionAudit!.data.to, "armed");
	}),
);

// --- Factory (#30): child sessions register nothing, main sessions do -------------

// Minimal pi-surface replica: the child factory must neither listen nor command.
const makeMockPi = () => {
	const events: string[] = [];
	const commands: string[] = [];
	return {
		events,
		commands,
		on(name: string) {
			events.push(name);
			return () => {};
		},
		registerCommand(name: string) {
			commands.push(name);
		},
	};
};

// The self-check must not trust the ambient environment: it may itself run
// inside a pi-herdr-subagents child (PI_SUBAGENT_ID set), so both branches set
// the variable explicitly and the real value is restored at the end.
const ambientSubagentId = process.env.PI_SUBAGENT_ID;

process.env.PI_SUBAGENT_ID = "self-check-child";
const childPi = makeMockPi() as any;
watchdogExtension(childPi as any);
assert.equal(childPi.events.length, 0, "child factory registers no listeners");
assert.equal(childPi.commands.length, 0, "child factory registers no commands");

delete process.env.PI_SUBAGENT_ID;
const mainPi = makeMockPi() as any;
watchdogExtension(mainPi as any);
assert(mainPi.commands.includes("watchdog"), "main factory registers /watchdog");
assert(mainPi.events.includes("session_start"), "main factory restores state");
assert(mainPi.events.includes("agent_settled"), "main factory handles Esc and the READY confirm");
assert(mainPi.events.includes("agent_end"), "main factory reports provider errors");
assert(!mainPi.events.includes("tick"), "no timer surfaces: ticks are setInterval-internal and only started on arm");

if (ambientSubagentId === undefined) delete process.env.PI_SUBAGENT_ID;
else process.env.PI_SUBAGENT_ID = ambientSubagentId;

console.log("drain-watchdog self-check OK");
