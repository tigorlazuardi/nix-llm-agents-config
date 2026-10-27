/**
 * drain-watchdog pure decision core.
 *
 * Every function here is deterministic and side-effect free: no network, no
 * clock, no subprocesses, no pi API. The extension factory, timers, and Nix
 * module options that drive these decisions are ticket #30; this module is the
 * single pure seam the self-check asserts against (plans/drain-watchdog
 * flow.html sections 1-4, 6, 10).
 *
 * Semantics locked by the design:
 *  - Esc/abort always wins and moves to PAUSED; it never auto-resumes.
 *  - Child sessions (PI_SUBAGENT_ID set) are always a no-op for callers.
 *  - A queue command that fails, prints garbage, or prints multiple numbers
 *    refuses/pauses; it is never interpreted as "done" or an empty queue
 *    (docs/agents/issue-tracker.md refusal rule).
 *  - Tick order is fixed and the nudge is the last resort.
 *
 * ponytail: ladder lengths, breaker/hard-cap thresholds, and stall/idle
 * budgets are fixed design defaults baked in below; make them env-tunable
 * when the ticket #30 factory wires sessionVariables.
 */

// --- Types -------------------------------------------------------------------

export type DrainPhase = "off" | "armed" | "backoff" | "paused" | "done" | "finalizing";

export type ProviderErrorKind = "transient" | "quota" | "auth" | "unknown";

export type DrainState = {
	phase: DrainPhase;
	/** Consecutive nudges/unknown errors without any progress event. */
	noProgressStreak: number;
	/** Total nudges this run — hard-cap budget. */
	nudgeCount: number;
	/** Earliest wall-clock ms a next nudge may fire (nudge backoff ladder). */
	nextAllowedAt: number;
	backoffKind: "transient" | "quota" | null;
	backoffRung: number;
	/** When the current outage (BACKOFF stretch) started, for the outage budget. */
	backoffStartMs: number | null;
	pausedReason: string | null;
};

export type TickObservation = {
	/** Main is mid-run or has pending messages / a blocking UI prompt. */
	running: boolean;
	pendingMessages: boolean;
	childCount: number;
	/** How long every activity source has been quiet. */
	allIdleForMs: number;
	queueOk: boolean;
	pickable: number;
	inflight: number;
	/** Time since the last counted progress event (queue change, steer, handoff). */
	progressAgeMs: number;
	/** Error message from the last ended run, if it ended in error. */
	lastError: string | null;
	/** Remaining ready work is blocked only by non-agent tickets. */
	leftoverBlocked: boolean;
	/** The flow has closing steps (code-review, PR, cleanup) still to run. */
	hasClosingSteps: boolean;
};

export type DrainAction =
	| { type: "wait" }
	| { type: "nudge" }
	| { type: "finalizeNudge" }
	| { type: "stallNotify" }
	| { type: "pause"; reason: string }
	| { type: "done"; leftovers: boolean }
	| { type: "probe"; delayMs: number };

export type DrainEvent =
	| { type: "arm"; queueOk: boolean; pickable: number }
	| { type: "off" }
	| { type: "resume" }
	| { type: "abort" }
	| { type: "tick"; obs: TickObservation }
	| { type: "providerError"; kind: ProviderErrorKind }
	| { type: "probeOk" }
	| { type: "llmStop" }
	| { type: "llmDone" }
	| { type: "handoffRecorded" }
	| { type: "completionSteer" }
	| { type: "progress" }
	| { type: "nudge" }
	| { type: "breaker" }
	| { type: "hardCap" };

export type DrainTransition = {
	state: DrainState;
	action: DrainAction;
	refusal: string | null;
};

// --- Design-default parameters -----------------------------------------------

export const IDLE_GRACE_MS = 3 * 60_000;
export const STALL_LIMIT_MS = 45 * 60_000;
export const BREAKER_K = 4;
export const HARD_CAP = 30;
export const SPLIT_DEPTH_CAP = 5;
export const STANDARDS_REVIEW_BUDGET_MS = 10 * 60_000;
export const SPEC_REVIEW_BUDGET_MS = 20 * 60_000;
export const TRANSIENT_OUTAGE_BUDGET_MS = 6 * 3_600_000;
export const QUOTA_OUTAGE_BUDGET_MS = 12 * 3_600_000;

/** Nudge backoff ladder in minutes, capped at the last rung. */
const NUDGE_LADDER_MIN = [3, 6, 12, 24, 30];
/** Provider backoff ladders in minutes, capped at the last rung. */
const TRANSIENT_LADDER_MIN = [1, 2, 5, 10, 20, 30];
const QUOTA_LADDER_MIN = [30, 60, 120, 180];

// --- Initial state -----------------------------------------------------------

export const INITIAL_STATE: DrainState = {
	phase: "off",
	noProgressStreak: 0,
	nudgeCount: 0,
	nextAllowedAt: 0,
	backoffKind: null,
	backoffRung: 0,
	backoffStartMs: null,
	pausedReason: null,
};

// --- Queue command output parsing ---------------------------------------------

export type QueueParse = { ok: boolean; count: number | null };

/**
 * Accept exactly one non-negative integer on stdout (exit 0). Anything else —
 * non-zero exit, empty output, garbage, multiple numbers — refuses. Refusal is
 * never "done": the caller pauses or fails to arm.
 */
export function parseQueueOutput(stdout: string, exitCode: number): QueueParse {
	if (exitCode !== 0) return { ok: false, count: null };
	const trimmed = stdout.trim();
	if (!/^\d+$/.test(trimmed)) return { ok: false, count: null };
	return { ok: true, count: Number.parseInt(trimmed, 10) };
}

// --- Arm gating ---------------------------------------------------------------

/** Refusal reason for arming, or null when the run may arm. */
export function armRefusal(pickable: number, queueOk: boolean): string | null {
	if (!queueOk) return "drain-queue command failed; refusing to arm";
	if (pickable <= 0) return "no pickable work (pickable = 0); refusing to arm";
	return null;
}

// --- Child sessions -----------------------------------------------------------

/**
 * Child sessions never run the watchdog: no timers, no nudges, no state.
 * Callers no-op when this returns true.
 */
export function isChildSession(env: Record<string, string | undefined>): boolean {
	return Boolean(env.PI_SUBAGENT_ID);
}

// --- Provider error classification ---------------------------------------------

const TRANSIENT_PATTERNS = [
	/overloaded/i,
	/high demand/i,
	/rate limit/i,
	/\b429\b/,
	/\b5\d\d\b/,
	/\b520\b/,
	/\b524\b/,
	/service unavailable/i,
	/network/i,
	/fetch failed/i,
	/\bENOTFOUND\b/,
	/\bEAI_AGAIN\b/,
	/socket hang up/i,
	/tim(e)?out/i,
	/timed out/i,
];

const QUOTA_PATTERNS = [
	/usage limit/i,
	/insufficient_quota/i,
	/available balance/i,
	/out of budget/i,
	/quota exceeded/i,
	/billing/i,
];

const AUTH_PATTERNS = [/\b401\b/, /\b403\b/, /invalid api key/i, /unauthorized/i];

/**
 * Classification order mirrors the design chart (retryable → quota → auth →
 * unknown). Returned kind drives the ladder: auth pauses immediately, unknown
 * rides the transient ladder but counts toward the breaker.
 */
export function classifyProviderError(message: string): ProviderErrorKind {
	if (TRANSIENT_PATTERNS.some((re) => re.test(message))) return "transient";
	if (QUOTA_PATTERNS.some((re) => re.test(message))) return "quota";
	if (AUTH_PATTERNS.some((re) => re.test(message))) return "auth";
	return "unknown";
}

// --- Backoff ladders -----------------------------------------------------------

/**
 * Base delay for a backoff rung in ms; rungs beyond the ladder clamp to the
 * last step. Deterministic on purpose — ±20% jitter is the effect layer's job.
 */
export function nextLadderDelayMs(kind: "transient" | "quota", rung: number): number {
	const ladder = kind === "quota" ? QUOTA_LADDER_MIN : TRANSIENT_LADDER_MIN;
	const index = Math.min(Math.max(rung, 0), ladder.length - 1);
	return ladder[index] * 60_000;
}

function nudgeLadderDelayMs(nudgeNumber: number): number {
	const index = Math.min(Math.max(nudgeNumber - 1, 0), NUDGE_LADDER_MIN.length - 1);
	return NUDGE_LADDER_MIN[index] * 60_000;
}

// --- SPLIT predicate ------------------------------------------------------------

export type ReviewAxis = "standards" | "spec";

/**
 * SPLIT rule: only a review that FINISHED with FAIL after exceeding its axis
 * budget (10 min standards, 20 min spec) splits, and only while depth < cap.
 * FAIL within budget goes to the fix loop; PASS never splits; a hung review
 * (no verdict) never splits — stall detection covers it.
 */
export function shouldSplit(
	axis: ReviewAxis,
	verdict: "pass" | "fail" | null | undefined,
	durationMs: number,
	splitDepth: number,
): boolean {
	if (verdict !== "fail") return false;
	if (splitDepth >= SPLIT_DEPTH_CAP) return false;
	const budget = axis === "spec" ? SPEC_REVIEW_BUDGET_MS : STANDARDS_REVIEW_BUDGET_MS;
	return durationMs > budget;
}

// --- State machine ---------------------------------------------------------------

const WAIT: DrainAction = { type: "wait" };
const idleTransition = (state: DrainState): DrainTransition => ({ state, action: WAIT, refusal: null });
const pausedTransition = (state: DrainState, reason: string, action: DrainAction): DrainTransition => ({
	state,
	action,
	refusal: null,
});

function enterBackoff(
	state: DrainState,
	kind: "transient" | "quota",
	now: number,
	runProgress: boolean,
): DrainTransition {
	const delayMs = nextLadderDelayMs(kind, runProgress ? state.backoffRung + 1 : 0);
	return {
		state: {
			...state,
			phase: "backoff",
			backoffKind: kind,
			backoffRung: runProgress ? state.backoffRung + 1 : 0,
			backoffStartMs: state.backoffStartMs ?? now,
			pausedReason: null,
			nextAllowedAt: now,
		},
		action: { type: "probe", delayMs },
		refusal: null,
	};
}

function handleTick(state: DrainState, obs: TickObservation, now: number): DrainTransition {
	// Cycle-start activity: legitimately busy; the effect layer resets the idle clock.
	if (obs.running || obs.pendingMessages) return idleTransition(state);
	// Idle grace shields steer deliveries that just landed.
	if (obs.allIdleForMs < IDLE_GRACE_MS) return idleTransition(state);
	// Nudge cooldown (design order: cooldown gate sits before the queue observation).
	if (now < state.nextAllowedAt) return idleTransition(state);

	if (!obs.queueOk) {
		return pausedTransition({ ...state, phase: "paused", pausedReason: "queue command failed" }, "queue command failed", {
			type: "pause",
			reason: "queue command failed",
		});
	}

	// Terminal branch first: frontier 0, nothing in flight, no children.
	if (obs.pickable <= 0 && obs.inflight <= 0 && obs.childCount <= 0) {
		if (obs.leftoverBlocked) {
			return {
				state: { ...state, phase: "done" },
				action: { type: "done", leftovers: true },
				refusal: null,
			};
		}
		if (obs.hasClosingSteps) {
			const delayMs = nudgeLadderDelayMs(state.nudgeCount + 1);
			return {
				state: { ...state, phase: "finalizing", nextAllowedAt: now + delayMs },
				action: { type: "finalizeNudge" },
				refusal: null,
			};
		}
		return { state: { ...state, phase: "done" }, action: { type: "done", leftovers: false }, refusal: null };
	}

	// Children running: observe only. A stall notifies; it never nudges the main.
	if (obs.childCount > 0) {
		if (obs.progressAgeMs >= STALL_LIMIT_MS) {
			return { state, action: { type: "stallNotify" }, refusal: null };
		}
		return idleTransition(state);
	}

	// Provider error on the last ended run hands over to the backoff path.
	if (obs.lastError !== null) {
		const kind = classifyProviderError(obs.lastError);
		if (kind === "auth") {
			const reason = "provider auth error; needs human";
			return pausedTransition({ ...state, phase: "paused", pausedReason: reason }, reason, {
				type: "pause",
				reason,
			});
		}
		const nextStreak = kind === "unknown" ? state.noProgressStreak + 1 : state.noProgressStreak;
		if (nextStreak >= BREAKER_K) {
			const reason = "repeated unknown provider errors with no progress";
			return pausedTransition(
				{ ...state, phase: "paused", pausedReason: reason, noProgressStreak: nextStreak },
				reason,
				{ type: "pause", reason },
			);
		}
		const entered = enterBackoff({ ...state, noProgressStreak: nextStreak }, kind === "quota" ? "quota" : "transient", now, false);
		return entered;
	}

	// Breaker / hard cap before any further nudge.
	if (state.noProgressStreak >= BREAKER_K) {
		const reason = "no progress after breaker nudges; run paused";
		return pausedTransition({ ...state, phase: "paused", pausedReason: reason }, reason, { type: "pause", reason });
	}
	if (state.nudgeCount >= HARD_CAP) {
		const reason = "hard nudge cap reached; run paused";
		return pausedTransition({ ...state, phase: "paused", pausedReason: reason }, reason, { type: "pause", reason });
	}

	// Nudge is the last resort: schedule the next one on the escalating ladder.
	const nextNudgeCount = state.nudgeCount + 1;
	return {
		state: {
			...state,
			noProgressStreak: state.noProgressStreak + 1,
			nudgeCount: nextNudgeCount,
			nextAllowedAt: now + nudgeLadderDelayMs(nextNudgeCount),
		},
		action: { type: "nudge" },
		refusal: null,
	};
}

function onProviderError(state: DrainState, kind: ProviderErrorKind, now: number): DrainTransition {
	if (kind === "auth") {
		const reason = "provider auth error; needs human";
		return pausedTransition({ ...state, phase: "paused", pausedReason: reason }, reason, { type: "pause", reason });
	}
	if (state.phase === "backoff") {
		// Unknown errors ride the transient ladder but count toward the breaker.
		if (kind === "unknown") {
			const streak = state.noProgressStreak + 1;
			if (streak >= BREAKER_K) {
				const reason = "repeated unknown provider errors with no progress";
				return pausedTransition({ ...state, phase: "paused", pausedReason: reason, noProgressStreak: streak }, reason, {
					type: "pause",
					reason,
				});
			}
			const escalated = enterBackoff({ ...state, noProgressStreak: streak }, "transient", now, true);
			return escalated;
		}
		const budget = state.backoffKind === "quota" ? QUOTA_OUTAGE_BUDGET_MS : TRANSIENT_OUTAGE_BUDGET_MS;
		if (state.backoffStartMs !== null && now - state.backoffStartMs >= budget) {
			const reason = "provider outage budget exhausted";
			return pausedTransition({ ...state, phase: "paused", pausedReason: reason }, reason, { type: "pause", reason });
		}
		return enterBackoff(state, state.backoffKind ?? "transient", now, true);
	}
	// Outside backoff: enter the ladder at rung 0. Unknown also counts to the breaker.
	if (kind === "unknown") {
		const streak = state.noProgressStreak + 1;
		if (streak >= BREAKER_K) {
			const reason = "repeated unknown provider errors with no progress";
			return pausedTransition({ ...state, phase: "paused", pausedReason: reason, noProgressStreak: streak }, reason, {
				type: "pause",
				reason,
			});
		}
		return enterBackoff({ ...state, noProgressStreak: streak }, "transient", now, false);
	}
	return enterBackoff(state, kind === "quota" ? "quota" : "transient", now, false);
}

/** Fixed tick order per the design; the nudge is always the last resort. */
export function transition(state: DrainState, event: DrainEvent, now: number): DrainTransition {
	switch (event.type) {
		case "arm": {
			const refusal = armRefusal(event.pickable, event.queueOk);
			if (refusal !== null) return { state, action: WAIT, refusal };
			return {
				state: { ...INITIAL_STATE, phase: "armed" },
				action: WAIT,
				refusal: null,
			};
		}
		case "off":
			return idleTransition({ ...INITIAL_STATE, phase: "off" });
		case "resume":
			if (state.phase !== "paused") return idleTransition(state);
			// A resumed run starts with a clean no-progress slate; the hard-cap
			// total nudge count deliberately survives so resume cannot refresh it.
			return idleTransition({ ...state, phase: "armed", noProgressStreak: 0, backoffKind: null, backoffRung: 0, backoffStartMs: null, pausedReason: null });
		case "abort":
			if (state.phase === "off" || state.phase === "done") return idleTransition(state);
			return pausedTransition({ ...state, phase: "paused", pausedReason: "aborted (Esc/abort)" }, "aborted (Esc/abort)", {
				type: "pause",
				reason: "aborted (Esc/abort)",
			});
		case "tick":
			if (state.phase !== "armed" && state.phase !== "finalizing") return idleTransition(state);
			return handleTick(state, event.obs, now);
		case "providerError":
			return onProviderError(state, event.kind, now);
		case "probeOk":
			if (state.phase !== "backoff") return idleTransition(state);
			// One successful probe restores normal behavior and resets the ladder.
			return idleTransition({
				...state,
				phase: "armed",
				noProgressStreak: 0,
				backoffKind: null,
				backoffRung: 0,
				backoffStartMs: null,
			});
		case "llmStop": {
			// drain_stop is an explicit pause: the model named environment-level breakage.
			return pausedTransition({ ...state, phase: "paused", pausedReason: "drain_stop" }, "drain_stop", {
				type: "pause",
				reason: "drain_stop",
			});
		}
		case "llmDone":
			if (state.phase === "off" || state.phase === "done") return idleTransition(state);
			return idleTransition({ ...state, phase: "done", pausedReason: null });
		case "handoffRecorded":
		case "completionSteer":
		case "progress": {
			// Handoffs and child steers are progress, not stalls.
			if (state.phase === "backoff") return idleTransition({ ...state, noProgressStreak: 0 });
			if (state.phase !== "armed" && state.phase !== "finalizing") return idleTransition(state);
			return idleTransition({ ...state, noProgressStreak: 0, nextAllowedAt: now });
		}
		case "nudge": {
			// Bookkeeping for a delivered nudge (user-nudge backoff ladder).
			if (state.phase !== "armed" && state.phase !== "finalizing") return idleTransition(state);
			const nextNudgeCount = state.nudgeCount + 1;
			return idleTransition({
				...state,
				nudgeCount: nextNudgeCount,
				nextAllowedAt: now + nudgeLadderDelayMs(nextNudgeCount),
			});
		}
		case "breaker": {
			const reason = "no progress after breaker nudges; run paused";
			return pausedTransition({ ...state, phase: "paused", pausedReason: reason }, reason, { type: "pause", reason });
		}
		case "hardCap": {
			const reason = "hard nudge cap reached; run paused";
			return pausedTransition({ ...state, phase: "paused", pausedReason: reason }, reason, { type: "pause", reason });
		}
	}
}
