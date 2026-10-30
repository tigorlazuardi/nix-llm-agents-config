/**
 * Self-check for the drain-watchdog pure core. Run:
 *   node --experimental-strip-types drain-watchdog/drain-watchdog.self-check.ts
 *
 * Covers state transitions (incl. Esc-always-wins and child no-op), the nudge
 * cooldown ladder and breaker, the arm refusal condition, and the live-loop
 * helpers (/watchdog argument grammar, state restore). The ticket
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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DrainEvent, DrainState, Ticket, TickObservation } from "./index.ts";
import {
	BREAKER_K,
	HARD_CAP,
	IDLE_GRACE_MS,
	PROBE_TEXT,
	QUOTA_OUTAGE_BUDGET_MS,
	TRANSIENT_OUTAGE_BUDGET_MS,
	classifyProviderError,
	extractLastError,
	nextLadderDelayMs,
	INITIAL_STATE,
	TICK_MS,
	STALL_LIMIT_MS,
	SYNC_REMINDER,
	armRefusal,
	completeTicket,
	doneReport,
	handoffTicket,
	parseTicketInputs,
	pickableIds,
	ticketCounts,
	upsertTickets,
	watchdogToolGate,
	doneRefusal,
	isChildSession,
	transition,

	buildNudgeText,
	isSubagentCompletionNotice,
	isSubagentSpawnTool,
	parseWatchdogSubcommand,
	watchdogCompletions,
	watchdogWidgetLines,
	targetToolGate,
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
});

// --- Transition: arming --------------------------------------------------------

const armOK = transition(INITIAL_STATE, { type: "arm", queueOk: true, pickable: 3 }, 1000);
assert.equal(armOK.state.phase, "armed");
assert.equal(armOK.refusal, null);
assert.equal(armOK.state.nudgeCount, 0);
assert.equal(armOK.state.noProgressStreak, 0);

// Arm refusal: pickable 0 and no tickets declared both refuse; refusal never arms.
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

for (const phase of ["armed", "backoff"] as const) {
	const s = transition({ ...armed(), phase }, { type: "abort" }, 5000);
	assert.equal(s.state.phase, "paused", `abort must win from ${phase}`);
	assert.equal(s.action.type, "pause");
}
// Abort never auto-resumes: paused stays paused until an explicit resume event.
assert.equal(transition(resumed.state, { type: "abort" }, 6000).state.phase, "paused");
// A paused run never self-resumes: Esc wins, only an explicit resume event continues.
assert.equal(transition(pausedStuck, { type: "tick", obs: baseObs() }, 6000).state.phase, "paused");

// --- Provider errors: classification, backoff ladder, probe --------------------------------

for (const [text, kind] of [
	["429 insufficient_quota", "quota"],
	["You have hit your usage limit", "quota"],
	["All claude accounts have exhausted their quota", "quota"],
	["502 Bad Gateway", "transient"],
	["503 Service Unavailable", "transient"],
	["429 rate limit exceeded", "transient"],
	["read ECONNRESET", "transient"],
	["connect ETIMEDOUT 1.2.3.4:443", "transient"],
	["401 unauthorized", "auth"],
	["Invalid API key", "auth"],
	["status 403 forbidden", "auth"],
	["the model said something odd", "unknown"],
	// Order quota -> auth -> transient: texts carrying two markers must resolve to the earlier class.
	["401 billing problem", "quota"],
	["503 usage limit reached", "quota"],
	["503 unauthorized", "auth"],
	["read ECONNRESET forbidden", "auth"],
] as const) assert.equal(classifyProviderError(text), kind, `classify ${JSON.stringify(text)}`);

// extractLastError: only a trailing assistant error counts; aborted/success => null.
assert.equal(extractLastError([{ role: "assistant", stopReason: "error", errorMessage: "503" }]), "503");
assert.equal(extractLastError([{ role: "assistant", stopReason: "error" }]), "unknown provider error");
assert.equal(extractLastError([{ role: "assistant", stopReason: "error", errorMessage: "503" }, { role: "toolResult" }]), "503", "non-assistant tail is skipped");
assert.equal(extractLastError([{ role: "assistant", stopReason: "error", errorMessage: "503" }, { role: "assistant", stopReason: "stop" }]), null, "recovered inside the run");
assert.equal(extractLastError([{ role: "assistant", stopReason: "aborted" }]), null, "abort is not a provider error");
assert.equal(extractLastError([]), null);

// Ladders (minutes) clamp at the last rung.
assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 99].map((r) => nextLadderDelayMs("transient", r) / MIN), [1, 2, 5, 10, 20, 30, 30, 30]);
assert.deepEqual([0, 1, 2, 3, 4, 99].map((r) => nextLadderDelayMs("quota", r) / MIN), [30, 60, 120, 180, 180, 180]);
assert.equal(TRANSIENT_OUTAGE_BUDGET_MS, 6 * HOUR);
assert.equal(QUOTA_OUTAGE_BUDGET_MS, 12 * HOUR);

{
	const T0 = 1_000_000;
	// Error from ARMED => BACKOFF at rung 0 + one probe action; backoff never touches the breaker/hard cap.
	const e1 = transition(armed({ noProgressStreak: 2, nudgeCount: 5 }), { type: "providerError", kind: "transient" }, T0);
	assert.equal(e1.state.phase, "backoff");
	assert.equal(e1.state.backoffKind, "transient");
	assert.equal(e1.state.backoffRung, 0);
	assert.equal(e1.state.backoffStartMs, T0);
	assert.deepEqual(e1.action, { type: "probe", delayMs: 1 * MIN });
	assert.equal(e1.state.noProgressStreak, 2, "provider error does not count toward the breaker");
	assert.equal(e1.state.nudgeCount, 5, "provider error does not count toward the hard cap");
	// unknown rides the transient ladder; quota opens the quota ladder.
	assert.equal(transition(armed(), { type: "providerError", kind: "unknown" }, T0).state.backoffKind, "transient");
	const q1 = transition(armed(), { type: "providerError", kind: "quota" }, T0);
	assert.equal(q1.state.backoffKind, "quota");
	assert.deepEqual(q1.action, { type: "probe", delayMs: 30 * MIN });
	// Repeated error escalates the rung; the outage start is kept.
	const e2 = transition(e1.state, { type: "providerError", kind: "transient" }, T0 + MIN);
	assert.equal(e2.state.backoffRung, 1);
	assert.equal(e2.state.backoffStartMs, T0);
	assert.deepEqual(e2.action, { type: "probe", delayMs: 2 * MIN });
	// A quota error inside a transient outage upgrades to the quota ladder (rung 0), start kept.
	const up = transition(e2.state, { type: "providerError", kind: "quota" }, T0 + 2 * MIN);
	assert.equal(up.state.backoffKind, "quota");
	assert.equal(up.state.backoffRung, 0);
	assert.equal(up.state.backoffStartMs, T0);
	// Auth => PAUSED at once with a reason, from ARMED and from BACKOFF.
	for (const from of [armed(), e1.state]) {
		const a = transition(from, { type: "providerError", kind: "auth" }, T0);
		assert.equal(a.state.phase, "paused");
		assert.equal(a.state.pausedReason, "provider auth error; needs human");
		assert.equal(a.action.type, "pause");
	}
	// Outage budgets (from backoffStartMs): transient 6h, quota 12h; exceeded => PAUSED with reason.
	assert.equal(transition(e1.state, { type: "providerError", kind: "transient" }, T0 + 6 * HOUR - 1).state.phase, "backoff", "just inside the transient budget");
	const tOver = transition(e1.state, { type: "providerError", kind: "transient" }, T0 + 6 * HOUR);
	assert.equal(tOver.state.phase, "paused");
	assert.equal(tOver.state.pausedReason, "provider outage budget exhausted");
	assert.equal(transition(q1.state, { type: "providerError", kind: "quota" }, T0 + 12 * HOUR - 1).state.phase, "backoff", "just inside the quota budget");
	assert.equal(transition(q1.state, { type: "providerError", kind: "quota" }, T0 + 12 * HOUR).state.phase, "paused");
	assert.equal(transition(q1.state, { type: "providerError", kind: "quota" }, T0 + 7 * HOUR).state.phase, "backoff", "quota outage outlives the transient budget");
	// Probe ok => ARMED, ladder reset; the no-progress streak survives (not progress).
	const ok = transition({ ...e2.state, noProgressStreak: 3 }, { type: "probeOk" }, T0 + 3 * MIN);
	assert.equal(ok.state.phase, "armed");
	assert.equal(ok.state.backoffKind, null);
	assert.equal(ok.state.backoffRung, 0);
	assert.equal(ok.state.backoffStartMs, null);
	assert.equal(ok.state.noProgressStreak, 3);
	// Backoff does not nudge: tick is a no-op there; progress keeps BACKOFF and clears the streak.
	const bt = transition({ ...e1.state, noProgressStreak: 3 }, { type: "tick", obs: baseObs() }, T0 + 10 * HOUR);
	assert.equal(bt.action.type, "wait");
	assert.equal(bt.state.phase, "backoff");
	assert.equal(bt.state.noProgressStreak, 3, "backoff ticks never count toward the breaker");
	const bp = transition({ ...e1.state, noProgressStreak: 3 }, { type: "progress" }, T0 + MIN);
	assert.equal(bp.state.phase, "backoff");
	assert.equal(bp.state.noProgressStreak, 0);
	// Abort (Esc) during backoff wins => PAUSED; resume starts clean.
	const ab = transition(e2.state, { type: "abort" }, T0 + 2 * MIN);
	assert.equal(ab.state.phase, "paused");
	const rs = transition(ab.state, { type: "resume" }, T0 + 3 * MIN);
	assert.equal(rs.state.phase, "armed");
	assert.equal(rs.state.backoffKind, null);
	assert.equal(rs.state.backoffStartMs, null);
	// watchdog_done is refused during an outage.
	assert.equal(transition(e1.state, { type: "llmDone", obs: { queueOk: true, pickable: 0, childCount: 0 } }, T0).state.phase, "backoff");
}

// Restore: a persisted backoff phase stays backoff with its fields; legacy states without them restore fine.
{
	const r = restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "backoff", backoffKind: "quota", backoffRung: 2, backoffStartMs: 5, noProgressStreak: 2 } }])!;
	assert.deepEqual(r, { ...INITIAL_STATE, phase: "backoff", backoffKind: "quota", backoffRung: 2, backoffStartMs: 5, noProgressStreak: 2 });
	const legacy = restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "armed", noProgressStreak: 1 } }])!;
	assert.deepEqual(legacy, { ...INITIAL_STATE, phase: "armed", noProgressStreak: 1 }, "legacy state without backoff fields restores");
	const bad = restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "backoff", backoffKind: "bogus", backoffRung: "x", backoffStartMs: "y" } }])!;
	assert.deepEqual(bad, { ...INITIAL_STATE, phase: "backoff" }, "invalid backoff fields fall back");
}

// Widget: BACKOFF is yellow, shows the kind and the automatic probe hint.
{
	const lines = watchdogWidgetLines({ phase: "backoff", prep: null, target: "#35", pickable: 2, children: 0, nudgeCount: 0, noProgressStreak: 0, idleMs: 0, pausedReason: null, backoffKind: "quota", backoffRung: 1 })!;
	assert(lines[0]!.includes("\x1b[33m"), "backoff is yellow");
	const txt = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
	assert(txt.includes("BACKOFF (quota)") && txt.includes("probe otomatis"), "backoff widget names the kind and the probe");
}


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
// llmStop from PAUSED/OFF/DONE stays a no-op (EVENT_PHASES matrix covers it; spot-check).
assert.equal(transition(pausedStateFor(), { type: "llmStop", reason: "x" }, 40_005).state.phase, "paused");

const doneClear = { queueOk: true, pickable: 0, childCount: 0 };
const finisher = transition(armed(), { type: "llmDone", obs: doneClear }, 41_000);
assert.equal(finisher.state.phase, "done");
assert.deepEqual(finisher.action, { type: "done" }, "the promise path emits the DONE action");
// watchdog_done (llmDone) is a verified promise: ARMED accepts it too, but only when
// the live observation shows nothing left. The model's claim alone never completes.
{
	const ok = transition(armOK.state, { type: "llmDone", obs: doneClear }, 42_000);
	assert.equal(ok.state.phase, "done", "empty queue: ARMED completes at once, no idle wait");
	assert.deepEqual(ok.action, { type: "done" });
	for (const bad of [
		{ ...doneClear, pickable: 1 },
		{ ...doneClear, childCount: 1 },
		{ ...doneClear, queueOk: false },
	]) {
		const early = transition(armOK.state, { type: "llmDone", obs: bad }, 42_000);
		assert.deepEqual(early.state, armOK.state, `refused promise changes nothing: ${JSON.stringify(bad)}`);
		assert.deepEqual(early.action, { type: "wait" });
		assert.notEqual(doneRefusal(bad), null);
	}
	assert.equal(doneRefusal(doneClear), null);
	assert.equal(finisher.state.pausedReason, null);
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


// 3. Cooldown active (now < nextAllowedAt) → wait, even with pickable work.
const cooling = transition(armed({ nextAllowedAt: T + MIN }), { type: "tick", obs: baseObs() }, T);
assert.deepEqual(cooling.action, { type: "wait" });

// 4. Queue failure → pause; never "done", never an empty-queue interpretation.
const queueFail = transition(armed(), { type: "tick", obs: { ...baseObs(), queueOk: false } }, T);
assert.equal(queueFail.state.phase, "paused");
assert.equal(queueFail.action.type, "pause");

// 5. Frontier 0 + children 0 → the plain nudge (the tick never completes the run; the LLM
// calls watchdog_done). Breaker and hard cap still bound it.
{
	const emptyObs = { ...baseObs(), pickable: 0 };
	const n = transition(armed(), { type: "tick", obs: emptyObs }, T);
	assert.equal(n.state.phase, "armed", "an empty frontier never completes via the tick");
	assert.deepEqual(n.action, { type: "nudge" });
	assert.equal(n.state.nudgeCount, 1);
	assert.equal(n.state.noProgressStreak, 1);
	assert.equal(n.state.nextAllowedAt, T + 3 * MIN);
	assert.equal(transition(n.state, { type: "tick", obs: emptyObs }, T + MIN).action.type, "wait", "cooldown applies");
	assert.equal(transition(armed({ nudgeCount: HARD_CAP }), { type: "tick", obs: emptyObs }, T).state.phase, "paused", "hard cap still gates it");
	assert.equal(transition(armed({ noProgressStreak: BREAKER_K }), { type: "tick", obs: emptyObs }, T).state.phase, "paused", "breaker still gates it");
	let nudges = 0;
	let ph: DrainState = armed();
	let t8 = T;
	for (let i = 0; i < 40; i++) {
		const r = transition(ph, { type: "tick", obs: emptyObs }, t8);
		if (r.action.type === "nudge") nudges++;
		assert.notEqual(r.action.type, "done", "the tick never emits done");
		ph = r.state;
		t8 = Math.max(t8, ph.nextAllowedAt);
	}
	assert.equal(ph.phase, "paused", "an unanswered empty-frontier nudge ends in the breaker pause");
	assert(nudges >= 1 && nudges <= BREAKER_K);
	assert(buildNudgeText({ target: "#38", pickable: 0 }).includes("finish any closing steps (merge, PR, cleanup), then call watchdog_done; do not open new work"));
	assert(buildNudgeText({ target: "#38", pickable: 2 }).includes("watchdog_done"));
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

// 9. Without a provider-error event, an idle armed tick nudges.
assert.deepEqual(transition(armed(), { type: "tick", obs: baseObs() }, T).action, { type: "nudge" });

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
const done = transition(armed(), { type: "llmDone", obs: { queueOk: true, pickable: 0, childCount: 0 } }, T);
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
	const phases = ["off", "armed", "backoff", "paused", "done"] as const;
	const events: DrainEvent[] = [
		{ type: "arm", queueOk: true, pickable: 3 },
		{ type: "off" },
		{ type: "resume" },
		{ type: "abort" },
		{ type: "tick", obs: baseObs() },
		{ type: "providerError", kind: "transient" },
		{ type: "probeOk" },
		{ type: "llmStop" },
		{ type: "llmDone", obs: { queueOk: true, pickable: 0, childCount: 0 } },
		{ type: "progress" },
	];
	// Phases allowed to act per event; everything else must be a pure no-op.
	const owners: Record<string, readonly string[]> = {
		arm: ["off"],
		off: ["armed", "backoff", "paused"],
		resume: ["paused"],
		abort: ["armed", "backoff"],
		tick: ["armed"],
		providerError: ["armed", "backoff"],
		probeOk: ["backoff"],
		llmStop: ["armed", "backoff"],
		llmDone: ["armed"],
		progress: ["armed", "backoff"],
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
	assert.ok(checked > 15);
	// Resume from OFF never arms (arming needs the arm event and its refusal check).
	assert.equal(transition(INITIAL_STATE, { type: "resume" }, T).state.phase, "off");
	// Only resume leaves PAUSED.
	const pausedS: DrainState = { ...INITIAL_STATE, phase: "paused", pausedReason: "x" };
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
	assert.deepEqual(upsertTickets([tk("A", "limbo")], [{ id: "A", reason: "edited" }]).closed, ["A"], "a reason edit on an already-limbo ticket still flags the live child");
	assert.deepEqual(upsertTickets([tk("A")], [{ id: "A", reason: "edited" }]).closed, [], "an open ticket edit flags nothing");
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
}


// --- Tool gate (#31) ---------------------------------------------------------------------------

// Gate: a child can never invoke any ticket/stop/done tool, from any phase; a live run passes.
for (const kind of ["complete", "handoff", "sync", "stop", "done"] as const) {
	for (const phase of ["off", "armed", "paused", "done"] as const) {
		assert.deepEqual(watchdogToolGate(kind, true, phase), { ok: false, error: `watchdog_${kind} is main-session only; child sessions cannot invoke it` }, `child blocked: ${kind} at ${phase}`);
	}
	// No active run (off/done): an error result, never a silent success.
	assert.equal(watchdogToolGate(kind, false, "off").ok, false);
	assert.equal(watchdogToolGate(kind, false, "done").ok, false);
	assert.deepEqual(watchdogToolGate(kind, false, "armed"), { ok: true });
}
assert.deepEqual(watchdogToolGate("stop", false, "paused"), { ok: true });
// The off/done error names the situation and the way out.
assert(JSON.stringify(watchdogToolGate("stop", false, "done")).includes("no active watchdog run"));

// --- Child sessions ----------------------------------------------------------------------------

assert.equal(isChildSession({ PI_SUBAGENT_ID: "abc" }), true);
assert.equal(isChildSession({ PI_SUBAGENT_ID: "" }), false);
assert.equal(isChildSession({}), false);
// NOTE (recorded): the core never branches on child status; the factory test
// below proves the child-session no-op end to end.

// --- Live-loop helpers (#30) --------------------------------------------------

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
const baseView = { phase: "armed" as const, prep: null, target: "#35", pickable: 2, children: 1, nudgeCount: 3, noProgressStreak: 1, idleMs: 42_000, pausedReason: null, backoffKind: null, backoffRung: 0 };
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
assert(nudge.includes("Do not implement a ticket yourself") && nudge.includes("standards-reviewer") && nudge.includes("deep-reviewer") && nudge.includes("overlap"), "nudge demands the per-ticket implementer/reviewer pipeline, overlapping across tickets");

// Restore: latest valid entry wins, garbage never half-applies.
assert.equal(restoreDrainState([]), null);
assert.equal(restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "bogus" } }]), null);
assert.equal(restoreDrainState([{ type: "custom", customType: "other", data: { phase: "armed" } }]), null);
assert.equal(restoreDrainState([{ type: "message", role: "user" }]), null);
const restoredArmed = { phase: "armed", noProgressStreak: 2, nudgeCount: 5, nextAllowedAt: 123, pausedReason: null };
assert.deepEqual(restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "off" } }, { type: "custom", customType: "drain-watchdog-state", data: restoredArmed }]), { ...INITIAL_STATE, ...restoredArmed }, "latest entry wins");
assert.deepEqual(restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "armed", nudgeCount: "30" } }]), { ...INITIAL_STATE, phase: "armed", nudgeCount: 0 }, "corrupted field types fall back, phase survives");
assert.equal(restoreDrainState([null, "x", { type: "custom", customType: "drain-watchdog-state" }]), null, "entry without data is ignored");
// H4: `typeof value === typeof fallback` broke every nullable field, because
// `typeof null === "object"` never matches a real persisted string/number. A
// restored PAUSED run must keep its reason.
const restoredPaused = { phase: "paused", pausedReason: "stopped for test" };
assert.deepEqual(
	restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: restoredPaused }]),
	{ ...INITIAL_STATE, ...restoredPaused },
	"restored PAUSED keeps its non-null pausedReason",
);
// A field that explicitly persisted as null still restores to null.
assert.deepEqual(
	restoreDrainState([{ type: "custom", customType: "drain-watchdog-state", data: { phase: "armed", pausedReason: null, lastStallNotifyAt: null } }]),
	{ ...INITIAL_STATE, phase: "armed" },
	"an explicit null still restores to null",
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
	(globalThis as any).setTimeout = (fn: (...args: unknown[]) => unknown, delay: number, ...args: unknown[]) => {
		const t: FakeTimer = { id: nextId++, kind: "timeout", fire: () => fn(...args), cleared: false, delay };
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
	// armed()'s idle-grace gate (`now - idleSinceMs < IDLE_GRACE_MS`) and the stall/cooldown
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
			// The PREP -> arm flow asks once; interactive rows need an answer.
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
const plainWidget = (h: Harness) => (h.widget() ?? []).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
const persistedLatest = (entries: unknown[]) =>
	entries.filter((e: any) => e.customType === "drain-watchdog-state").at(-1) as { data: Record<string, any> };

// Restoring a persisted "backoff" run: restored as backoff, ONE probe timer + the tick interval, no nudge.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry({ phase: "backoff", backoffKind: "quota", backoffRung: 1, backoffStartMs: Date.now() }));
		h.handlers.session_start({}, h.ctx);
		const live = timers.filter((t) => !t.cleared);
		assert.equal(live.filter((t) => t.kind === "timeout").length, 1, "restoring backoff re-arms exactly one probe timer");
		assert.equal(live.filter((t) => t.kind === "interval").length, 1, "restoring backoff keeps the tick interval");
		assert(h.audits.some((x) => x.type === "restored" && x.data.phase === "backoff"), "backoff restore is audited");
		assert(!h.notifications.some((n) => n.message.includes("restored PAUSED")), "backoff is not restored as paused");
		// Ticks never act in BACKOFF.
		clock.advance(IDLE_GRACE_MS + 1000);
		live.find((t) => t.kind === "interval")!.fire();
		await flush();
		assert.equal(h.sent.length, 0, "a restored backoff run is not nudged");
		// The probe fires a steer and only while still in backoff.
		live.find((t) => t.kind === "timeout")!.fire();
		assert.equal(h.sent.length, 1);
		assert.equal(h.sent[0]!.customType, "drain-watchdog-probe");
		assert.equal(h.sent[0]!.content, PROBE_TEXT);
	}),
);

// Restoring a PAUSED run: exactly one warning notify with the reason, one paused audit, no timers.
await withNoAmbientSubagent(() =>
	withFakeTimers((timers) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push({ type: "custom", customType: "drain-watchdog-state", data: { phase: "paused", pausedReason: "stopped for test" } });
		h.handlers.session_start({}, h.ctx);
		const pausedNotes = h.notifications.filter((n) => n.message.includes("restored PAUSED"));
		assert.equal(pausedNotes.length, 1, "restored paused run notifies exactly once");
		assert(pausedNotes[0]!.message.includes("stopped for test"), "notify carries the pause reason");
		assert.equal(h.audits.filter((x) => x.type === "restored" && x.data.phase === "paused").length, 1, "one paused restore audit");
		assert(!h.notifications.some((n) => n.message.includes("restored live run")), "paused run is not restored as live");
		assert.equal(timers.filter((t) => !t.cleared).length, 0, "paused restore starts no timer");
	}),
);

// M5(b): session_start restoring an ARMED run starts only the tick interval, and a tick
// that observes idle+pickable-work delivers a nudge
// through the real pi.sendMessage/appendEntry surface, reading the persisted ticket
// tree (no tracker call).
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		const live = timers.filter((t) => !t.cleared);
		assert.equal(live.filter((t) => t.kind === "interval").length, 1, "restoring ARMED starts the tick interval");
		assert.equal(live.filter((t) => t.kind === "timeout").length, 0, "restoring ARMED schedules no extra timer");
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

// M1/M5(b): session_shutdown clears every live timer so no pending tick survives
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
		assert(String(noop.content[0].text).includes(SYNC_REMINDER), "a no-op sync carries the reminder");
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
		assert(!again.isError, "watchdog_done after DONE (repeat call after DONE) is not an error");
		assert(String(again.content[0].text).includes("already complete") && String(again.content[0].text).includes("DONE: 1 done, 1 limbo"), "it returns the report and says the run is complete");
		assert.equal(persistedLatest(h.entries).data.phase, "done", "the repeat call changes nothing");
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

// --- Errored runs (harness): agent_end records, agent_settled decides (backoff + probe) -------------------------------

const errEnd = (errorMessage: string) => ({ messages: [{ role: "user" }, { role: "assistant", stopReason: "error", errorMessage }] });
const okEnd = { messages: [{ role: "assistant", stopReason: "stop" }] };
// pi emits agent_end per attempt; the decision happens at settle.
const settle = async (h: Harness, end?: { messages: unknown[] }) => {
	if (end !== undefined) h.handlers.agent_end(end);
	await h.handlers.agent_settled({ aborted: false, messages: [] }, h.ctx);
};
const liveTimeouts = (timers: FakeTimer[]) => timers.filter((t) => t.kind === "timeout" && !t.cleared);
// A one-shot timeout is spent once it fires (the fake does not retire it on its own).
const fireProbe = (timers: FakeTimer[]) => {
	const t = liveTimeouts(timers)[0]!;
	t.cleared = true;
	t.fire();
};

await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		const tickTimer = timers.find((t) => t.kind === "interval" && !t.cleared)!;
		assert.equal(liveTimeouts(timers).length, 0, "armed: no probe timer yet");

		// 502 => BACKOFF (transient), exactly one probe timer, audited, visible.
		await settle(h, errEnd("502 Bad Gateway"));
		assert.equal(persistedLatest(h.entries).data.phase, "backoff");
		assert.equal(persistedLatest(h.entries).data.backoffKind, "transient");
		assert.equal(liveTimeouts(timers).length, 1, "backoff arms ONE probe timer");
		assert(h.audits.some((a) => a.type === "probe-scheduled" && a.data.delayMs === MIN), "probe scheduled on the first rung");
		assert(h.notifications.some((n) => n.message.includes("BACKOFF")), "backoff is visible");
		assert(plainWidget(h).includes("BACKOFF"), "widget shows BACKOFF");

		// Ticks in backoff neither nudge nor count toward the breaker / hard cap.
		for (let i = 0; i < BREAKER_K + 2; i++) {
			clock.advance(31 * MIN);
			tickTimer.fire();
			await flush();
		}
		assert.equal(h.sent.length, 0, "no nudge while in backoff");
		assert.equal(persistedLatest(h.entries).data.noProgressStreak, 0);
		assert.equal(persistedLatest(h.entries).data.nudgeCount, 0);

		// Probe fires a steer; a second error escalates the rung and re-arms ONE timer.
		fireProbe(timers);
		assert.deepEqual(h.sent.map((m) => m.customType), ["drain-watchdog-probe"]);
		await settle(h, errEnd("503"));
		assert.equal(persistedLatest(h.entries).data.backoffRung, 1, "probe error escalates the rung");
		assert.equal(liveTimeouts(timers).length, 1, "still exactly one probe timer");

		// Probe fires again; its successful turn returns to ARMED and resets the ladder.
		fireProbe(timers);
		await settle(h, okEnd);
		const back = persistedLatest(h.entries).data;
		assert.equal(back.phase, "armed");
		assert.equal(back.backoffRung, 0);
		assert.equal(back.backoffStartMs, null);
		// A success that was NOT a probe does nothing in armed; an error again re-enters backoff.
		await settle(h, okEnd);
		assert.equal(persistedLatest(h.entries).data.phase, "armed");

		// Normal nudging works again after recovery.
		clock.advance(IDLE_GRACE_MS + 1000);
		tickTimer.fire();
		await flush();
		await flush();
		assert.equal(h.sent.filter((m) => m.customType === "drain-watchdog-nudge").length, 1, "nudges resume after the outage");
	}),
);

// Any successful settled run in backoff (not only a probe run) returns to ARMED and clears the probe timer.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		await settle(h, errEnd("429 insufficient_quota"));
		assert.equal(persistedLatest(h.entries).data.backoffKind, "quota");
		assert.equal(liveTimeouts(timers).length, 1);
		await settle(h, okEnd);
		assert.equal(persistedLatest(h.entries).data.phase, "armed", "a non-probe success ends the outage");
		assert.equal(persistedLatest(h.entries).data.backoffRung, 0);
		assert.equal(persistedLatest(h.entries).data.backoffStartMs, null);
		assert.equal(liveTimeouts(timers).length, 0, "the probe timer is cleared");
	}),
);

// pi emits agent_end per retried attempt: 4 failed attempts + 1 settle = ONE escalation (rung 0);
// a retry that succeeds (last agent_end ok) is not an error; agent_start / abort drop a recorded error.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		for (let i = 0; i < 4; i++) h.handlers.agent_end(errEnd("503"));
		assert.equal(persistedLatest(h.entries).data.phase, "armed", "agent_end alone decides nothing");
		await settle(h);
		assert.equal(persistedLatest(h.entries).data.phase, "backoff");
		assert.equal(persistedLatest(h.entries).data.backoffRung, 0, "one escalation, not four");
		assert.equal(liveTimeouts(timers).length, 1);

		// Failed attempt then successful retry in one run: the last attempt wins.
		h.handlers.agent_end(errEnd("503"));
		await settle(h, okEnd);
		assert.equal(persistedLatest(h.entries).data.phase, "armed", "successful retry ends the outage");

		// A recorded error does not leak into the next run (agent_start) or past an abort.
		h.handlers.agent_end(errEnd("503"));
		h.handlers.agent_start();
		await settle(h);
		assert.equal(persistedLatest(h.entries).data.phase, "armed", "agent_start clears the recorded error");
		h.handlers.agent_end(errEnd("503"));
		await h.handlers.agent_settled({ aborted: true, messages: [] }, h.ctx);
		await settle(h);
		assert.equal(persistedLatest(h.entries).data.phase, "paused", "abort pauses; the cleared error never escalates");
		assert.equal(persistedLatest(h.entries).data.backoffRung, 0);
	}),
);

// Probe fires but no run starts (no agent_end): a fallback probe at the CURRENT rung keeps exactly one timer pending.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		await settle(h, errEnd("503"));
		await settle(h, errEnd("503"));
		assert.equal(persistedLatest(h.entries).data.backoffRung, 1);
		fireProbe(timers);
		assert.equal(h.sent.length, 1);
		assert.equal(liveTimeouts(timers).length, 1, "fallback probe pending after an unanswered probe");
		assert.equal(persistedLatest(h.entries).data.backoffRung, 1, "fallback does not escalate");
		assert.equal(liveTimeouts(timers)[0]!.delay, 2 * MIN, "fallback uses the current rung delay");
		fireProbe(timers);
		assert.equal(h.sent.length, 2, "the fallback probe fires again");
		assert.equal(liveTimeouts(timers).length, 1);
	}),
);

// Auth => PAUSED immediately with a reason; no probe timer.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		await settle(h, errEnd("401 unauthorized"));
		const latest = persistedLatest(h.entries).data;
		assert.equal(latest.phase, "paused");
		assert.equal(latest.pausedReason, "provider auth error; needs human");
		assert.equal(timers.filter((t) => !t.cleared).length, 0, "auth pause clears every timer");
		assert(h.notifications.some((n) => n.message.includes("PAUSED")));
	}),
);

// Outage budget exceeded => PAUSED with reason, probe timer gone.
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, _flush, clock) => {
		const h = makeHarness(makeFixtureCwd());
		h.entries.push(armedEntry());
		h.handlers.session_start({}, h.ctx);
		await settle(h, errEnd("503"));
		clock.advance(TRANSIENT_OUTAGE_BUDGET_MS);
		await settle(h, errEnd("503"));
		const latest = persistedLatest(h.entries).data;
		assert.equal(latest.phase, "paused");
		assert.equal(latest.pausedReason, "provider outage budget exhausted");
		assert.equal(liveTimeouts(timers).length, 0);
	}),
);

// Abort during backoff => PAUSED (probe timer cleared); resume => ARMED; off / stop / shutdown also clear the probe timer.
for (const how of ["abort", "off", "stop", "shutdown", "resume-path"] as const) {
	await withNoAmbientSubagent(() =>
		withFakeTimers(async (timers) => {
			const h = makeHarness(makeFixtureCwd());
			h.entries.push(armedEntry());
			h.handlers.session_start({}, h.ctx);
			await settle(h, errEnd("503"));
			assert.equal(liveTimeouts(timers).length, 1, `${how}: probe timer armed`);
			if (how === "abort") {
				await h.handlers.agent_settled({ aborted: true, messages: [] }, h.ctx);
				assert.equal(persistedLatest(h.entries).data.phase, "paused", "abort during backoff pauses");
			} else if (how === "off") {
				await h.handlers["command:watchdog"]("off", h.ctx);
				assert.equal(persistedLatest(h.entries).data.phase, "off");
			} else if (how === "stop") {
				await h.tools.watchdog_stop!.execute("s", { reason: "env broke" }, undefined, undefined, h.ctx);
				assert.equal(persistedLatest(h.entries).data.phase, "paused");
			} else if (how === "shutdown") {
				h.handlers.session_shutdown();
			} else {
				await h.handlers.agent_settled({ aborted: true, messages: [] }, h.ctx);
				await h.handlers["command:watchdog"]("resume", h.ctx);
				assert.equal(persistedLatest(h.entries).data.phase, "armed");
				assert.equal(persistedLatest(h.entries).data.backoffKind, null, "resume clears the outage");
			}
			assert.equal(liveTimeouts(timers).length, 0, `${how}: probe timer cleared`);
			if (how === "shutdown") {
				// A late agent_end after teardown must not re-arm anything.
				await settle(h, errEnd("503"));
				assert.equal(liveTimeouts(timers).length, 0, "no probe timer after shutdown");
			}
		}),
	);
}


// --- #38 the LLM decides completion: no executor state, no FINALIZING -------------------------

const drainedTickets = [tk("T1", "done"), tk("T2", "done")];

// restoreRunTarget: the run target is an opaque non-empty string riding the state entry.
assert.equal(restoreRunTarget([armedEntry({ runTarget: "#38" })]), "#38", "a restored run keeps its target");
assert.equal(restoreRunTarget([armedEntry({ runTarget: "#38" }), armedEntry({ runTarget: "#40" })]), "#40", "latest entry wins");
assert.equal(restoreRunTarget([armedEntry({ runTarget: 38 })]), null, "a non-string target degrades to null");
assert.equal(restoreRunTarget([armedEntry({ runTarget: "  " })]), null, "an empty id is not a target");
assert.equal(restoreRunTarget([]), null);
assert.equal(restoreRunTarget([{ type: "message", role: "user" }]), null);

/** Runs one PREP -> watchdog_target -> confirm cycle on an existing harness
 *  through the real production path, then completes both tickets (empty frontier). */
async function prepAgain(h: Harness, ref: string) {
	await h.handlers["command:watchdog"]("", h.ctx);
	await h.tools.watchdog_target!.execute("p1", { issue: ref, tickets: [{ id: "T1" }, { id: "T2", blockedBy: ["T1"] }] }, undefined, undefined, h.ctx);
	await h.handlers.agent_settled({ aborted: false, messages: [] }, h.ctx);
	await h.tools.watchdog_complete!.execute("p2", { id: "T1" }, undefined, undefined, h.ctx);
	await h.tools.watchdog_complete!.execute("p3", { id: "T2" }, undefined, undefined, h.ctx);
}

// Live: a drained ARMED run, idle past the grace gate. The tick NEVER completes it: it
// sends the closing nudge (breaker/hard-cap still bound it); the run stays ARMED until the
// model calls watchdog_done. No executor state is read (the fixture dir has none).
await withNoAmbientSubagent(() =>
	withFakeTimers(async (timers, flush, clock) => {
		const cwd = makeFixtureCwd();
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
			assert.equal(persistedLatest(h.entries).data.phase, "armed", "an empty-frontier idle tick does not complete the run");
			assert.equal(h.sent.length, 1, "it sends exactly one nudge");
			assert.equal(h.sent[0]!.customType, "drain-watchdog-nudge");
			assert.equal(h.sent[0]!.content, buildNudgeText({ target: "#38", pickable: 0 }), "the nudge is the closing text");
			assert(String(h.sent[0]!.content).includes("finish any closing steps (merge, PR, cleanup), then call watchdog_done; do not open new work"));
			assert(!h.audits.some((a) => a.type === "done" || a.type === "finalize-nudge" || a.type === "closing-signal-anomaly"));
			// The cooldown/breaker still bound it: next tick inside the cooldown waits.
			tickTimer.fire();
			await flush();
			assert.equal(h.sent.length, 1, "inside the cooldown no second nudge");
			// The model decides: watchdog_done completes at once.
			const res = await h.tools.watchdog_done!.execute("d1", {}, undefined, undefined, h.ctx);
			assert(!res.isError, "watchdog_done is accepted from ARMED with nothing pickable and no child");
			assert.equal(persistedLatest(h.entries).data.phase, "done");
			assert(h.audits.some((a) => a.type === "done"), "the DONE is audited");
			assert(h.notifications.some((n) => n.message.includes("DONE")), "DONE notifies");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	}),
);

// Live (production arm path): the run target is persisted, off/DONE clear it, and an
// unusable (blank) target id is refused by watchdog_target.
await withNoAmbientSubagent(() =>
	withFakeTimers(async () => {
		const cwd = makeFixtureCwd();
		try {
			const h = makeHarness(cwd);
			h.handlers.session_start({}, h.ctx);
			await prepAgain(h, "#38");
			assert(h.audits.some((a) => a.type === "armed"), "confirm armed the run");
			assert.equal(restoreRunTarget(h.entries), "#38", "the armed run persists its target");
			const done = await h.tools.watchdog_done!.execute("d1", {}, undefined, undefined, h.ctx);
			assert(!done.isError, "empty frontier: watchdog_done accepted");
			h.handlers["command:watchdog"]("status", h.ctx);
			assert(!h.notifications.at(-1)!.message.includes("run target"), "DONE clears the run target (status proves it)");
			await h.handlers["command:watchdog"]("", h.ctx);
			const blank = await h.tools.watchdog_target!.execute("b1", { issue: "   ", tickets: [{ id: "T1" }] }, undefined, undefined, h.ctx);
			assert.equal(blank.isError, true, "a blank target id is refused");
			assert(String(blank.content[0].text).includes("not a usable target id"));
		} finally {
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
assert(mainPi.events.includes("agent_settled"), "main factory handles Esc and the arm confirm");
assert(mainPi.events.includes("agent_end"), "main factory watches run outcomes for provider errors");
assert(!mainPi.events.includes("tick"), "no timer surfaces: ticks are setInterval-internal and only started on arm");

if (ambientSubagentId === undefined) delete process.env.PI_SUBAGENT_ID;
else process.env.PI_SUBAGENT_ID = ambientSubagentId;

// Discovery (live): /watchdog asks the MODEL to find the target and its ticket tree (no
// scan, no tracker call, no ui.select/ui.input); the operator's pick returns through
// watchdog_target, which proves the tree and starts the arm step. The tool is refused
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
			assert(!h.userMessages[0].includes("confirm arming"), "no arm step before a target exists");
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
			// processing", so the PREP instruction rides the tool result instead.
			assert.equal(h.userMessages.length, 1, "the tool path sends no user message");
			assert(ok.content[0].text.includes("KRIPT-222") && ok.content[0].text.includes("confirm arming"), "the PREP instruction is the tool result");

			const again = await h.tools.watchdog_target!.execute("d2", { issue: "KRIPT-300", tickets: tree38 }, undefined, undefined, h.ctx);
			assert(again.isError, "one pick per discovery request");

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
