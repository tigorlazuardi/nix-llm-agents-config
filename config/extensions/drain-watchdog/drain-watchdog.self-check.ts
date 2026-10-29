/**
 * Self-check for the drain-watchdog pure core. Run:
 *   node --experimental-strip-types drain-watchdog/drain-watchdog.self-check.ts
 *
 * Covers state transitions (incl. Esc-always-wins and child no-op), provider
 * error classification, backoff ladder sequences and jitter bounds, the SPLIT
 * predicate, the arm refusal condition, and the live-loop helpers (env parsing,
 * /watchdog argument grammar, READY/error detection, state restore). The ticket
 * tree is covered as pickable / limbo / leftover with fail-closed unknown
 * blockers, sync upsert, watchdog_complete / watchdog_handoff / watchdog_stop
 * seams and their harness-driven behavior (child/phase gating, llmStop
 * pause+resume), the done report, restore of a persisted tree, and the
 * assertion that no queue command is executed. Also the factory's
 * child-vs-main registration split. Imports index.ts, which imports
 * @earendil-works/pi-ai and typebox: run with both resolvable (checks.nix
 * symlinks them into a node_modules next to the copy).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { DrainEvent, DrainState, ExecutorStateFile, ProbeJitter, Ticket, TickObservation } from "./index.ts";
import {
	BREAKER_K,
	DEFAULT_TICK_CONFIG,
	FINALIZE_NUDGE_TEXT,
	HARD_CAP,
	IDLE_GRACE_MS,
	INITIAL_STATE,
	TICK_MS,
	QUOTA_OUTAGE_BUDGET_MS,
	SPEC_REVIEW_BUDGET_MS,
	STALL_LIMIT_MS,
	STANDARDS_REVIEW_BUDGET_MS,
	SPLIT_DEPTH_CAP,
	TRANSIENT_OUTAGE_BUDGET_MS,
	SYNC_REMINDER,
	armRefusal,
	completeTicket,
	doneReport,
	handoffTicket,
	parseTicketInputs,
	pickableIds,
	targetDirName,
	ticketCounts,
	upsertTickets,
	classifyProviderError,
	watchdogToolGate,
	doneRefusal,
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
	shouldSplit,
	transition,

	buildNudgeText,
	extractLastError,
	isProbeText,
	isReadyDeclaration,
	isSubagentCompletionNotice,
	isSubagentSpawnTool,
	messageText,
	parseWatchdogSubcommand,
	watchdogCompletions,
	watchdogWidgetLines,
	targetToolGate,
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
	progressAgeMs: 0,
	lastError: null,
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
assert.equal(armRefusal(0, false), "no tickets declared; refusing to arm");
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
// #31: watchdog_stop's own reason travels into pausedReason; empty/missing keeps
// the generic llmStop reason. The reason is NOT trimmed to emptiness silently.
assert.equal(stopped.state.pausedReason, "watchdog_stop");
const stoppedWithReason = transition(armOK.state, { type: "llmStop", reason: "gh auth expired on the runner" }, 40_001);
assert.equal(stoppedWithReason.state.pausedReason, "gh auth expired on the runner");
assert.equal(transition(armOK.state, { type: "llmStop", reason: "   " }, 40_002).state.pausedReason, "watchdog_stop");
// From BACKOFF and FINALIZING too (llmStop owners), with the reason kept.
assert.equal(transition({ ...armed(), phase: "backoff", backoffKind: "transient" }, { type: "llmStop", reason: "disk full" }, 40_003).state.pausedReason, "disk full");
assert.equal(transition({ ...armed(), phase: "finalizing" }, { type: "llmStop", reason: "repo dirty beyond repair" }, 40_004).state.pausedReason, "repo dirty beyond repair");
// llmStop from PAUSED/OFF/DONE stays a no-op (EVENT_PHASES matrix covers it; spot-check).
assert.equal(transition(pausedStateFor(), { type: "llmStop", reason: "x" }, 40_005).state.phase, "paused");

const doneClear = { queueOk: true, pickable: 0, childCount: 0, hasClosingSteps: false };
const finisher = transition({ ...armed(), phase: "finalizing" }, { type: "llmDone", obs: doneClear }, 41_000);
assert.equal(finisher.state.phase, "done");
assert.deepEqual(finisher.action, { type: "done" }, "the promise path emits the same DONE action as the tick path");
// watchdog_done (llmDone) is a verified promise: ARMED accepts it too, but only when
// the live observation shows nothing left. The model's claim alone never completes.
{
	const ok = transition(armOK.state, { type: "llmDone", obs: doneClear }, 42_000);
	assert.equal(ok.state.phase, "done", "empty queue: ARMED completes at once, no idle wait");
	assert.deepEqual(ok.action, { type: "done" });
	for (const bad of [
		{ ...doneClear, pickable: 1 },
		{ ...doneClear, childCount: 1 },
		{ ...doneClear, hasClosingSteps: true },
		{ ...doneClear, queueOk: false },
	]) {
		const early = transition(armOK.state, { type: "llmDone", obs: bad }, 42_000);
		assert.deepEqual(early.state, armOK.state, `refused promise changes nothing: ${JSON.stringify(bad)}`);
		assert.deepEqual(early.action, { type: "wait" });
		assert.notEqual(doneRefusal(bad), null);
	}
	assert.equal(doneRefusal(doneClear), null);
	// BACKOFF never accepts it: a provider outage is not a finished run.
	const bo = transition(armOK.state, { type: "providerError", kind: "transient" }, 42_001).state;
	assert.deepEqual(transition(bo, { type: "llmDone", obs: doneClear }, 42_002).state, bo);
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
assert.deepEqual(transition(armed(), { type: "tick", obs: { ...baseObs(), allIdleForMs: IDLE_GRACE_MS - 1 } }, T).action, {
	type: "wait",
});
assert.equal(
	transition(armed(), { type: "tick", obs: { ...baseObs(), allIdleForMs: IDLE_GRACE_MS } }, T).action.type,
	"nudge",
	"a tick exactly at the idle grace nudges",
);

// M2: idleGraceMs/stallLimitMs used to be decorative — handleTick always read
// its own frozen IDLE_GRACE_MS/STALL_LIMIT_MS constants, so a configured
// (narrower) threshold changed notify/audit text but never the actual gate.
// A custom TickConfig must move both gates for real, in both directions.
assert.equal(
	transition(armed(), { type: "tick", obs: { ...baseObs(), allIdleForMs: 45_000 } }, T, { idleGraceMs: 30_000, stallLimitMs: STALL_LIMIT_MS }).action.type,
	"nudge",
	"a shortened idleGraceMs lets a 45s-idle tick nudge instead of waiting out the default grace",
);
assert.deepEqual(
	transition(armed(), { type: "tick", obs: { ...baseObs(), allIdleForMs: 2 * MIN } }, T, { idleGraceMs: 5 * MIN, stallLimitMs: STALL_LIMIT_MS }).action,
	{ type: "wait" },
	"a widened idleGraceMs still waits past the default grace",
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

// 5. Frontier 0 + children 0 → DONE (do not nudge).
const done = transition(armed(), { type: "tick", obs: { ...baseObs(), pickable: 0 } }, T);
assert.equal(done.state.phase, "done");
assert.deepEqual(done.action, { type: "done" });

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

// 8. Children running with frontier 0 is NOT done; running children keep the run alive.
assert.deepEqual(
	transition(armed(), { type: "tick", obs: { ...baseObs(), pickable: 0, childCount: 1 } }, T)
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
		{ type: "llmDone", obs: { queueOk: true, pickable: 0, childCount: 0, hasClosingSteps: false } },
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
		llmDone: ["armed", "finalizing"],
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

// --- Ticket tree (pure) --------------------------------------------------------------------

const tk = (id: string, state: Ticket["state"] = "open", blockedBy: string[] = [], reason?: string): Ticket => (reason === undefined ? { id, state, blockedBy } : { id, state, blockedBy, reason });
{
	// Pickable: open and every blocker known + done; unknown blocker fails closed; limbo never pickable.
	const tree = [tk("A"), tk("B", "open", ["A"]), tk("C", "done"), tk("D", "open", ["C"]), tk("E", "open", ["ghost"]), tk("F", "limbo", [], "needs a human"), tk("G", "open", ["F"])];
	assert.deepEqual(pickableIds(tree), ["A", "D"], "B waits on open A, E has an unknown blocker, F is limbo, G is blocked by limbo");
	assert.deepEqual(ticketCounts(tree), { done: 1, limbo: 1, leftover: ["B", "E", "G"] });
	assert.deepEqual(pickableIds([]), []);
	assert.deepEqual(pickableIds([tk("X", "open", ["Y"]), tk("Y", "open", ["X"])]), [], "a blocker cycle never becomes pickable");

	// Input validation fails closed.
	assert.equal(parseTicketInputs([]).ok, false, "empty tree");
	assert.equal(parseTicketInputs("x").ok, false);
	assert.equal(parseTicketInputs([{ id: "" }]).ok, false);
	assert.equal(parseTicketInputs([{ id: "A" }, { id: "A" }]).ok, false, "duplicate id");
	assert.equal(parseTicketInputs([{ id: "A", state: "wip" }]).ok, false, "bad state");
	assert.equal(parseTicketInputs([{ id: "A", blockedBy: [1] }]).ok, false, "bad blocker");
	assert.equal(parseTicketInputs([{ id: "A", reason: 5 }]).ok, false);
	assert.equal(parseTicketInputs([{ id: "KRIPT-222", blockedBy: ["KRIPT-221"] }]).ok, true);

	// Sync: upsert by id, unsent fields stay, any transition, new => open, no deletion.
	const base = [tk("A"), tk("B", "done"), tk("C", "open", ["A"])];
	const sync = upsertTickets(base, [{ id: "A", state: "limbo", reason: "cancelled in source" }, { id: "B", state: "open" }, { id: "N1" }, { id: "C" }]);
	assert.equal(sync.summary, "3 changed: 1 open->limbo, 1 done->open, 1 new");
	assert.deepEqual(sync.tickets.map((t) => [t.id, t.state]), [["A", "limbo"], ["B", "open"], ["C", "open"], ["N1", "open"]]);
	assert.deepEqual(sync.tickets.find((t) => t.id === "C"), tk("C", "open", ["A"]), "an unsent field keeps its stored value");
	assert.deepEqual(sync.closed, ["A"], "only a ticket that went limbo/done is flagged for stopping a live child");
	assert.equal(sync.tickets.length, 4, "nothing is deleted");
	assert.equal(upsertTickets(base, [{ id: "A" }]).changed, 0, "a no-op sync changes nothing");
	assert.deepEqual(base.map((t) => t.state), ["open", "done", "open"], "upsert does not mutate its input");
	assert.deepEqual(upsertTickets(base, [{ id: "C", blockedBy: ["B"] }]).tickets.find((t) => t.id === "C"), tk("C", "open", ["B"]), "blockers can be replaced");

	// Complete / handoff.
	assert.equal(completeTicket(base, "ghost").ok, false, "unknown id fails closed");
	const completed = completeTicket(base, "A");
	assert(completed.ok && completed.tickets.find((t) => t.id === "A")!.state === "done");
	const handed = handoffTicket(base, "A", "  ambiguous spec ");
	assert(handed.ok && handed.tickets.find((t) => t.id === "A")!.state === "limbo" && handed.tickets.find((t) => t.id === "A")!.reason === "ambiguous spec");
	assert.equal(handoffTicket(base, "A", "  ").ok, false, "a reason is required");
	assert.equal(handoffTicket(base, "ghost", "x").ok, false);
	assert(handed.ok && pickableIds(handed.tickets).length === 0, "dependents of limbo stay blocked: C waits on limbo A");

	// Done report.
	assert(handed.ok);
	const report = doneReport(handed.tickets);
	assert(report.startsWith("DONE: 1 done, 1 limbo, 1 blocked-by-limbo."), report);
	assert(report.includes("Limbo (needs human review): A — ambiguous spec") && report.includes("Not worked (blocked by limbo, unknown or cyclic blockers): C"));
	assert.equal(doneReport([tk("A", "done")]), "DONE: 1 done, 0 limbo, 0 blocked-by-limbo.", "a clean run has no extra lines");

	// Restore shape checks: malformed persisted trees degrade to empty (fail closed).
	assert.deepEqual(restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "armed", tickets: [tk("A", "limbo", ["B"], "r")] } }])!.tickets, [tk("A", "limbo", ["B"], "r")]);
	assert.deepEqual(restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "armed", tickets: [{ id: "A", state: "bogus", blockedBy: [] }] } }])!.tickets, []);
	assert.deepEqual(restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "armed", tickets: "x" } }])!.tickets, []);
	assert.deepEqual(restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "armed", tickets: [tk("A")] } }])!.tickets, [tk("A")], "restoreDrainState keeps a valid tree");
	assert.deepEqual(restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "armed", tickets: [{ id: 1 }] } }])!.tickets, [], "a malformed tree is dropped, not half-applied");

	// Target dir names: opaque ids never escape /tmp/executor/<slug>.
	assert.equal(targetDirName("#38"), "38");
	assert.equal(targetDirName("KRIPT-222"), "KRIPT-222");
	assert.equal(targetDirName("../../etc"), "etc");
	assert.equal(targetDirName("///"), null);
	assert.equal(executorStateFilePath("/repos/demo", "#38"), "/tmp/executor/demo/38/state.json");
}

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
assert.ok(!isProbeText(buildNudgeText({ target: "#32", pickable: 2 })), "normal nudges are distinct from probes");

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

// --- Tool gate (#31) ---------------------------------------------------------------------------

// Gate: a child can never invoke any ticket/stop/done tool, from any phase; a live run passes.
for (const kind of ["complete", "handoff", "sync", "stop", "done"] as const) {
	for (const phase of ["off", "armed", "backoff", "paused", "done", "finalizing"] as const) {
		assert.deepEqual(watchdogToolGate(kind, true, phase), { ok: false, error: `watchdog_${kind} is main-session only; child sessions cannot invoke it` }, `child blocked: ${kind} at ${phase}`);
	}
	// No active run (off/done): an error result, never a silent success.
	assert.equal(watchdogToolGate(kind, false, "off").ok, false);
	assert.equal(watchdogToolGate(kind, false, "done").ok, false);
	assert.deepEqual(watchdogToolGate(kind, false, "armed"), { ok: true });
}
assert.deepEqual(watchdogToolGate("stop", false, "backoff"), { ok: true });
assert.deepEqual(watchdogToolGate("stop", false, "paused"), { ok: true });
assert.deepEqual(watchdogToolGate("stop", false, "finalizing"), { ok: true });
// The off/done error names the situation and the way out.
assert(JSON.stringify(watchdogToolGate("stop", false, "done")).includes("no active watchdog run"));

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

// `/watchdog` always starts model-driven discovery (the extension never reads a tracker).
// watchdog_target gate: main session only, and only while discovery is pending.
assert.deepEqual(targetToolGate(false, true), { ok: true });
assert.equal(targetToolGate(true, true).ok, false, "child sessions never choose a target");
assert.equal(targetToolGate(false, false).ok, false, "no pending discovery: the model cannot pick a target on its own");


// Operator UI: widget lines, completion.
const baseView = { phase: "armed" as const, prep: null, target: "#35", pickable: 2, children: 1, nudgeCount: 3, noProgressStreak: 1, idleMs: 42_000, pausedReason: null, backoffKind: null };
const plain = (lines: string[] | null) => (lines ?? []).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
const armedWidget = plain(watchdogWidgetLines(baseView));
assert(armedWidget.includes("ARMED") && armedWidget.includes("#35"), "armed widget shows the target");
assert(armedWidget.includes("2 pickable") && armedWidget.includes("1 jalan") && armedWidget.includes("nudge 3/30") && armedWidget.includes("idle 0:42") && armedWidget.includes("breaker 1/4"));
assert(watchdogWidgetLines(baseView)![0].includes("\x1b[32m"), "armed is green");
// Countdown to the next nudge: mm:ss, minutes keep counting past 60 (3 h = 180:00).
assert(plain(watchdogWidgetLines({ ...baseView, nudgeInMs: 138_000 })).includes("nudge dalam 2:18"));
assert(plain(watchdogWidgetLines({ ...baseView, nudgeInMs: 3 * 3_600_000 })).includes("nudge dalam 180:00"), "hours are minutes: 3 h = 180:00");
assert(plain(watchdogWidgetLines({ ...baseView, nudgeInMs: 0 })).includes("nudge di tick berikut"));
assert(!plain(watchdogWidgetLines(baseView)).includes("nudge dalam"), "no countdown without a nudgeInMs");
const pausedLines = watchdogWidgetLines({ ...baseView, phase: "paused", pausedReason: "no progress for 45m (stall)" })!;
assert(pausedLines[0].includes("\x1b[31m") && plain(pausedLines).includes("PAUSED") && plain(pausedLines).includes("no progress for 45m (stall)") && plain(pausedLines).includes("/watchdog resume"), "paused is red with reason and next action");
assert(plain(watchdogWidgetLines({ ...baseView, phase: "backoff", backoffKind: "quota" })).includes("BACKOFF (quota)"));
assert(plain(watchdogWidgetLines({ ...baseView, phase: "finalizing" })).includes("FINALIZING"));
assert(plain(watchdogWidgetLines({ ...baseView, phase: "done" })).includes("DONE"));
assert.equal(watchdogWidgetLines({ ...baseView, phase: "off", prep: null, target: null }), null, "OFF without PREP shows nothing");
assert(plain(watchdogWidgetLines({ ...baseView, phase: "off", prep: "discover", target: null })).includes("memilih target"));
assert(plain(watchdogWidgetLines({ ...baseView, phase: "off", prep: "proof" })).includes("bukti kesiapan"));

assert.deepEqual(watchdogCompletions("sta")!.map((c) => c.value), ["status"]);
assert.deepEqual(watchdogCompletions("")!.map((c) => c.value), ["status", "resume", "off", "on"]);
assert.deepEqual(watchdogCompletions("o")!.map((c) => c.value), ["off", "on"]);
assert.deepEqual(watchdogCompletions("RES")!.map((c) => c.value), ["resume"], "completion ignores case");
assert.equal(watchdogCompletions("zzz"), null);
assert.equal(watchdogCompletions("on #3"), null, "no completion after the first word");
assert.equal(watchdogCompletions("#35"), null, "a ref gets no completion");

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

// Nudge text.
const nudge = buildNudgeText({ target: "KRIPT-30", pickable: 2 });
assert(nudge.includes("KRIPT-30"), "nudge names the run target");
assert(nudge.includes("Do not ask the user"), "nudge forbids user questions");
assert(nudge.includes("watchdog_handoff") && nudge.includes("watchdog_complete"), "nudge points at the ticket tools");
assert(nudge.includes(SYNC_REMINDER), "nudge carries the keep-in-sync reminder");
assert(!nudge.includes("ready-for-human"), "nudge no longer names tracker labels");
assert(nudge.includes("in parallel") && nudge.includes("integration/<slug>"), "nudge pushes parallel worktrees on the integration branch");
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
type FakeTimer = { id: number; kind: "interval" | "timeout"; fire: () => unknown; cleared: boolean; delay?: number };

const fakeWidgetTimers: FakeTimer[] = [];
const liveWidgetTimers = () => fakeWidgetTimers.filter((t) => !t.cleared).length;

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
	const widgetTimers = fakeWidgetTimers;
	widgetTimers.length = 0; // per-run: leftovers of earlier rows must not leak in
	let nextId = 1;
	(globalThis as any).setInterval = (fn: (...args: unknown[]) => unknown, delay: number, ...args: unknown[]) => {
		const t: FakeTimer = { id: nextId++, kind: "interval", fire: () => fn(...args), cleared: false, delay };
		// The 1 s widget countdown is cosmetic: it must not count as a tick timer.
		if (delay === 1000) widgetTimers.push(t);
		else timers.push(t);
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
		const result = await run(timers, flush, clock);
		return result;
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
	/** pi.sendUserMessage payloads (PREP/discovery instructions). */
	userMessages: string[];
	/** Latest ui.setWidget payload for the watchdog key (undefined = cleared). */
	widget: () => string[] | undefined;
	execCalls: { command: string; args: string[] }[];
	setExec: (impl: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>) => void;
	/** Registered model tools by name (watchdog_target/complete/handoff/sync/done/stop). */
	tools: Record<string, { execute: (id: string, params: any, signal: any, update: any, ctx: any) => Promise<any> }>;
	ctx: any;
	/** The live state-entry list the default sessionManager serves; pre-seed
	 *  restore state here (persists from handlers land in this same array). */
	entries: unknown[];
};

/** A fresh factory instance wired to capturing mocks; `pi.exec` records every call (the extension must make none for the queue). */
function makeHarness(cwd: string): Harness {
	const handlers: Record<string, (...args: any[]) => unknown> = {};
	const tools: Harness["tools"] = {};
	const audits: { type: string; data: Record<string, unknown> }[] = [];
	const notifications: { message: string; level: string }[] = [];
	const sent: { customType: string; content: string }[] = [];
	const userMessages: string[] = [];
	let widgetLines: string[] | undefined;
	const entries: unknown[] = [];
	let execImpl: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean }> = async () => ({
		stdout: "",
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
		sendUserMessage(content: string) {
			userMessages.push(content);
		},
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
			setWidget: (_key: string, lines: string[] | undefined) => {
				widgetLines = lines;
			},
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager: { getEntries: () => entries },
	};
	return { handlers, audits, notifications, sent, userMessages, widget: () => widgetLines, execCalls, setExec: (impl) => { execImpl = impl; }, tools, ctx, entries };
}

function makeFixtureCwd(): string {
	return mkdtempSync(join(tmpdir(), "dw-harness-"));
}

const armedEntry = (tweaks: Record<string, unknown> = {}) => ({
	type: "custom",
	customType: "drain-watchdog-state",
	data: { phase: "armed", runTarget: "#38", tickets: [{ id: "T1", state: "open", blockedBy: [] }, { id: "T2", state: "open", blockedBy: [] }], ...tweaks },
});

// Latest persisted watchdog state entry from a harness run (typed loosely: the
// harness stores plain records).
const persistedLatest = (entries: unknown[]) =>
	entries.filter((e: any) => e.customType === "drain-watchdog-state").at(-1) as { data: Record<string, any> };

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
// through the real pi.sendMessage/appendEntry surface, reading the persisted ticket
// tree (no tracker call).
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		const live = timers.filter((t) => !t.cleared);
		assert.equal(live.filter((t) => t.kind === "interval").length, 1, "restoring ARMED starts the tick interval");
		assert.equal(live.filter((t) => t.kind === "timeout").length, 0, "restoring ARMED schedules no probe (BACKOFF-only)");
		clock.advance(IDLE_GRACE_MS + 1000); // past the idle-grace gate so the tick actually evaluates
		const tickTimer = timers.find((t) => t.kind === "interval" && !t.cleared)!;
		tickTimer.fire();
		await flush();
		await flush();
		assert.equal(h.sent.length, 1, "an idle armed tick with pickable work delivers exactly one nudge");
		assert.equal(h.sent[0]!.customType, "drain-watchdog-nudge");
		assert(h.audits.some((a) => a.type === "nudge"), "the nudge is audited");
		assert.equal(h.execCalls.length, 0, "the queue is the ticket tree: a tick makes no tracker/gh call");
		assert(h.sent[0]!.content.includes("2 pickable"), "the nudge reports the ticket-tree pickable count");
	}),
);

// Nudge latency bound: the default grace/tick must put the first nudge within
// IDLE_GRACE_MS + TICK_MS of going idle, and nothing fires before the grace.
assert.equal(IDLE_GRACE_MS, 60_000, "default idle grace is 60s");
assert.equal(TICK_MS, 15_000, "default tick is 15s");
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		const tickTimer = timers.find((t) => t.kind === "interval" && !t.cleared)!;
		assert.equal(tickTimer.delay, TICK_MS, "the armed tick interval defaults to TICK_MS");
		// Tick-by-tick, like the real interval: silent until the grace has elapsed.
		let elapsed = 0;
		while (elapsed + TICK_MS < IDLE_GRACE_MS) {
			clock.advance(TICK_MS);
			elapsed += TICK_MS;
			tickTimer.fire();
			await flush();
			assert.equal(h.sent.length, 0, `no nudge before the idle grace (idle ${elapsed}ms)`);
		}
		clock.advance(IDLE_GRACE_MS - elapsed - 1);
		tickTimer.fire();
		await flush();
		assert.equal(h.sent.length, 0, "no nudge 1ms before the idle grace");
		clock.advance(1 + TICK_MS); // first tick at/after idle+grace, at most one tick period late
		tickTimer.fire();
		await flush();
		await flush();
		assert.equal(h.sent.length, 1, "the nudge fires within IDLE_GRACE_MS + TICK_MS of going idle");
	}),
);

// A tick on a run with no declared tickets pauses — fail-closed, never a nudge, never
// DONE — and the pause is both audited and notified.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry({ tickets: [] }));
		h.handlers.session_start({}, h.ctx);
		clock.advance(IDLE_GRACE_MS + 1000); // past the idle-grace gate so the tick actually evaluates
		const tickTimer = timers.find((t) => t.kind === "interval" && !t.cleared)!;
		tickTimer.fire();
		await flush();
		await flush();
		assert.equal(h.sent.length, 0, "an empty ticket tree never nudges");
		const pauseAudit = h.audits.find((a) => a.type === "paused");
		assert(pauseAudit !== undefined, "an empty ticket tree is audited as paused, not silently ignored");
		assert(String(pauseAudit!.data.reason).includes("no tickets"), "the pause reason names the missing tickets");
		assert(h.notifications.some((n) => n.message.includes("PAUSED")), "the pause is also surfaced to the UI");
		assert.equal(persistedLatest(h.entries).data.phase, "paused");
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


// --- #31: watchdog_handoff / watchdog_stop model tools (harness) ------------------------

// Happy path: watchdog_handoff puts a ticket in limbo (no gh), counts as progress (breaker
// stays cold), persists, audits, and the reply reminds the model to sync the tracker.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry({ noProgressStreak: 2, nextAllowedAt: 999_999_999_999 }));
		h.handlers.session_start({}, h.ctx);
		clock.advance(IDLE_GRACE_MS + 1000);
		const before = timers.filter((t) => !t.cleared).length;
		const res = await h.tools.watchdog_handoff!.execute("t1", { id: "T1", reason: "needs an operator decision on the migration order" }, undefined, undefined, h.ctx);
		await flush();
		assert.equal(h.execCalls.length, 0, "no gh / tracker call: the extension only edits its own ticket tree");
		assert(!res.isError, "the happy-path handoff is a success result");
		assert(res.content[0].text.includes("limbo") && res.content[0].text.includes("Pickable now: T2") && res.content[0].text.includes(SYNC_REMINDER), res.content[0].text);
		const handoffAudit = h.audits.find((a) => a.type === "handoff");
		assert(handoffAudit !== undefined, "the handoff is audited");
		assert.equal(handoffAudit!.data.id, "T1");
		assert.equal(handoffAudit!.data.reason, "needs an operator decision on the migration order");
		assert.equal(h.audits.find((a) => a.type === "transition"), undefined, "progress keeps the phase: no transition audit");
		const nowAtHandoff = Date.now(); // the fake clock is frozen during execute
		const persisted = persistedLatest(h.entries);
		assert.equal(persisted.data.phase, "armed");
		assert.equal(persisted.data.noProgressStreak, 0, "handoff is progress: the breaker streak stays cold");
		assert.equal(persisted.data.nextAllowedAt, nowAtHandoff, "handoff is progress: the nudge cooldown resets");
		assert.deepEqual(persisted.data.tickets.map((t: Ticket) => [t.id, t.state]), [["T1", "limbo"], ["T2", "open"]], "the tree persists with the run");
		assert.equal(persisted.data.tickets[0].reason, "needs an operator decision on the migration order");
		assert.equal(timers.filter((t) => !t.cleared).length, before, "the handoff tool path starts no timer");
		// Failure paths: unknown id and empty reason change nothing.
		const bad = await h.tools.watchdog_handoff!.execute("t1b", { id: "ghost", reason: "x" }, undefined, undefined, h.ctx);
		assert.equal(bad.isError, true, "unknown ticket id fails closed");
		const noReason = await h.tools.watchdog_handoff!.execute("t1c", { id: "T2", reason: "  " }, undefined, undefined, h.ctx);
		assert.equal(noReason.isError, true, "empty reason is refused");
		assert.equal(persistedLatest(h.entries).data.tickets[1].state, "open");
	}),
);

// watchdog_complete + watchdog_sync through the live factory: progress, persist, audit,
// pickable summary, and the stop-a-live-child note when a ticket closes.
await withNoAmbientSubagent(() =>
	withFakeTimers(async () => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry({ tickets: [tk("A"), tk("B", "open", ["A"])] }));
		h.handlers.session_start({}, h.ctx);
		const done = await h.tools.watchdog_complete!.execute("c1", { id: "A" }, undefined, undefined, h.ctx);
		assert(!done.isError && done.content[0].text.includes("Pickable now: B") && done.content[0].text.includes(SYNC_REMINDER), done.content[0].text);
		assert.equal(persistedLatest(h.entries).data.tickets[0].state, "done");
		assert((await h.tools.watchdog_complete!.execute("c2", { id: "ghost" }, undefined, undefined, h.ctx)).isError, "unknown id fails closed");
		// Source changed unexpectedly: B cancelled (limbo), N new (SPLIT child), A reopened.
		const sync = await h.tools.watchdog_sync!.execute("s1", { tickets: [{ id: "B", state: "limbo", reason: "cancelled in source" }, { id: "N" }, { id: "A", state: "open" }] }, undefined, undefined, h.ctx);
		assert(!sync.isError, sync.content[0].text);
		const text = String(sync.content[0].text);
		assert(text.includes("3 changed: 1 open->limbo, 1 new, 1 done->open") && text.includes("Pickable now: N, A") === false, text);
		assert(text.includes("Pickable now: A, N") && text.includes("stop any live child") && text.includes(SYNC_REMINDER), text);
		assert(h.audits.some((a) => a.type === "sync"), "sync is audited");
		assert.deepEqual(persistedLatest(h.entries).data.tickets.map((t: Ticket) => [t.id, t.state]), [["A", "open"], ["B", "limbo"], ["N", "open"]]);
		assert((await h.tools.watchdog_sync!.execute("s2", { tickets: [{ id: "A", state: "bogus" }] }, undefined, undefined, h.ctx)).isError, "malformed sync is refused");
		assert((await h.tools.watchdog_sync!.execute("s3", { tickets: [] }, undefined, undefined, h.ctx)).isError, "empty sync is refused");
		const noop = await h.tools.watchdog_sync!.execute("s4", { tickets: [{ id: "A" }] }, undefined, undefined, h.ctx);
		assert(!noop.isError && String(noop.content[0].text).startsWith("watchdog_sync: 0 changed"), "a no-op sync is reported as such");
		assert.equal(h.execCalls.length, 0, "no tracker call anywhere");
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
		process.env.PI_SUBAGENT_ID = "child-caller";
		try {
			const stop = await h.tools.watchdog_stop!.execute("t2", { reason: "environment broke" }, undefined, undefined, h.ctx);
			assert.equal(stop.isError, true, "a child cannot invoke watchdog_stop");
			assert(String(stop.content[0].text).includes("main-session only"));
			const handoff = await h.tools.watchdog_handoff!.execute("t3", { id: "T1", reason: "x" }, undefined, undefined, h.ctx);
			assert.equal(handoff.isError, true, "a child cannot invoke watchdog_handoff");
			assert(String(handoff.content[0].text).includes("main-session only"));
			for (const [name, params] of [["watchdog_complete", { id: "T1" }], ["watchdog_sync", { tickets: [{ id: "T1" }] }], ["watchdog_done", {}]] as const) {
				const res = await h.tools[name]!.execute("t3x", params, undefined, undefined, h.ctx);
				assert.equal(res.isError, true, `a child cannot invoke ${name}`);
			}
		} finally {
			delete process.env.PI_SUBAGENT_ID;
		}
		// Nothing ran, nothing changed.
		assert.equal(h.execCalls.length, 0, "a child-gated call never reaches gh");
		assert.equal(h.audits.find((a) => a.type === "handoff" || a.type === "paused" || a.type === "sync" || a.type === "complete"), undefined, "a child-gated call changes nothing");
		assert.equal(h.entries.filter((e: any) => e.customType === "drain-watchdog-state").length, 1, "a child-gated call persists nothing beyond the restored entry");
	}),
);

// AC3: watchdog_stop pauses with the model's reason in the audit + notify, and
// /watchdog resume works afterwards.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (_timers, _flush, _clock) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		const res = await h.tools.watchdog_stop!.execute("t4", { reason: "gh auth is gone on this runner" }, undefined, undefined, h.ctx);
		assert(!res.isError, "watchdog_stop succeeds on a live run");
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
		assert(resumeAudit !== undefined && resumeAudit.data.from === "paused" && resumeAudit.data.to === "armed", "resume works after watchdog_stop");
		const armedPersisted = persistedLatest(h.entries);
		assert.equal(armedPersisted.data.phase, "armed");
	}),
);

// watchdog_done: a verified promise. Refused while tickets remain (nothing changes),
// accepted at once with nothing pickable (DONE, timers stopped, audited, no idle wait).
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		const early = await h.tools.watchdog_done!.execute("d1", {}, undefined, undefined, h.ctx);
		assert.equal(early.isError, true, "premature promise is refused");
		assert(String(early.content[0].text).includes("2 pickable"), "the refusal names what remains");
		assert.equal(persistedLatest(h.entries)?.data?.phase ?? "armed", "armed", "a refused promise leaves the run armed");
		assert(h.audits.some((a) => a.type === "done-refused"));
		await h.tools.watchdog_complete!.execute("d1a", { id: "T1" }, undefined, undefined, h.ctx);
		await h.tools.watchdog_handoff!.execute("d1b", { id: "T2", reason: "needs a human" }, undefined, undefined, h.ctx);
		const res = await h.tools.watchdog_done!.execute("d2", {}, undefined, undefined, h.ctx);
		assert(!res.isError, "nothing pickable (done + limbo only): the promise is accepted");
		assert(String(res.content[0].text).includes("DONE: 1 done, 1 limbo") && String(res.content[0].text).includes("T2 — needs a human"), "the accepted result carries the done/limbo report");
		assert.equal(persistedLatest(h.entries).data.phase, "done");
		assert(h.audits.some((a) => a.type === "done"), "DONE is audited");
		assert(h.notifications.some((n) => n.message.includes("DONE")));
		assert.equal(timers.filter((t) => !t.cleared).length, 0, "DONE clears every timer");
		assert.equal(liveWidgetTimers(), 0, "DONE also stops the widget countdown");
		const again = await h.tools.watchdog_done!.execute("d3", {}, undefined, undefined, h.ctx);
		assert.equal(again.isError, true, "a finished run cannot be completed twice");
	}),
);

// watchdog_stop with no active run: an error result that says why, no state change.
await withNoAmbientSubagent(() =>
	withFakeTimers(async () => {
		const h = makeHarness(makeFixtureCwd());
		h.handlers.session_start({}, h.ctx); // no state entry: the watchdog is OFF
		const res = await h.tools.watchdog_stop!.execute("t5", { reason: "nothing is running" }, undefined, undefined, h.ctx);
		assert.equal(res.isError, true, "watchdog_stop without a live run errors with the reason");
		assert(String(res.content[0].text).includes("no active watchdog run"));
		assert.equal(h.audits.find((a) => a.type === "paused" || a.type === "transition"), undefined, "no state change when there is no run");
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
assert.equal(executorStateFilePath("/repos/demo", "#38"), "/tmp/executor/demo/38/state.json");

const drainedTickets = [tk("T1", "done"), tk("T2", "done")];

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
			h.entries.push(armedEntry({ tickets: drainedTickets }));
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
			writeFileSync(executorStateFilePath(cwd, "#38"), JSON.stringify({ closingStepsDone: true }));
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
				h2.entries.push(armedEntry({ tickets: drainedTickets }));
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
				h3.entries.push(armedEntry({ tickets: drainedTickets }));
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
			h.entries.push(armedEntry({ tickets: drainedTickets }));
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

// A restored run with no persisted target still drains from its ticket tree (the target
// only selects the executor state file; it never gates the tree).
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry({ runTarget: null }));
		h.handlers.session_start({}, h.ctx);
		clock.advance(IDLE_GRACE_MS + 1000);
		timers.find((t) => t.kind === "interval" && !t.cleared)!.fire();
		await flush();
		await flush();
		assert.equal(persistedLatest(h.entries).data.phase, "armed", "pickable tickets keep the run armed");
		assert.equal(h.sent.length, 1, "and the tick nudges from the tree");
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
assert.equal(restoreRunTarget([armedEntry({ runTarget: "#38" })]), "#38", "a restored run keeps its target");
assert.equal(restoreRunTarget([armedEntry({ runTarget: "#38" }), armedEntry({ runTarget: "#40" })]), "#40", "latest entry wins");
assert.equal(restoreRunTarget([armedEntry({ runTarget: 38 })]), null, "a non-string target degrades to the scan path");
assert.equal(restoreRunTarget([armedEntry({ runTarget: "///" })]), null, "an unusable id is not a target");
assert.equal(restoreRunTarget([]), null);
assert.equal(restoreRunTarget([{ type: "message", role: "user" }]), null);

/** Runs one PREP -> watchdog_target -> READY -> confirm cycle on an existing harness
 *  through the real production path, then completes both tickets (empty frontier). */
async function prepAgain(h: Harness, ref: string) {
	await h.handlers["command:watchdog"]("", h.ctx);
	await h.tools.watchdog_target!.execute("p1", { issue: ref, tickets: [{ id: "T1" }, { id: "T2", blockedBy: ["T1"] }] }, undefined, undefined, h.ctx);
	h.handlers.message_end({ message: { role: "assistant", content: [{ type: "text", text: "proof done\nREADY" }] } }, h.ctx);
	await h.handlers.agent_settled({ aborted: false, messages: [] }, h.ctx);
	// Drain the tree so the frontier is empty (plain DONE / FINALIZING paths).
	await h.tools.watchdog_complete!.execute("p2", { id: "T1" }, undefined, undefined, h.ctx);
	await h.tools.watchdog_complete!.execute("p3", { id: "T2" }, undefined, undefined, h.ctx);
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
			assert.equal(restoreRunTarget(h.entries), "#38", "the armed run persists its target with the state entry (L1)");
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
			h.entries.push(armedEntry({ runTarget: "#38", tickets: drainedTickets }));
			h.handlers.session_start({}, h.ctx);
			assert.equal(restoreRunTarget(h.entries), "#38", "session_start restored the target");
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
			assert(!h.audits.some((a) => a.type === "prep-proof" && (a.data as { target?: unknown }).target === "#40"), "no PREP started for #40");
			assert.equal(persistedLatest(h.entries).data.phase, "finalizing", "the closing run is untouched (no silent reset)");
			assert.equal(persistedLatest(h.entries).data.runTarget, "#38", "the run target is unchanged");
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
			assert.equal(restoreRunTarget(h.entries), "#38", "the armed run persists its target");
			// off must clear a LIVE run's target, not leave it on the status line.
			await h.handlers["command:watchdog"]("off", h.ctx);
			h.handlers["command:watchdog"]("status", h.ctx);
			assert(!h.notifications.at(-1)!.message.includes("run target"), "off clears a live run target (status proves it)");
			await prepAgain(h, "#38");
			assert.equal(restoreRunTarget(h.entries), "#38", "the re-armed run persists its target");
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
				assert.equal(armed40.data.target, "#40", "the new run arms #40");
				assert.equal(restoreRunTarget(h.entries), "#40", "the new run persists its own target");
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
assert.deepEqual(mainPi.tools.sort(), ["watchdog_complete", "watchdog_done", "watchdog_handoff", "watchdog_stop", "watchdog_sync", "watchdog_target"], "main factory registers exactly the ticket-tree tools");
assert(mainPi.events.includes("session_start"), "main factory restores state");
assert(mainPi.events.includes("agent_settled"), "main factory handles Esc and the READY confirm");
assert(mainPi.events.includes("agent_end"), "main factory reports provider errors");
assert(!mainPi.events.includes("tick"), "no timer surfaces: ticks are setInterval-internal and only started on arm");

if (ambientSubagentId === undefined) delete process.env.PI_SUBAGENT_ID;
else process.env.PI_SUBAGENT_ID = ambientSubagentId;

// Discovery (live): /watchdog asks the MODEL to find the target and its ticket tree (no
// scan, no tracker call, no ui.select/ui.input); the operator's pick returns through
// watchdog_target, which proves the tree and starts the READY step. The tool is refused
// outside a pending discovery.
const tree38 = [{ id: "KRIPT-1" }, { id: "KRIPT-2", blockedBy: ["KRIPT-1"] }];
await withNoAmbientSubagent(() =>
	withFakeTimers(async () => {
		const cwd = makeFixtureCwd();
		try {
			const h = makeHarness(cwd);
			h.handlers.session_start({}, h.ctx);

			const early = await h.tools.watchdog_target!.execute("d0", { issue: "KRIPT-222", tickets: tree38 }, undefined, undefined, h.ctx);
			assert(early.isError, "watchdog_target is refused when no discovery is pending");

			await h.handlers["command:watchdog"]("", h.ctx);
			assert.equal(h.userMessages.length, 1, "discovery sends exactly one instruction to the model");
			assert(h.userMessages[0].includes("watchdog_target"), "the model is told how to hand the pick back");
			assert(h.userMessages[0].includes("ask_user_question"), "the model, not the extension, asks the operator");
			assert(h.userMessages[0].includes(SYNC_REMINDER), "the discovery text carries the keep-in-sync reminder");
			assert(!h.userMessages[0].includes("READY"), "no READY step before a target exists");
			assert(h.audits.some((a) => a.type === "prep-discover"));
			assert.equal(h.execCalls.length, 0, "the extension never calls a tracker");

			assert(plain(h.widget() ?? null as any).includes("memilih target"), "the widget shows target selection while discovery is pending");
			const bad = await h.tools.watchdog_target!.execute("d0b", { issue: "KRIPT-222", tickets: [{ id: "A", state: "wip" }] }, undefined, undefined, h.ctx);
			assert(bad.isError, "a malformed tree is refused");
			// A refused pick consumed the discovery? No: validation errors keep it pending.
			const ok = await h.tools.watchdog_target!.execute("d1", { issue: "KRIPT-222", tickets: tree38 }, undefined, undefined, h.ctx);
			assert(!ok.isError, "the pick is accepted while discovery is pending");
			assert(h.audits.some((a) => a.type === "prep-proof" && a.data.target === "KRIPT-222"), "the chosen target gets the ticket-tree proof");
			// The tool runs mid-turn: sendUserMessage would throw "Agent is already
			// processing", so the READY instruction rides the tool result instead.
			assert.equal(h.userMessages.length, 1, "the tool path sends no user message");
			assert(ok.content[0].text.includes("KRIPT-222") && ok.content[0].text.includes("READY"), "the READY instruction is the tool result");

			const again = await h.tools.watchdog_target!.execute("d2", { issue: "KRIPT-300", tickets: tree38 }, undefined, undefined, h.ctx);
			assert(again.isError, "one pick per discovery request");

			h.handlers.message_end({ message: { role: "assistant", content: [{ type: "text", text: "proof done\nREADY" }] } }, h.ctx);
			await h.handlers.agent_settled({ aborted: false, messages: [] }, h.ctx);
			h.handlers["command:watchdog"]("status", h.ctx);
			assert(h.notifications.some((n) => n.message.includes("phase armed") && n.message.includes("run target KRIPT-222")), "the discovered target arms through the normal PREP path");
			assert(h.audits.some((a) => a.type === "kickoff" && a.data.target === "KRIPT-222"), "arming kicks the first pass off immediately");
			const w = plain(h.widget() ?? null as any);
			assert(w.includes("ARMED") && w.includes("KRIPT-222"), "the armed widget is on screen after arm");
			assert.equal(h.sent.filter((m) => m.customType === "drain-watchdog-nudge").length, 1, "exactly one kick-off message is delivered at arm");
			assert(h.sent[h.sent.length - 1].content.includes("KRIPT-222"), "the kick-off names the run target");
			assert.equal(persistedLatest(h.entries).data.nudgeCount, 0, "the kick-off is not a counted nudge");
			assert.deepEqual(persistedLatest(h.entries).data.tickets.map((t: Ticket) => t.id), ["KRIPT-1", "KRIPT-2"], "the declared tree arms with the run");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	}),
);

// Discovery (live): a refused proof (nothing pickable) fails the pick visibly and the tool
// does not stay armed for a retry; and /watchdog off cancels a pending discovery.
await withNoAmbientSubagent(() =>
	withFakeTimers(async () => {
		const cwd = makeFixtureCwd();
		try {
			const h = makeHarness(cwd);
			h.handlers.session_start({}, h.ctx);
			await h.handlers["command:watchdog"]("", h.ctx);
			const refused = await h.tools.watchdog_target!.execute("r1", { issue: "KRIPT-1", tickets: [{ id: "A", state: "done" }] }, undefined, undefined, h.ctx);
			assert(refused.isError, "a tree with nothing pickable refuses the pick");
			assert(h.audits.some((a) => a.type === "prep-refused"));
			const retry = await h.tools.watchdog_target!.execute("r2", { issue: "KRIPT-1", tickets: tree38 }, undefined, undefined, h.ctx);
			assert(retry.isError, "a refused pick needs a fresh /watchdog");

			await h.handlers["command:watchdog"]("", h.ctx);
			await h.handlers["command:watchdog"]("off", h.ctx);
			assert.equal(h.widget(), undefined, "/watchdog off clears the widget");
			const afterOff = await h.tools.watchdog_target!.execute("r3", { issue: "KRIPT-1", tickets: tree38 }, undefined, undefined, h.ctx);
			assert(afterOff.isError, "/watchdog off cancels a pending discovery");

			// An explicit ref only seeds the discovery text; the model still hands back the tree.
			const before = h.userMessages.length;
			await h.handlers["command:watchdog"]("#38", h.ctx);
			assert.equal(h.userMessages.length, before + 1);
			assert(h.userMessages[before].includes("#38") && h.userMessages[before].includes("watchdog_target"), "an explicit ref is passed to the model's discovery");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	}),
);

console.log("drain-watchdog self-check OK");
