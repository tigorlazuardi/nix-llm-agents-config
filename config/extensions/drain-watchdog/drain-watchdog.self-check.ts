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
 * restore), #31's drain_handoff/drain_stop tool seams (gate rules, label
 * parsing, gh argv plan, result text) and the tools' harness-driven behavior
 * (happy path with captured argv, child/phase gating, llmStop pause+resume,
 * exec-failure consistency), plus the factory's child-vs-main registration
 * split. Imports index.ts, which imports @earendil-works/pi-ai and typebox:
 * run with both resolvable (checks.nix symlinks them into a node_modules next
 * to the copy).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { DrainEvent, DrainState, ExecutorStateFile, HandoffKind, ProbeJitter, TickObservation } from "./index.ts";
import {
	BREAKER_K,
	DEFAULT_TICK_CONFIG,
	FINALIZE_NUDGE_TEXT,
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
	drainToolGate,
	handoffExit,
	handoffResultText,
	isChildSession,
	jitterAfterMs,
	jitteredDelayMs,
	MAX_RESET_DELAY_MS,
	nextLadderDelayMs,
	parseResetTimeMs,
	probeDelayForError,
	executorRepoSlug,
	executorStateFilePath,
	executorStateRoot,
	readClosingSignal,
	parseLabelList,
	parseQueueOutput,
	planHandoffCommands,
	shouldSplit,
	transition,

	buildNudgeText,
	extractFencedBlock,
	extractLastError,
	isProbeText,
	extractIssueNumbers,
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
	restoreRunTarget,

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
assert.deepEqual(backoffIn.action, { type: "probe", delayMs: 1 * MIN, jitter: "symmetric" });

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
assert.deepEqual(quotaIn.action, { type: "probe", delayMs: 30 * MIN, jitter: "symmetric" });
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
	assert.deepEqual(up.action, { type: "probe", delayMs: 30 * MIN, jitter: "symmetric" });
	assert.equal(up.state.backoffStartMs, t0);
	// Later quota errors climb the quota ladder; the budget is 12 h, not 6 h.
	const q2 = transition(up.state, { type: "providerError", kind: "quota" }, t0 + 7 * HOUR);
	assert.equal(q2.state.phase, "backoff");
	assert.deepEqual(q2.action, { type: "probe", delayMs: 60 * MIN, jitter: "symmetric" });
	const q3 = transition(q2.state, { type: "providerError", kind: "quota" }, t0 + 12 * HOUR + MIN);
	assert.equal(q3.state.phase, "paused");
	// Opposite order: a transient error inside a quota outage keeps the quota ladder + budget.
	const qFirst = transition(armOK.state, { type: "providerError", kind: "quota" }, t0);
	const tAfter = transition(qFirst.state, { type: "providerError", kind: "transient" }, t0 + HOUR);
	assert.equal(tAfter.state.backoffKind, "quota");
	assert.deepEqual(tAfter.action, { type: "probe", delayMs: 60 * MIN, jitter: "symmetric" });
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
// #31: drain_stop's own reason travels into pausedReason; empty/missing keeps
// the generic llmStop reason. The reason is NOT trimmed to emptiness silently.
assert.equal(stopped.state.pausedReason, "drain_stop");
const stoppedWithReason = transition(armOK.state, { type: "llmStop", reason: "gh auth expired on the runner" }, 40_001);
assert.equal(stoppedWithReason.state.pausedReason, "gh auth expired on the runner");
assert.equal(transition(armOK.state, { type: "llmStop", reason: "   " }, 40_002).state.pausedReason, "drain_stop");
// From BACKOFF and FINALIZING too (llmStop owners), with the reason kept.
assert.equal(transition({ ...armed(), phase: "backoff", backoffKind: "transient" }, { type: "llmStop", reason: "disk full" }, 40_003).state.pausedReason, "disk full");
assert.equal(transition({ ...armed(), phase: "finalizing" }, { type: "llmStop", reason: "repo dirty beyond repair" }, 40_004).state.pausedReason, "repo dirty beyond repair");
// llmStop from PAUSED/OFF/DONE stays a no-op (EVENT_PHASES matrix covers it; spot-check).
assert.equal(transition(pausedStateFor(), { type: "llmStop", reason: "x" }, 40_005).state.phase, "paused");

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
assert.deepEqual(tickBackoff.action, { type: "probe", delayMs: 1 * MIN, jitter: "symmetric" });

// 9b. Tick-path auth error pauses immediately (not a probe, not a nudge).
const tickAuth = transition(armed(), { type: "tick", obs: { ...baseObs(), lastError: "401 Unauthorized" } }, T);
assert.equal(tickAuth.state.phase, "paused");
assert.equal(tickAuth.state.pausedReason, "provider auth error; needs human");

// 9c. Tick-path quota error enters the quota ladder, not the transient one.
const tickQuota = transition(armed(), { type: "tick", obs: { ...baseObs(), lastError: "insufficient_quota" } }, T);
assert.equal(tickQuota.state.phase, "backoff");
assert.equal(tickQuota.state.backoffKind, "quota");
assert.deepEqual(tickQuota.action, { type: "probe", delayMs: 30 * MIN, jitter: "symmetric" });

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
// The real environment quota text (cached-quota stack) is quota, not unknown: it must ride
// the quota ladder, never the unknown-error breaker.
const REAL_QUOTA_TEXT = "All claude accounts have exhausted their quota (cached quota state, no upstream attempt; earliest reset reset after 5m) (reset after 5m)";
assert.equal(classifyProviderError(REAL_QUOTA_TEXT), "quota", "real environment quota text");
assert.equal(classifyProviderError("served from cached quota state"), "quota");
assert.equal(classifyProviderError("All accounts have exhausted their quota"), "quota");

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

// --- #32 probe seam: reset-time honor, probe text, probe-delay policy --------------------------

// Reset parser: relative windows, ISO (local-parse aware), clock times, and refusals.
{
	// Local-noon base so clock/ISO forms resolve deterministically regardless of TZ.
	const base = new Date();
	base.setHours(12, 0, 0, 0);
	const now = base.getTime();
	const pad = (x: number) => String(x).padStart(2, "0");
	const isoAt = (offsetMin: number) => {
		const d = new Date(now + offsetMin * MIN);
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	};
	assert.equal(parseResetTimeMs("quota exceeded; earliest reset reset after 5m", now), 5 * MIN, "the real session's quota text shape");
	assert.equal(parseResetTimeMs("You hit your usage limit. resets in 30 minutes", now), 30 * MIN);
	assert.equal(parseResetTimeMs("quota; retry after 300 seconds", now), 300_000);
	assert.equal(parseResetTimeMs("reset at " + isoAt(10), now), 10 * MIN, "ISO-less-offset parses LOCAL");
	assert.equal(parseResetTimeMs("resets at 12:10", now), 10 * MIN, "clock form, later today");
	assert.equal(parseResetTimeMs("resets at 12:10:30 PM", now), 10.5 * MIN, "clock with seconds and PM");
	// Unusable or absent reset times keep the ladder (null), per the contract:
	assert.equal(parseResetTimeMs("reset after 5000m", now), null, "over the window cap");
	assert.equal(parseResetTimeMs("resets in 2 hours", now), null, "over the window cap (relative)");
	assert.equal(parseResetTimeMs("resets at 13:30", now), null, "clock beyond the cap");
	assert.equal(parseResetTimeMs("reset at " + isoAt(300), now), null, "ISO beyond the cap is null like REL/clock");
	assert.equal(parseResetTimeMs("reset at " + isoAt(30), now), 30 * MIN, "ISO exactly at the cap is honored");
	assert.equal(parseResetTimeMs("reset at " + isoAt(-5), now), 0, "a passed reset clamps to 0 (probe immediately)");
	assert.equal(parseResetTimeMs("reset after 0m", now), null);
	assert.equal(parseResetTimeMs("no hint here at all", now), null);
	assert.equal(parseResetTimeMs("quota exhausted", now), null);
	// Clamps: a passed ISO reset probes immediately; nothing outruns the sane max.
	assert.equal(parseResetTimeMs("reset at " + isoAt(-5), now + 6 * MIN), 0, "passed ISO clamps to 0 once hinted recently");
	assert.ok(MAX_RESET_DELAY_MS <= 60 * MIN, "reset ceiling stays bounded");
}

// jitterAfterMs: upward-only band [base, base*1.2] for reset-driven probes.
assert.equal(jitterAfterMs(10 * MIN, 0), 10 * MIN);
assert.equal(jitterAfterMs(10 * MIN, 0.5), 11 * MIN);
assert.equal(jitterAfterMs(10 * MIN, 1), 12 * MIN);
assert.equal(jitterAfterMs(10 * MIN, -5), 10 * MIN, "clamped low");
assert.equal(jitterAfterMs(10 * MIN, 7), 12 * MIN, "clamped high");
assert.equal(jitterAfterMs(10 * MIN, Number.NaN), 11 * MIN, "NaN is the midpoint");

// probeDelayForError: reset override wins with after-jitter; plain steps are the
// ladder base with symmetric jitter (the effect layer applies the randomness).
{
	const now = 1_000_000;
	assert.deepEqual(probeDelayForError("quota; reset after 5m", now, "quota", 0), { delayMs: 5 * MIN, jitter: "after" }, "reset overrides the 30m quota rung");
	assert.deepEqual(probeDelayForError("", now, "transient", 0), { delayMs: 1 * MIN, jitter: "symmetric" });
	assert.deepEqual(probeDelayForError("", now, "quota", 3), { delayMs: 180 * MIN, jitter: "symmetric" });
	assert.deepEqual(probeDelayForError("reset after 5000m", now, "quota", 1), { delayMs: 60 * MIN, jitter: "symmetric" }, "unusable reset falls back to the ladder");
}

// Probe text is minimal, fixed, and recognized exactly (never carries ticket content).
assert.ok(isProbeText("drain-watchdog probe: continue the drain flow."));
assert.ok(!isProbeText("drain-watchdog probe: continue the drain flow.\nWork ticket #32 now."), "a probe with content is not a probe");
assert.ok(!isProbeText(buildNudgeText({ target: 32, pickable: 2 })), "normal nudges are distinct from probes");

// providerError with a message: the reset honor overrides the ladder at the seam.
{
	const now = 5_000_000;
	const plain = transition(armed(), { type: "providerError", kind: "quota" }, now);
	assert.deepEqual(plain.action, { type: "probe", delayMs: 30 * MIN, jitter: "symmetric" });
	const withReset = transition(armed(), { type: "providerError", kind: "quota", message: "quota exceeded; earliest reset reset after 5m" }, now);
	assert.equal(withReset.state.phase, "backoff");
	assert.equal(withReset.state.backoffKind, "quota");
	assert.deepEqual(withReset.action, { delayMs: 5 * MIN, jitter: "after", type: "probe" }, "carried reset time overrides the quota ladder");
	// An unusable reset falls back to the ladder even when a message is present.
	const unusable = transition(armed(), { type: "providerError", kind: "quota", message: "reset after 5000m" }, now);
	assert.deepEqual(unusable.action, { type: "probe", delayMs: 30 * MIN, jitter: "symmetric" });
	// A message without any reset hint changes nothing.
	const hinted = transition(armed(), { type: "providerError", kind: "quota", message: "quota exhausted" }, now);
	assert.deepEqual(hinted.action, { type: "probe", delayMs: 30 * MIN, jitter: "symmetric" });
	// The real quota text end to end: classify -> quota backoff probe honoring its 5 min reset
	// (upward jitter), and quota errors never feed the unknown-error breaker.
	assert.deepEqual(probeDelayForError(REAL_QUOTA_TEXT, now, "quota", 0), { delayMs: 5 * MIN, jitter: "after" });
	let real = armed();
	for (let i = 0; i < BREAKER_K + 2; i++) {
		const r = transition(real, { type: "providerError", kind: classifyProviderError(REAL_QUOTA_TEXT), message: REAL_QUOTA_TEXT }, now + i * 5 * MIN);
		assert.equal(r.state.phase, "backoff", `real quota error ${i + 1} stays in backoff`);
		assert.equal(r.state.backoffKind, "quota");
		assert.equal(r.state.noProgressStreak, 0, `real quota error ${i + 1} adds no breaker streak`);
		assert.deepEqual(r.action, { type: "probe", delayMs: 5 * MIN, jitter: "after" }, "reset override beats the quota rung");
		real = r.state;
	}
}

// --- Handoff exit (flow.html section 5, GitHub tracker) -----------------------------------------

assert.deepEqual(handoffExit("needs-info"), { label: "needs-info" });
assert.deepEqual(handoffExit("human"), { label: "ready-for-human" });
assert.deepEqual(handoffExit("wontfix"), { label: "wontfix" });
// Fail closed: an unknown kind throws; it never yields a label that leaves the ticket queued.
assert.throws(() => handoffExit("ready-for-humans" as HandoffKind));
assert.throws(() => handoffExit("toString" as HandoffKind));

// --- #31 tool seams: gate, label parse, gh argv plan, result text --------------------------

// Gate: a child can never invoke either tool, from any phase; a live run passes.
for (const phase of ["off", "armed", "backoff", "paused", "done", "finalizing"] as const) {
	assert.deepEqual(drainToolGate("handoff", true, phase), { ok: false, error: "drain_handoff is main-session only; child sessions cannot invoke it" }, `child blocked at ${phase}`);
	assert.deepEqual(drainToolGate("stop", true, phase), { ok: false, error: "drain_stop is main-session only; child sessions cannot invoke it" }, `child blocked at ${phase}`);
}
assert.deepEqual(drainToolGate("handoff", false, "armed"), { ok: true });
assert.deepEqual(drainToolGate("stop", false, "backoff"), { ok: true });
assert.deepEqual(drainToolGate("stop", false, "paused"), { ok: true });
assert.deepEqual(drainToolGate("stop", false, "finalizing"), { ok: true });
// No active run (off/done): an error result, never a silent success — a silent
// drain_handoff would look recorded when nothing happened.
assert.equal(drainToolGate("handoff", false, "off").ok, false);
assert.equal(drainToolGate("handoff", false, "done").ok, false);
assert.equal(drainToolGate("stop", false, "off").ok, false);
assert.equal(drainToolGate("stop", false, "done").ok, false);
// The off/done error names the situation and the way out.
assert(String(drainToolGate("stop", false, "done").ok === false && JSON.stringify(drainToolGate("stop", false, "done")).includes("no active watchdog run")));

// gh argv plan: exact label swap (remove first), then the reason comment.
const plan = planHandoffCommands(42, "human");
assert.equal(plan.label, "ready-for-human");
assert.deepEqual(plan.argvs[0], { command: "gh", args: ["issue", "view", "42", "--json", "labels", "--jq", ".labels[].name"] });
assert.deepEqual(plan.argvs[1], { command: "gh", args: ["issue", "edit", "42", "--remove-label", "ready-for-agent", "--add-label", "ready-for-human"] });
assert.deepEqual(plan.argvs[2]!.command, "gh");
assert.deepEqual(plan.argvs[2]!.args.slice(0, 4), ["issue", "comment", "42", "--body"]);
assert(plan.argvs[2]!.args[4]!.startsWith("drain-watchdog handoff (human): "));
assert.deepEqual(planHandoffCommands(7, "needs-info").label, "needs-info");
assert.deepEqual(planHandoffCommands(7, "wontfix").label, "wontfix");

// Label parse: one name per line (--jq '.labels[].name'), duplicates collapse,
// blank lines ignored, surrounding whitespace trimmed.
assert.deepEqual(parseLabelList("ready-for-agent\nbug\n"), ["bug", "ready-for-agent"]);
assert.deepEqual(parseLabelList("ready-for-agent\nready-for-agent\n"), ["ready-for-agent"]);
assert.deepEqual(parseLabelList("  wontfix  \n\n"), ["wontfix"]);
assert.deepEqual(parseLabelList(""), []);

// Result text is one line naming issue and label.
assert.equal(handoffResultText(42, "ready-for-human"), "Handed off #42 (label ready-for-human); recorded as progress for the watchdog.");

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
	/** Queue proof the mocked exec returns for the next bash calls (PREP needs >0
	 *  pickable to arm; ticks need 0 for an empty frontier). */
	setQueue: (pickable: number) => void;
	/** Registered model tools by name (drain_handoff, drain_stop). */
	tools: Record<string, { execute: (id: string, params: any, signal: any, update: any, ctx: any) => Promise<any> }>;
	ctx: any;
	/** The live state-entry list the default sessionManager serves; pre-seed
	 *  restore state here (persists from handlers land in this same array). */
	entries: unknown[];
};

/** A fresh factory instance wired to capturing mocks, plus a real drain-queue fixture on
 * disk (`pi.exec` is mocked, but `runQueueCommand` reads the markdown file for real). */
function makeHarness(cwd: string): Harness {
	const handlers: Record<string, (...args: any[]) => unknown> = {};
	const tools: Harness["tools"] = {};
	const audits: { type: string; data: Record<string, unknown> }[] = [];
	const notifications: { message: string; level: string }[] = [];
	const sent: { customType: string; content: string }[] = [];
	const entries: unknown[] = [];
	let queueValue = 0;
	let execImpl: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean }> = async () => ({
		stdout: `${queueValue}\n`,
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
		registerTool(tool: { name: string; execute: Harness["tools"][string]["execute"] }) {
			tools[tool.name] = { execute: tool.execute };
		},
		appendEntry(type: string, data: Record<string, unknown>) {
			if (type === "drain-watchdog-audit") audits.push({ type: String(data.event), data });
			else if (type === "drain-watchdog-state") entries.push({ type: "custom", customType: type, data });
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
		ui: {
			notify: (message: string, level = "info") => notifications.push({ message, level }),
			// The PREP -> READY -> arm flow asks once; interactive rows need an answer.
			confirm: async () => true,
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager: { getEntries: () => entries },
	};
	return { handlers, audits, notifications, sent, execCalls, setExec: (impl) => { execImpl = impl; }, setQueue: (pickable) => { queueValue = pickable; }, tools, ctx, entries };
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
		h.entries.push(
			{ type: "custom", customType: "drain-watchdog-state", data: { phase: "backoff", backoffKind: "quota", backoffRung: 1, backoffStartMs: 1000 } },
		);
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
		h.entries.push(armedEntry());
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
		h.entries.push(armedEntry());
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
		h.entries.push(armedEntry());
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
		h.entries.push({ type: "custom", customType: "drain-watchdog-state", data: { phase: "paused", pausedReason: "x" } });
		h.handlers.session_start({}, h.ctx);
		await h.handlers["command:watchdog"]("resume", h.ctx);
		const transitionAudit = h.audits.find((a) => a.type === "transition");
		assert(transitionAudit !== undefined, "resume is audited as a transition, not silently persisted (L1)");
		assert.equal(transitionAudit!.data.from, "paused");
		assert.equal(transitionAudit!.data.to, "armed");
	}),
);


// --- #31: drain_handoff / drain_stop model tools (harness) ------------------------

// A handoff gh session: the issue view returns a pickable issue (ready-for-agent
// only), both mutations succeed. The comment call echoes back the final body
// argv so the assertion sees exactly what gh would post.
const ghHandoffImpl = () => async (_command: string, args: string[]) => {
	if (args[1] === "view") return { stdout: "ready-for-agent\n", stderr: "", code: 0, killed: false };
	if (args[1] === "edit") return { stdout: "", stderr: "", code: 0, killed: false };
	if (args[1] === "comment") return { stdout: `posted: ${args[4]}`, stderr: "", code: 0, killed: false };
	return { stdout: "", stderr: "unexpected gh call", code: 99, killed: false };
};

// Latest persisted watchdog state entry from a harness run (typed loosely: the
// harness stores plain records).
const persistedLatest = (entries: unknown[]) =>
	entries.filter((e: any) => e.customType === "drain-watchdog-state").at(-1) as { data: Record<string, unknown> };

// Happy path: AC1 — label swap, reason comment, progress event (breaker stays
// cold), persisted state, audit entry, model-facing result text.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry({ noProgressStreak: 2, nextAllowedAt: 999_999_999_999 }));
		h.handlers.session_start({}, h.ctx);
		h.setExec(ghHandoffImpl());
		clock.advance(IDLE_GRACE_MS + 1000); // a real tick would nudge; nothing fires while the tool runs
		const before = timers.filter((t) => !t.cleared).length;
		const res = await h.tools.drain_handoff!.execute("t1", { issue: 42, kind: "human", reason: "needs an operator decision on the migration order" }, undefined, undefined, h.ctx);
		await flush();
		// Exact gh argv, in order: view (pre-read), edit (label swap), comment (reason).
		assert.deepEqual(h.execCalls.map((c) => [c.command, ...c.args]), [
			["gh", "issue", "view", "42", "--json", "labels", "--jq", ".labels[].name"],
			["gh", "issue", "edit", "42", "--remove-label", "ready-for-agent", "--add-label", "ready-for-human"],
			["gh", "issue", "comment", "42", "--body", "drain-watchdog handoff (human): needs an operator decision on the migration order"],
		]);
		assert(!res.isError, "the happy-path handoff is a success result");
		assert.equal(res.content[0].text, "Handed off #42 (label ready-for-human); recorded as progress for the watchdog.");
		const handoffAudit = h.audits.find((a) => a.type === "handoff");
		assert(handoffAudit !== undefined, "the handoff is audited");
		assert.equal(handoffAudit!.data.issue, 42);
		assert.equal(handoffAudit!.data.kind, "human");
		assert.equal(handoffAudit!.data.label, "ready-for-human");
		assert.equal(handoffAudit!.data.reason, "needs an operator decision on the migration order");
		// Progress reached the core: the warm start had streak 2 and a far-future
		// cooldown; the handoff reset both (breaker cold, ladder free) and the run
		// stayed armed. (Progress keeps the phase, so there is deliberately no
		// transition audit — the persisted state is the observable.)
		assert.equal(h.audits.find((a) => a.type === "transition"), undefined, "progress keeps the phase: no transition audit");
		const nowAtHandoff = Date.now(); // the fake clock is frozen during execute
		const persisted = persistedLatest(h.entries);
		assert.equal(persisted.data.phase, "armed");
		assert.equal(persisted.data.noProgressStreak, 0, "handoff is progress: the breaker streak stays cold");
		assert.equal(persisted.data.nextAllowedAt, nowAtHandoff, "handoff is progress: the nudge cooldown resets");
		// No timers were created or killed by the tool path.
		assert.equal(timers.filter((t) => !t.cleared).length, before, "the handoff tool path starts no timer");
	}),
);

// AC2: a child session can never invoke either tool — the tools are not even
// registered there, and the gate errors if a call somehow arrives in a child
// context (simulated by setting PI_SUBAGENT_ID on a main-registered harness).
await withNoAmbientSubagent(() =>
	withFakeTimers(async () => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		h.setExec(async () => {
			throw new Error("gh must not be called from a child-gated tool");
		});
		process.env.PI_SUBAGENT_ID = "child-caller";
		try {
			const stop = await h.tools.drain_stop!.execute("t2", { reason: "environment broke" }, undefined, undefined, h.ctx);
			assert.equal(stop.isError, true, "a child cannot invoke drain_stop");
			assert(String(stop.content[0].text).includes("main-session only"));
			const handoff = await h.tools.drain_handoff!.execute("t3", { issue: 42, kind: "wontfix", reason: "x" }, undefined, undefined, h.ctx);
			assert.equal(handoff.isError, true, "a child cannot invoke drain_handoff");
			assert(String(handoff.content[0].text).includes("main-session only"));
		} finally {
			delete process.env.PI_SUBAGENT_ID;
		}
		// Nothing ran, nothing changed.
		assert.equal(h.execCalls.length, 0, "a child-gated call never reaches gh");
		assert.equal(h.audits.find((a) => a.type === "handoff" || a.type === "paused"), undefined, "a child-gated call changes nothing");
	}),
);

// AC3: drain_stop pauses with the model's reason in the audit + notify, and
// /watchdog resume works afterwards.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (_timers, _flush, _clock) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		const res = await h.tools.drain_stop!.execute("t4", { reason: "gh auth is gone on this runner" }, undefined, undefined, h.ctx);
		assert(!res.isError, "drain_stop succeeds on a live run");
		assert(String(res.content[0].text).includes("paused"));
		const pauseAudit = h.audits.find((a) => a.type === "paused");
		assert(pauseAudit !== undefined, "the stop is audited as paused");
		assert.equal(pauseAudit!.data.reason, "gh auth is gone on this runner", "the model's reason reaches the audit");
		assert(h.notifications.some((n) => n.message.includes("gh auth is gone on this runner")), "the reason reaches the notify too");
		assert(h.notifications.some((n) => n.message.includes("PAUSED")));
		// The run really is paused (a tick would not run: phase gate) and persists the reason.
		const persisted = persistedLatest(h.entries);
		assert.equal(persisted.data.phase, "paused");
		assert.equal(persisted.data.pausedReason, "gh auth is gone on this runner");
		// Resume still works afterwards: paused -> armed, tick interval back, audited.
		await h.handlers["command:watchdog"]("resume", h.ctx);
		const resumeAudit = [...h.audits].reverse().find((a) => a.type === "transition");
		assert(resumeAudit !== undefined && resumeAudit.data.from === "paused" && resumeAudit.data.to === "armed", "resume works after drain_stop");
		const armedPersisted = persistedLatest(h.entries);
		assert.equal(armedPersisted.data.phase, "armed");
	}),
);

// drain_stop with no active run: an error result that says why, no state change.
await withNoAmbientSubagent(() =>
	withFakeTimers(async () => {
		const h = makeHarness(makeFixtureCwd());
		h.handlers.session_start({}, h.ctx); // no state entry: the watchdog is OFF
		const res = await h.tools.drain_stop!.execute("t5", { reason: "nothing is running" }, undefined, undefined, h.ctx);
		assert.equal(res.isError, true, "drain_stop without a live run errors with the reason");
		assert(String(res.content[0].text).includes("no active watchdog run"));
		assert.equal(h.audits.find((a) => a.type === "paused" || a.type === "transition"), undefined, "no state change when there is no run");
	}),
);

// Failure path (AC-order honesty): a comment failure after the label swap is a
// HANDOFF PARTIAL error result — gh got the swap, the watchdog recorded nothing.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (_timers, flush) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		h.setExec(async (_command, args) => {
			if (args[1] === "view") return { stdout: "ready-for-agent\n", stderr: "", code: 0, killed: false };
			if (args[1] === "edit") return { stdout: "", stderr: "", code: 0, killed: false };
			return { stdout: "", stderr: "gh: permission denied for comments", code: 4, killed: false };
		});
		const res = await h.tools.drain_handoff!.execute("t6", { issue: 9, kind: "needs-info", reason: "spec is ambiguous" }, undefined, undefined, h.ctx);
		await flush();
		assert.equal(res.isError, true, "a failed comment fails the tool result");
		assert(String(res.content[0].text).includes("HANDOFF PARTIAL"), "the partial state is reported explicitly");
		assert(String(res.content[0].text).includes("permission denied"), "the specific error is in the result");
		// State consistency: no progress/persist/audit from a failed handoff.
		assert.equal(h.audits.find((a) => a.type === "handoff"), undefined, "a failed handoff writes no handoff audit");
		const persisted = persistedLatest(h.entries);
		assert.equal(persisted.data.phase, "armed", "the run state is untouched by a failed handoff");
	}),
);

// A label-swap failure (pre-read or edit) fails before any mutation and changes nothing.
await withNoAmbientSubagent(() =>
	withFakeTimers(async () => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		h.setExec(async (_command, args) => {
			if (args[1] === "view") return { stdout: "", stderr: "gh: issue not found", code: 1, killed: false };
			return { stdout: "", stderr: "must not run", code: 0, killed: false };
		});
		const res = await h.tools.drain_handoff!.execute("t7", { issue: 404, kind: "human", reason: "x" }, undefined, undefined, h.ctx);
		assert.equal(res.isError, true);
		assert(String(res.content[0].text).includes("gh issue view 404"), "the failing gh step is named");
		assert.equal(h.execCalls.length, 1, "nothing runs after the failed pre-read");
		assert.equal(h.audits.find((a) => a.type === "handoff"), undefined);

		// Idempotent retry: the exit label already applied (and ready-for-agent gone)
		// refuses before touching the ticket again.
		h.setExec(async (_command, args) => {
			if (args[1] === "view") return { stdout: "ready-for-human\n", stderr: "", code: 0, killed: false };
			return { stdout: "", stderr: "", code: 0, killed: false };
		});
		const retry = await h.tools.drain_handoff!.execute("t8", { issue: 404, kind: "human", reason: "x" }, undefined, undefined, h.ctx);
		assert.equal(retry.isError, true);
		// The ticket is already out of the queue (no ready-for-agent left), so the
		// retry refuses in the pre-read before any mutation runs.
		assert(String(retry.content[0].text).includes("nothing to hand off"), "an already-handed-off issue refuses cleanly");
		assert.equal(h.execCalls.length, 2, "the retry also stopped at the pre-read (no edit, no comment)");
	}),
);


// --- #32 harness rows: the full backoff loop through the live factory ----------------------

const probeTimers = (timers: FakeTimer[]) => timers.filter((t) => t.kind === "timeout");
const liveTimers = (timers: FakeTimer[]) => timers.filter((t) => !t.cleared);

/**
 * Firing marks a timer consumed: the probe callback nulls its handle without
 * clearTimeout (a fired timer needs no clearing), so `cleared` alone cannot
 * tell a pending probe from a delivered one. `pending` is the real invariant
 * for "is a probe still scheduled".
 */
const makeFirer = () => {
	const fired = new Set<FakeTimer>();
	return {
		fire: (t: FakeTimer) => {
			fired.add(t);
			t.fire();
		},
		pending: (timers: FakeTimer[], kind: FakeTimer["kind"]) => timers.filter((t) => t.kind === kind && !t.cleared && !fired.has(t)),
		allSettled: (timers: FakeTimer[]) => timers.every((t) => t.cleared || fired.has(t)),
	};
};

/** Drive one live BACKOFF stretch: error -> probe at the ladder step -> probeOk. */
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		const f = makeFirer();
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		// A run ends with a transient provider error.
		h.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "503 Service Temporarily Unavailable" }] });
		assert.equal(persistedLatest(h.entries).data.phase, "backoff", "the error enters BACKOFF");
		assert(h.audits.some((a) => a.type === "transition" && a.data.to === "backoff"), "the BACKOFF entry is audited");
		assert.equal(f.pending(probeTimers(timers), "timeout").length, 1, "entering BACKOFF schedules exactly one probe timer");
		// Ladder rung 0 = 1 min, jittered ±20%: firing past the band's upper edge must
		// have delivered already — the timer carried a delay inside the jitter band.
		clock.advance(2 * MIN);
		f.fire(probeTimers(timers).at(-1)!);
		await flush();
		assert.equal(h.sent.at(-1)!.customType, "drain-watchdog-probe", "the probe is delivered as its own message type");
		assert(isProbeText(h.sent.at(-1)!.content), "the probe is the minimal fixed text, not a nudge");
		assert(h.audits.some((a) => a.type === "probe-delivered"), "the delivery is audited");
		// The probe run succeeds: one success returns to ARMED and resets the ladder.
		h.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "toolUse" }] });
		assert.equal(persistedLatest(h.entries).data.phase, "armed", "one successful probe returns to ARMED");
		const persistedAfterOk = persistedLatest(h.entries).data;
		assert.equal(persistedAfterOk.backoffRung, 0, "the ladder is reset");
		assert.equal(persistedAfterOk.backoffKind, null);
		// No probe survives the recovery; the tick loop is still live.
		assert.equal(f.pending(timers, "timeout").length, 0, "no probe timer survives probeOk");
		assert.equal(f.pending(timers, "interval").length, 1, "the tick loop stays live for the next cycle");
		await flush();
	}),
);

// Escalation: each failed probe climbs the ladder (1 -> 2 -> 5 min, jitter-bounded),
// no normal nudge fires while BACKOFF holds, and probeOk resets everything.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		const f = makeFirer();
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		const ladderBase = [1, 2, 5].map((m) => m * MIN);
		h.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "connection refused" }] });
		for (let rung = 0; rung < 3; rung++) {
			assert.equal(persistedLatest(h.entries).data.phase, "backoff");
			assert.equal(persistedLatest(h.entries).data.backoffRung, rung, `the outage sits on rung ${rung}`);
			// Fire past this rung's upper jitter bound; the delivery then proves the
			// probe was scheduled at this rung's step, not a later one.
			clock.advance(ladderBase[rung]! * 1.2 + 60_000);
			f.fire(probeTimers(timers).at(-1)!);
			await flush();
			assert.equal(h.sent.at(-1)!.customType, "drain-watchdog-probe", `rung ${rung} probe delivered`);
			if (rung < 2) {
				h.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "connection refused" }] });
				assert.equal(persistedLatest(h.entries).data.backoffRung, rung + 1, "a failed probe escalates one rung");
			} else {
				h.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "toolUse" }] });
			}
		}
		assert.equal(persistedLatest(h.entries).data.phase, "armed", "probeOk after the ladder stretch returns to ARMED");
		// Across the whole stretch no normal nudge was sent: BACKOFF suppresses them.
		assert(h.sent.every((s) => s.customType === "drain-watchdog-probe"), "only probes went out during BACKOFF");
		assert(!h.audits.some((a) => a.type === "nudge"), "no nudge audit during BACKOFF");
	}),
);

// Quota reset-time honor: the first probe lands at the carried reset (capped), not
// the 30-minute quota rung; the probe still recovers to ARMED on one success.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		const f = makeFirer();
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		h.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "quota exceeded; earliest reset reset after 5m" }] });
		assert.equal(persistedLatest(h.entries).data.backoffKind, "quota", "the quota error opens the quota outage");
		// Reset-driven delay = 5 min + upward jitter (max 6 min). Fire at 6.5 min: a probe
		// scheduled on the 30-min quota rung would still be pending — the delivery at
		// ~5-6 min proves the carried reset override was honored.
		clock.advance(6.5 * MIN);
		f.fire(probeTimers(timers).at(-1)!);
		await flush();
		assert.equal(h.sent.at(-1)!.customType, "drain-watchdog-probe", "the reset-driven probe fired well before the 30m quota rung");
		h.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "toolUse" }] });
		assert.equal(persistedLatest(h.entries).data.phase, "armed", "one success after the reset-driven probe recovers ARMED");
	}),
);

// Real environment quota text: BREAKER_K consecutive failures ride the quota ladder with the
// carried 5 min reset, never the unknown breaker (the run must survive the quota window).
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		const f = makeFirer();
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		for (let i = 0; i < BREAKER_K; i++) {
			h.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "error", errorMessage: REAL_QUOTA_TEXT }] });
			const data = persistedLatest(h.entries).data;
			assert.equal(data.phase, "backoff", `real quota error ${i + 1} stays in backoff`);
			assert.equal(data.backoffKind, "quota", "classified as quota");
			assert.equal(data.noProgressStreak, 0, "quota never feeds the unknown breaker");
			// Reset 5 min + up to 20% jitter: delivered by 6.5 min, far under the 30m+ quota rungs.
			clock.advance(6.5 * MIN);
			f.fire(f.pending(probeTimers(timers), "timeout").at(-1)!);
			await flush();
			assert.equal(h.sent.at(-1)!.customType, "drain-watchdog-probe", `probe ${i + 1} honored the 5m reset`);
		}
		assert.equal(persistedLatest(h.entries).data.phase, "backoff", "the run survives K quota failures");
	}),
);

// Single pending probe: a second providerError while already in BACKOFF replaces the probe
// timer, never accumulates a second one (double probes = duplicate steers).
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, _flush, _clock) => {
		const h = makeHarness(makeFixtureCwd());
		const f = makeFirer();
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		h.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "connection refused" }] });
		assert.equal(f.pending(probeTimers(timers), "timeout").length, 1, "first error: one probe timer");
		h.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "connection refused" }] });
		assert.equal(persistedLatest(h.entries).data.backoffRung, 1, "second error escalates in place");
		assert.equal(f.pending(probeTimers(timers), "timeout").length, 1, "BACKOFF re-entry leaves exactly one pending probe timer");
	}),
);

// Outage budget: repeated errors past TRANSIENT_OUTAGE_BUDGET_MS pause with notify
// and audit (the pause path clears every timer, probes included).
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		const f = makeFirer();
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		h.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "connection refused" }] });
		for (let i = 0; i < 12; i++) {
			clock.advance(60 * MIN);
			const pending = f.pending(probeTimers(timers), "timeout");
			if (pending.length > 0) f.fire(pending.at(-1)!);
			await flush();
			h.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "connection refused" }] });
			if (persistedLatest(h.entries).data.phase === "paused") break;
		}
		assert.equal(persistedLatest(h.entries).data.phase, "paused", "the outage budget pauses the run");
		const pauseAudit = h.audits.filter((a) => a.type === "paused").at(-1)!;
		assert(String(pauseAudit.data.reason).includes("outage"), `the pause names the outage budget (${pauseAudit.data.reason})`);
		assert(h.notifications.some((n) => n.message.includes("PAUSED")), "the outage pause notifies");
		assert(timers.every((t2) => t2.cleared || f.pending([t2], t2.kind).length === 0), "the pause clears (or consumes) every timer");
	}),
);

// Auth: an auth-class error pauses immediately — no probe, no ladder.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, _flush, _clock) => {
		const h = makeHarness(makeFixtureCwd());
		const f = makeFirer();
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		h.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "401 Unauthorized: invalid api key" }] });
		assert.equal(persistedLatest(h.entries).data.phase, "paused", "auth pauses immediately");
		assert.equal(persistedLatest(h.entries).data.pausedReason, "provider auth error; needs human");
		assert.equal(f.pending(probeTimers(timers), "timeout").length, 0, "no probe is scheduled for an auth pause");
		assert(h.notifications.some((n) => n.message.includes("PAUSED")), "the auth pause notifies");
	}),
);

// Unknown-class errors ride the transient ladder AND count toward the breaker:
// BREAKER_K unknown errors in a row pause naming the unknown breaker.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		const f = makeFirer();
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		for (let i = 0; i < BREAKER_K; i++) {
			h.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "something went profoundly sideways" }] });
			if (i < BREAKER_K - 1) {
				assert.equal(persistedLatest(h.entries).data.phase, "backoff", `unknown error ${i + 1} rides the transient ladder`);
				assert.equal(persistedLatest(h.entries).data.backoffKind, "transient");
				clock.advance(31 * MIN);
				const pending = f.pending(probeTimers(timers), "timeout");
				if (pending.length > 0) f.fire(pending.at(-1)!);
				await flush();
			}
		}
		assert.equal(persistedLatest(h.entries).data.phase, "paused", "the Kth unknown error fires the breaker");
		const pauseAudit = h.audits.filter((a) => a.type === "paused").at(-1)!;
		assert(String(pauseAudit.data.reason).includes("unknown"), "the pause names the unknown breaker");
	}),
);

// BACKOFF suppresses the normal nudge even when ticks run: restore a BACKOFF run
// (probe timer + tick loop), advance past idle grace + cooldown, fire ticks, and
// verify only the probe path is alive — no nudge is composed or delivered.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		const f = makeFirer();
		h.entries.push({ type: "custom", customType: "drain-watchdog-state", data: { phase: "backoff", backoffKind: "transient", backoffRung: 0, backoffStartMs: Date.now() } });
		h.handlers.session_start({}, h.ctx);
		assert.equal(f.pending(probeTimers(timers), "timeout").length, 1, "restored BACKOFF keeps a pending probe timer");
		clock.advance(IDLE_GRACE_MS + 10 * MIN);
		for (const t of liveTimers(timers).filter((t) => t.kind === "interval")) t.fire();
		await flush();
		await flush();
		assert(h.sent.every((s) => s.customType !== "drain-watchdog-nudge"), "BACKOFF suppresses normal nudges even on ticks");
		assert(!h.audits.some((a) => a.type === "nudge"), "no nudge is recorded during a restored BACKOFF");
	}),
);

// --- #38 closing-step signal: pure seam -----------------------------------------------------

const stateFile = (content: string | null, path = "/tmp/executor/x/38/state.json"): ExecutorStateFile => ({ path, content });

// closingStepsDone: false parses -> closing steps remain.
assert.deepEqual(readClosingSignal([stateFile(JSON.stringify({ closingStepsDone: false }))]), { hasClosingSteps: true, anomalies: [] });
// closingStepsDone: true with a healthy file -> no signal, no anomaly (the
// executor reports closing finished). A parseable file WITHOUT the boolean violates
// the #34 contract (the field is always present): no signal but an anomaly — only
// an explicit false may claim closing work.
assert.deepEqual(readClosingSignal([stateFile(JSON.stringify({ closingStepsDone: true }))]), { hasClosingSteps: false, anomalies: [] });
assert.deepEqual(readClosingSignal([stateFile(JSON.stringify({}))]), { hasClosingSteps: false, anomalies: ["/tmp/executor/x/38/state.json: parsed but closingStepsDone is not a boolean"] });
// No files at all (executor never ran) -> no signal, no anomaly: plain DONE stays plain (AC3).
assert.deepEqual(readClosingSignal([]), { hasClosingSteps: false, anomalies: [] });
// Malformed JSON / non-object / non-boolean / unreadable: no signal, but each is an anomaly.
{
	const bad = readClosingSignal([stateFile("{not json"), stateFile(JSON.stringify([1, 2])), stateFile(JSON.stringify({ closingStepsDone: "no" })), stateFile(null)]);
	assert.equal(bad.hasClosingSteps, false, "a malformed file never claims closing work");
	assert.equal(bad.anomalies.length, 4, "every malformed shape is an anomaly");
	assert(bad.anomalies.every((a) => a.includes("state.json")), "anomalies name the path");
}
// Any target still false wins over one that finished (multi-target dirs).
{
	const mixed = readClosingSignal([stateFile(JSON.stringify({ closingStepsDone: true }), "/tmp/executor/x/38/state.json"), stateFile(JSON.stringify({ closingStepsDone: false }), "/tmp/executor/x/40/state.json")]);
	assert.equal(mixed.hasClosingSteps, true, "one open target keeps the closing trigger");
	assert.equal(mixed.anomalies.length, 0);
}

// Repo slug + state path derivation (the /tmp/executor/<repo-slug> contract).
assert.equal(executorRepoSlug("/home/homeserver/projects/nix-llm-agents-config"), "nix-llm-agents-config");
assert.equal(executorRepoSlug("/repos/My_App"), "my-app");
assert.equal(executorRepoSlug("/"), "");
assert.equal(executorStateRoot("/repos/demo"), "/tmp/executor/demo");
assert.equal(executorStateFilePath("/repos/demo", 38), "/tmp/executor/demo/38/state.json");

// --- #38 closing-step signal: live loop through the factory ----------------------------------

/** Writes /tmp/executor/<slug>/<target>/state.json — the real path the effect
 *  layer scans. The fixture plays the executor, so it applies the same
 *  documented <repo-slug> rule the prompt states and executorRepoSlug implements
 *  (lowercased basename, non-alphanumerics collapsed to one dash).
 *  Returns a cleanup that removes the repo's whole /tmp/executor/<slug> root. */
function makeExecutorFixture(cwd: string, targets: { dir: string; state: object | string | null }[]): () => void {
	const slug = executorRepoSlug(cwd);
	const root = join("/tmp", "executor", slug);
	rmSync(root, { recursive: true, force: true });
	for (const t of targets) {
		const dir = join(root, t.dir);
		mkdirSync(dir, { recursive: true });
		if (t.state !== null) writeFileSync(join(dir, "state.json"), typeof t.state === "string" ? t.state : JSON.stringify(t.state));
	}
	return () => rmSync(root, { recursive: true, force: true });
}

// AC1/AC2/AC3 through the live loop: one ARMED run, empty frontier, idle past
// the grace gate, one tick each. The executor fixture is at the real
// /tmp/executor/<slug>/<target>/state.json the effect layer scans.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const cwd = makeFixtureCwd();
		const cleanup = makeExecutorFixture(cwd, [{ dir: "38", state: { closingStepsDone: false } }]);
		try {
			const h = makeHarness(cwd);
			h.entries.push(armedEntry());
			h.handlers.session_start({}, h.ctx);
			clock.advance(IDLE_GRACE_MS + 1000);
			const tickTimer = timers.find((t) => t.kind === "interval" && !t.cleared)!;
			tickTimer.fire();
			await flush();
			await flush();
			assert.equal(h.sent.length, 1, "an empty frontier with closing steps left sends exactly one FINALIZING nudge");
			assert.equal(h.sent[0]!.customType, "drain-watchdog-nudge");
			assert.equal(h.sent[0]!.content, FINALIZE_NUDGE_TEXT, "the nudge is the FINALIZING closing text, not a plain nudge");
			assert(h.audits.some((a) => a.type === "finalize-nudge"), "the finalize nudge is audited (AC1)");
			assert.equal(persistedLatest(h.entries).data.phase, "finalizing");

			// AC2 (completion): the executor finishes (closingStepsDone: true); the next
			// idle tick reaches DONE from FINALIZING, with the done audit + notify.
			writeFileSync(executorStateFilePath(cwd, 38), JSON.stringify({ closingStepsDone: true }));
			clock.advance(4 * MIN + 1000);
			tickTimer.fire();
			await flush();
			await flush();
			assert.equal(persistedLatest(h.entries).data.phase, "done", "closingStepsDone true completes the run as DONE (AC2)");
			assert(h.audits.some((a) => a.type === "done"), "the DONE is audited (the final report entry)");
			assert(h.notifications.some((n) => n.message.includes("DONE")), "DONE notifies");

			// AC1 second half + AC2 second half: idle AGAIN in FINALIZING without
			// completion pauses visibly, exactly once, with no second nudge.
			const cwd2 = makeFixtureCwd();
			const cleanup2 = makeExecutorFixture(cwd2, [{ dir: "38", state: { closingStepsDone: false } }]);
			try {
				const h2 = makeHarness(cwd2);
				h2.entries.push(armedEntry());
				h2.handlers.session_start({}, h2.ctx);
				clock.advance(IDLE_GRACE_MS + 1000);
				const tick2 = timers.filter((t) => t.kind === "interval" && !t.cleared).at(-1)!;
				tick2.fire();
				await flush();
				await flush();
				assert.equal(persistedLatest(h2.entries).data.phase, "finalizing");
				assert.equal(h2.sent.filter((s) => s.content === FINALIZE_NUDGE_TEXT).length, 1, "exactly one FINALIZING nudge");
				// The file never flips to true; after the cooldown the next idle tick pauses.
				clock.advance(4 * MIN + 1000);
				tick2.fire();
				await flush();
				await flush();
				assert.equal(persistedLatest(h2.entries).data.phase, "paused", "idle again in FINALIZING without completion pauses (AC2)");
				const pauseAudit = h2.audits.filter((a) => a.type === "paused").at(-1)!;
				assert(String(pauseAudit.data.reason).includes("finalization"), "the pause names finalization not confirmed");
				assert(h2.notifications.some((n) => n.message.includes("PAUSED")), "the pause notifies");
				assert.equal(h2.sent.filter((s) => s.content === FINALIZE_NUDGE_TEXT).length, 1, "never a second FINALIZING nudge");
			} finally {
				cleanup2();
			}

			// AC3: no executor state at all — the same tick goes straight to DONE.
			const cwd3 = makeFixtureCwd();
			try {
				const h3 = makeHarness(cwd3);
				h3.entries.push(armedEntry());
				h3.handlers.session_start({}, h3.ctx);
				clock.advance(IDLE_GRACE_MS + 1000);
				const tick3 = timers.filter((t) => t.kind === "interval" && !t.cleared).at(-1)!;
				tick3.fire();
				await flush();
				await flush();
				assert.equal(persistedLatest(h3.entries).data.phase, "done", "an empty frontier with no closing steps goes straight to DONE (AC3)");
				assert(!h3.audits.some((a) => a.type === "finalize-nudge"), "no FINALIZING nudge without a closing signal");
			} finally {
				rmSync(cwd3, { recursive: true, force: true });
			}
		} finally {
			cleanup();
		}
	}),
);

// Malformed executor state: the tick treats it as "no closing steps" (DONE, never
// a pause) and writes the closing-signal-anomaly audit naming the path.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const cwd = makeFixtureCwd();
		const cleanup = makeExecutorFixture(cwd, [{ dir: "38", state: "{not json" }]);
		try {
			const h = makeHarness(cwd);
			h.entries.push(armedEntry());
			h.handlers.session_start({}, h.ctx);
			clock.advance(IDLE_GRACE_MS + 1000);
			const tickTimer = timers.find((t) => t.kind === "interval" && !t.cleared)!;
			tickTimer.fire();
			await flush();
			await flush();
			assert.equal(persistedLatest(h.entries).data.phase, "done", "a malformed state file never blocks the run (ponytail fail-safe)");
			const anomaly = h.audits.find((a) => a.type === "closing-signal-anomaly");
			assert(anomaly !== undefined, "the anomaly is audited");
			assert(String(anomaly!.data.paths).includes("state.json"), "the anomaly names the file");
		} finally {
			cleanup();
		}
	}),
);

// Multi-target dirs: one target still closing keeps the FINALIZING trigger even
// when another already finished.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const cwd = makeFixtureCwd();
		const cleanup = makeExecutorFixture(cwd, [
			{ dir: "38", state: { closingStepsDone: true } },
			{ dir: "40", state: { closingStepsDone: false } },
		]);
		try {
			const h = makeHarness(cwd);
			h.entries.push(armedEntry());
			h.handlers.session_start({}, h.ctx);
			clock.advance(IDLE_GRACE_MS + 1000);
			const tickTimer = timers.find((t) => t.kind === "interval" && !t.cleared)!;
			tickTimer.fire();
			await flush();
			await flush();
			assert.equal(persistedLatest(h.entries).data.phase, "finalizing", "one open target keeps the trigger (multi-target scan)");
			assert.equal(h.sent.filter((s) => s.content === FINALIZE_NUDGE_TEXT).length, 1);
		} finally {
			cleanup();
		}
	}),
);

// --- #38 A/C: production arm path + targeted reads ---------------------------------------

// A (pure): a file the effect layer reported missing (ENOENT) is silence — no
// signal and no anomaly — while a real read failure and malformed JSON stay
// anomalies. This is the seam that keeps a plain run from auditing a false
// "unreadable" state.json on every tick.
assert.deepEqual(readClosingSignal([{ path: "/tmp/executor/x/38/state.json", content: null, missing: true }]), { hasClosingSteps: false, anomalies: [] });
assert.deepEqual(readClosingSignal([{ path: "/tmp/executor/x/38/state.json", content: null }]), { hasClosingSteps: false, anomalies: ["/tmp/executor/x/38/state.json: unreadable"] });
assert.deepEqual(readClosingSignal([{ path: "/tmp/executor/x/38/state.json", content: "{not json", missing: false }]), { hasClosingSteps: false, anomalies: ["/tmp/executor/x/38/state.json: state.json is not valid JSON"] });
// A missing sibling never masks a real closing target (scan path).
assert.equal(readClosingSignal([{ path: "/tmp/executor/x/40/state.json", content: null, missing: true }, { path: "/tmp/executor/x/38/state.json", content: JSON.stringify({ closingStepsDone: false }) }]).hasClosingSteps, true);

// C (pure): the restored run target rides on the persisted state entry.
assert.equal(restoreRunTarget([armedEntry({ runTarget: 38 })]), 38, "a restored run keeps its target");
assert.equal(restoreRunTarget([armedEntry({ runTarget: 38 }), armedEntry({ runTarget: 40 })]), 40, "latest entry wins");
assert.equal(restoreRunTarget([armedEntry({ runTarget: "38" })]), null, "a non-numeric target degrades to the scan path");
assert.equal(restoreRunTarget([armedEntry({ runTarget: 0 })]), null, "0 is not a target");
assert.equal(restoreRunTarget([]), null);
assert.equal(restoreRunTarget([{ type: "message", role: "user" }]), null);

/** Runs one PREP -> READY -> confirm cycle on an existing harness through the
 *  real production path. The queue proof reads pickable 2 (armable); everything
 *  after the arm reads 0 (empty frontier, plain DONE). */
async function prepAgain(h: Harness, ref: string) {
	h.setQueue(2);
	await h.handlers["command:watchdog"](ref, h.ctx);
	h.handlers.message_end({ message: { role: "assistant", content: [{ type: "text", text: "queue proof done\nREADY" }] } }, h.ctx);
	await h.handlers.agent_settled({ aborted: false, messages: [] }, h.ctx);
	h.setQueue(0);
}

/** Arms through the real production path: /watchdog #38 -> PREP (queue proof) ->
 *  model READY -> confirm. Returns the harness with an ARMED run, runTarget 38. */
async function armThroughPrep(cwd: string, entries: unknown[] = []) {
	const h = makeHarness(cwd);
	for (const e of entries) h.entries.push(e);
	h.handlers.session_start({}, h.ctx);
	await prepAgain(h, "#38");
	return h;
}

const liveTickTimers = (timers: { kind: string; cleared: boolean }[]) => timers.filter((t) => t.kind === "interval" && !t.cleared).length;

const executorRootOf = (cwd: string) => join("/tmp", "executor", executorRepoSlug(cwd));

// A (live, AC3): every real /watchdog #N run arms with a target set. With no
// executor state at all the targeted read must be silent — DONE on the empty
// frontier, no closing-signal-anomaly audit on any tick. This is the production
// path the restore-only rows above never exercised.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const cwd = makeFixtureCwd();
		rmSync(executorRootOf(cwd), { recursive: true, force: true });
		try {
			const h = await armThroughPrep(cwd);
			assert(h.audits.some((a) => a.type === "prep-proof"), "PREP ran through the real command path");
			assert(h.audits.some((a) => a.type === "armed"), "READY + confirm armed the run (production path, runTarget set)");
			assert.equal(restoreRunTarget(h.entries), 38, "the armed run persists its target with the state entry (L1)");
			clock.advance(IDLE_GRACE_MS + 1000);
			const tickTimer = timers.find((t) => t.kind === "interval" && !t.cleared)!;
			tickTimer.fire();
			await flush();
			await flush();
			assert.equal(persistedLatest(h.entries).data.phase, "done", "a plain run still reaches DONE (AC3)");
			assert.equal(h.audits.filter((a) => a.type === "closing-signal-anomaly").length, 0, "a missing state.json is not an anomaly (AC3)");
			assert.equal(h.sent.filter((s) => s.content === FINALIZE_NUDGE_TEXT).length, 0, "no FINALIZING nudge without a closing signal");
		} finally {
			rmSync(executorRootOf(cwd), { recursive: true, force: true });
			rmSync(cwd, { recursive: true, force: true });
		}
	}),
);

// A (live, targeted read): a stale SIBLING target's closingStepsDone:false must
// not drive the armed run — the run target's own absent state.json is the only
// input. Disabling the direct-read branch (scanning instead) turns this into a
// FINALIZING nudge and fails the row.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const cwd = makeFixtureCwd();
		const cleanup = makeExecutorFixture(cwd, [{ dir: "40", state: { closingStepsDone: false } }]);
		try {
			const h = await armThroughPrep(cwd);
			clock.advance(IDLE_GRACE_MS + 1000);
			const tickTimer = timers.find((t) => t.kind === "interval" && !t.cleared)!;
			tickTimer.fire();
			await flush();
			await flush();
			assert.equal(persistedLatest(h.entries).data.phase, "done", "the run target's own missing state.json means no closing steps");
			assert.equal(h.sent.filter((s) => s.content === FINALIZE_NUDGE_TEXT).length, 0, "a stale sibling target never nudges this run");
			assert.equal(h.audits.filter((a) => a.type === "closing-signal-anomaly").length, 0);
		} finally {
			cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	}),
);

// C (live): a restored ARMED run keeps its persisted target, so it reads #38
// and ignores the stale sibling #40 — no spurious FINALIZING nudge after restart.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const cwd = makeFixtureCwd();
		const cleanup = makeExecutorFixture(cwd, [{ dir: "40", state: { closingStepsDone: false } }]);
		try {
			const h = makeHarness(cwd);
			h.entries.push(armedEntry({ runTarget: 38 }));
			h.handlers.session_start({}, h.ctx);
			assert.equal(restoreRunTarget(h.entries), 38, "session_start restored the target");
			clock.advance(IDLE_GRACE_MS + 1000);
			const tickTimer = timers.find((t) => t.kind === "interval" && !t.cleared)!;
			tickTimer.fire();
			await flush();
			await flush();
			assert.equal(persistedLatest(h.entries).data.phase, "done", "a restored run reads its own target, not every target dir");
			assert.equal(h.sent.filter((s) => s.content === FINALIZE_NUDGE_TEXT).length, 0);
		} finally {
			cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	}),
);

// G (live, AC2): /watchdog during FINALIZING must not replace the live closing
// run. The PREP guard used to list only armed||backoff, so a second /watchdog in
// the closing window reset state and killed the timer: the closing outcome was
// never observed, and the persisted entry still said finalizing (divergence).
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const cwd = makeFixtureCwd();
		const cleanup = makeExecutorFixture(cwd, [{ dir: "38", state: { closingStepsDone: false } }]);
		try {
			const h = await armThroughPrep(cwd);
			clock.advance(IDLE_GRACE_MS + 1000);
			const tickTimer = timers.find((t) => t.kind === "interval" && !t.cleared)!;
			tickTimer.fire();
			await flush();
			await flush();
			assert.equal(persistedLatest(h.entries).data.phase, "finalizing", "the empty frontier with closing steps left enters FINALIZING");
			const armedBefore = h.audits.filter((a) => a.type === "armed").length;
			const liveTimersBefore = liveTickTimers(timers);
			await h.handlers["command:watchdog"]("#40", h.ctx);
			assert(h.notifications.some((n) => n.message.includes("run already active")), "a second /watchdog during FINALIZING is refused as active");
			assert.equal(h.audits.filter((a) => a.type === "armed").length, armedBefore, "the refused command never arms #40");
			assert(!h.audits.some((a) => a.type === "prep-proof" && (a.data as { target?: unknown }).target === 40), "no PREP started for #40");
			assert.equal(persistedLatest(h.entries).data.phase, "finalizing", "the closing run is untouched (no silent reset)");
			assert.equal(persistedLatest(h.entries).data.runTarget, 38, "the run target is unchanged");
			assert.equal(liveTickTimers(timers), liveTimersBefore, "the tick timer is still live");
			// And the untouched run still reaches its own outcome.
			clock.advance(4 * MIN + 1000);
			tickTimer.fire();
			await flush();
			await flush();
			assert.equal(persistedLatest(h.entries).data.phase, "paused", "the live run still reaches its finalization outcome");
			assert(h.audits.some((a) => a.type === "paused"), "that outcome is audited");
		} finally {
			cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	}),
);

// L1 (live): run lifecycle resets + persistence. A later run must never read the
// previous run's target (a stale #38 state.json must not nudge #40), the target
// must ride the persisted entry, and DONE/off must clear it so /watchdog status
// does not claim a live run target.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const cwd = makeFixtureCwd();
		try {
			const h = await armThroughPrep(cwd); // no executor state: plain run
			assert.equal(restoreRunTarget(h.entries), 38, "the armed run persists its target");
			// off must clear a LIVE run's target, not leave it on the status line.
			await h.handlers["command:watchdog"]("off", h.ctx);
			h.handlers["command:watchdog"]("status", h.ctx);
			assert(!h.notifications.at(-1)!.message.includes("run target"), "off clears a live run target (status proves it)");
			await prepAgain(h, "#38");
			assert.equal(restoreRunTarget(h.entries), 38, "the re-armed run persists its target");
			clock.advance(IDLE_GRACE_MS + 1000);
			let tickTimer = timers.filter((t) => t.kind === "interval" && !t.cleared).at(-1)!;
			tickTimer.fire();
			await flush();
			await flush();
			assert.equal(persistedLatest(h.entries).data.phase, "done", "#38 completes on the empty frontier");
			// A stale state.json from the finished run must not leak into the next run.
			const cleanup = makeExecutorFixture(cwd, [{ dir: "38", state: { closingStepsDone: false } }]);
			try {
				h.handlers["command:watchdog"]("status", h.ctx);
				assert(!h.notifications.at(-1)!.message.includes("run target"), "DONE clears the run target (status proves it)");
				await prepAgain(h, "#40");
				const armed40 = h.audits.filter((a) => a.type === "armed").at(-1)!;
				assert.equal(armed40.data.target, 40, "the new run arms #40");
				assert.equal(restoreRunTarget(h.entries), 40, "the new run persists its own target");
				clock.advance(IDLE_GRACE_MS + 1000);
				tickTimer = timers.filter((t) => t.kind === "interval" && !t.cleared).at(-1)!;
				tickTimer.fire();
				await flush();
				await flush();
				assert.equal(persistedLatest(h.entries).data.phase, "done", "#40's empty frontier completes");
				assert(!h.audits.some((a) => a.type === "finalize-nudge"), "the stale #38 file never nudges #40");
			} finally {
				cleanup();
			}
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	}),
);

// A (live, genuine IO error): a state.json that exists but cannot be read as a
// file (a directory -> EISDIR) is a real failure, not a missing file: it stays
// an anomaly. Only ENOENT is silent.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const cwd = makeFixtureCwd();
		const root = executorRootOf(cwd);
		rmSync(root, { recursive: true, force: true });
		mkdirSync(join(root, "38", "state.json"), { recursive: true });
		try {
			const h = await armThroughPrep(cwd);
			clock.advance(IDLE_GRACE_MS + 1000);
			const tickTimer = timers.find((t) => t.kind === "interval" && !t.cleared)!;
			tickTimer.fire();
			await flush();
			await flush();
			assert.equal(persistedLatest(h.entries).data.phase, "done", "an unreadable state file never blocks the run");
			const anomaly = h.audits.find((a) => a.type === "closing-signal-anomaly");
			assert(anomaly !== undefined, "a genuine read error is still audited");
			assert(String(anomaly!.data.paths).includes("state.json"));
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(cwd, { recursive: true, force: true });
		}
	}),
);

// --- Factory (#30): child sessions register nothing, main sessions do -------------
// --- Factory (#30): child sessions register nothing, main sessions do -------------

// Minimal pi-surface replica: the child factory must neither listen nor command.
const makeMockPi = () => {
	const events: string[] = [];
	const commands: string[] = [];
	const tools: string[] = [];
	return {
		events,
		commands,
		tools,
		on(name: string) {
			events.push(name);
			return () => {};
		},
		registerCommand(name: string) {
			commands.push(name);
		},
		registerTool(tool: { name: string }) {
			tools.push(tool.name);
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
assert.equal(childPi.tools.length, 0, "child factory registers no model tools (#31 AC2)");

delete process.env.PI_SUBAGENT_ID;
const mainPi = makeMockPi() as any;
watchdogExtension(mainPi as any);
assert(mainPi.commands.includes("watchdog"), "main factory registers /watchdog");
assert.deepEqual(mainPi.tools.sort(), ["drain_handoff", "drain_stop"], "main factory registers exactly the two drain tools (#31)");
assert(mainPi.events.includes("session_start"), "main factory restores state");
assert(mainPi.events.includes("agent_settled"), "main factory handles Esc and the READY confirm");
assert(mainPi.events.includes("agent_end"), "main factory reports provider errors");
assert(!mainPi.events.includes("tick"), "no timer surfaces: ticks are setInterval-internal and only started on arm");

if (ambientSubagentId === undefined) delete process.env.PI_SUBAGENT_ID;
else process.env.PI_SUBAGENT_ID = ambientSubagentId;

console.log("drain-watchdog self-check OK");
