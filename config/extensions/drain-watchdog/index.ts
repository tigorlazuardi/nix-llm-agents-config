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
 *  - Esc/abort moves a running phase to PAUSED; PAUSED only leaves via `resume`
 *    (EVENT_PHASES in `transition` makes every other event a no-op there).
 *  - Child sessions (PI_SUBAGENT_ID set): callers no-op when `isChildSession`
 *    is true; the core itself does not branch on it.
 *  - A queue command that fails, prints garbage, or prints multiple numbers
 *    refuses/pauses; it is never interpreted as "done" or an empty queue
 *    (docs/agents/issue-tracker.md refusal rule).
 *  - Tick order is fixed and the nudge is the last resort.
 *
 * Bean-counting events (`progress`, `breaker`, `hardCap`) have no caller yet;
 * the #30 effect layer is the named consumer (handoff recorded, child steer
 * and queue fingerprint/label change all report as `progress`).
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
	/** Earliest wall-clock ms the next nudge may fire (3/6/12/24/30 min ladder). */
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
	| { type: "progress" }
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

/**
 * HTTP status code with context: the number must follow `status`, `HTTP[/x.y]`,
 * `response code` or `code`. A bare number ("512 tokens", "request 503") never
 * matches.
 */
const statusCode = (codes: string): RegExp =>
	new RegExp(`\\b(?:status|http(?:/[\\d.]+)?|response code|code)\\W{0,3}(?:${codes})\\b`, "i");

// ponytail: regex heuristics, unverified against real provider texts (design
// flow.html section 9); replace with pi-ai error kinds when they are exposed.
const QUOTA_PATTERNS = [
	/usage limit/i,
	/insufficient_quota/i,
	/available balance/i,
	/out of budget/i,
	/quota exceeded/i,
	/billing/i,
];

const AUTH_PATTERNS = [
	statusCode("401|403"),
	/^\s*(?:401|403)\b/,
	/invalid api key/i,
	/unauthorized/i,
	/forbidden/i,
];

const TRANSIENT_PATTERNS = [
	/overloaded/i,
	/high demand/i,
	/rate limit/i,
	/too many requests/i,
	statusCode("429|5\\d\\d"),
	/^\s*429\b/,
	/bad gateway/i,
	/internal server error/i,
	/service unavailable/i,
	/network (?:error|failure|unreachable)/i,
	/fetch failed/i,
	/\bENOTFOUND\b/,
	/\bEAI_AGAIN\b/,
	/\bECONNRESET\b/,
	/socket hang up/i,
	/time(?:d)?[ -]?out/i,
];

/**
 * Check order is quota → auth → transient → unknown, so a quota or auth text
 * that also carries a transient-looking marker ("429 insufficient_quota",
 * "403 ... network policy") never rides the transient ladder. Auth pauses
 * immediately; unknown rides the transient ladder but counts toward the
 * breaker.
 */
export function classifyProviderError(message: string): ProviderErrorKind {
	if (QUOTA_PATTERNS.some((re) => re.test(message))) return "quota";
	if (AUTH_PATTERNS.some((re) => re.test(message))) return "auth";
	if (TRANSIENT_PATTERNS.some((re) => re.test(message))) return "transient";
	return "unknown";
}

// --- Backoff ladders -----------------------------------------------------------

/**
 * Base delay for a backoff rung in ms; rungs beyond the ladder clamp to the
 * last step.
 * ponytail: deterministic; the design's ±20% jitter is applied by the #30
 * effect layer (it needs a random source, which the pure core must not touch).
 */
export function nextLadderDelayMs(kind: "transient" | "quota", rung: number): number {
	const ladder = kind === "quota" ? QUOTA_LADDER_MIN : TRANSIENT_LADDER_MIN;
	return ladder[Math.min(Math.max(rung, 0), ladder.length - 1)] * 60_000;
}

function nudgeLadderDelayMs(nudgeNumber: number): number {
	return NUDGE_LADDER_MIN[Math.min(Math.max(nudgeNumber - 1, 0), NUDGE_LADDER_MIN.length - 1)] * 60_000;
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
const stay = (state: DrainState): DrainTransition => ({ state, action: WAIT, refusal: null });

const PAUSE_REASON = {
	queue: "queue command failed",
	auth: "provider auth error; needs human",
	unknown: "repeated unknown provider errors with no progress",
	breaker: "no progress after breaker nudges; run paused",
	hardCap: "hard nudge cap reached; run paused",
	outage: "provider outage budget exhausted",
	abort: "aborted (Esc/abort)",
	llmStop: "drain_stop",
} as const;

const toPaused = (state: DrainState, reason: string): DrainTransition => ({
	state: { ...state, phase: "paused", pausedReason: reason },
	action: { type: "pause", reason },
	refusal: null,
});

/**
 * Which phases each event may act from; every other (phase, event) pair is a
 * no-op enforced once at the top of `transition`. OFF, PAUSED and DONE own
 * almost nothing on purpose: only `arm` (from OFF) and `resume` (from PAUSED)
 * leave them, and DONE is terminal (a new run starts from INITIAL_STATE).
 */
const EVENT_PHASES: Record<DrainEvent["type"], readonly DrainPhase[]> = {
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

function enterBackoff(
	state: DrainState,
	kind: "transient" | "quota",
	now: number,
	escalate: boolean,
): DrainTransition {
	const rung = escalate ? state.backoffRung + 1 : 0;
	return {
		state: {
			...state,
			phase: "backoff",
			backoffKind: kind,
			backoffRung: rung,
			backoffStartMs: state.backoffStartMs ?? now,
			pausedReason: null,
			nextAllowedAt: now,
		},
		action: { type: "probe", delayMs: nextLadderDelayMs(kind, rung) },
		refusal: null,
	};
}

/**
 * The only place a nudge (plain or finalize) is recorded: breaker and hard-cap
 * gate first, then count, streak and the 3/6/12/24/30 min cooldown. There is
 * deliberately no external "nudge" event — effects must not re-record.
 */
function recordNudge(
	state: DrainState,
	now: number,
	action: { type: "nudge" } | { type: "finalizeNudge" },
): DrainTransition {
	if (state.noProgressStreak >= BREAKER_K) return toPaused(state, PAUSE_REASON.breaker);
	if (state.nudgeCount >= HARD_CAP) return toPaused(state, PAUSE_REASON.hardCap);
	const nudgeCount = state.nudgeCount + 1;
	return {
		state: {
			...state,
			phase: action.type === "finalizeNudge" ? "finalizing" : state.phase,
			noProgressStreak: state.noProgressStreak + 1,
			nudgeCount,
			nextAllowedAt: now + nudgeLadderDelayMs(nudgeCount),
		},
		action,
		refusal: null,
	};
}

function handleTick(state: DrainState, obs: TickObservation, now: number): DrainTransition {
	// Cycle-start activity: legitimately busy; the effect layer resets the idle clock.
	if (obs.running || obs.pendingMessages) return stay(state);
	// Idle grace shields steer deliveries that just landed.
	if (obs.allIdleForMs < IDLE_GRACE_MS) return stay(state);
	// Nudge cooldown (design order: cooldown gate sits before the queue observation).
	if (now < state.nextAllowedAt) return stay(state);

	if (!obs.queueOk) return toPaused(state, PAUSE_REASON.queue);

	// Terminal branch first: frontier 0, nothing in flight, no children.
	if (obs.pickable <= 0 && obs.inflight <= 0 && obs.childCount <= 0) {
		if (obs.leftoverBlocked) return { state: { ...state, phase: "done" }, action: { type: "done", leftovers: true }, refusal: null };
		// FINALIZING nudges are bounded like any other nudge (breaker + hard cap).
		if (obs.hasClosingSteps) return recordNudge(state, now, { type: "finalizeNudge" });
		return { state: { ...state, phase: "done" }, action: { type: "done", leftovers: false }, refusal: null };
	}

	// Children running: observe only. A stall notifies; it never nudges the main.
	if (obs.childCount > 0) {
		if (obs.progressAgeMs >= STALL_LIMIT_MS) return { state, action: { type: "stallNotify" }, refusal: null };
		return stay(state);
	}

	// Provider error on the last ended run hands over to the backoff path.
	if (obs.lastError !== null) return onProviderError(state, classifyProviderError(obs.lastError), now);

	// Nudge is the last resort.
	return recordNudge(state, now, { type: "nudge" });
}

function onProviderError(state: DrainState, kind: ProviderErrorKind, now: number): DrainTransition {
	if (kind === "auth") return toPaused(state, PAUSE_REASON.auth);
	const inBackoff = state.phase === "backoff";
	// Unknown errors count toward the breaker.
	const streak = kind === "unknown" ? state.noProgressStreak + 1 : state.noProgressStreak;
	if (streak >= BREAKER_K) return toPaused({ ...state, noProgressStreak: streak }, PAUSE_REASON.unknown);
	if (inBackoff) {
		const budget = state.backoffKind === "quota" ? QUOTA_OUTAGE_BUDGET_MS : TRANSIENT_OUTAGE_BUDGET_MS;
		if (state.backoffStartMs !== null && now - state.backoffStartMs >= budget) {
			return toPaused(state, PAUSE_REASON.outage);
		}
		// ponytail: inside an outage the kind that opened it keeps its ladder (an
		// unknown error neither switches quota to transient nor gets its own budget);
		// split per-kind tracking if real traffic shows mixed-kind outages.
		return enterBackoff({ ...state, noProgressStreak: streak }, state.backoffKind ?? "transient", now, true);
	}
	// Outside backoff: enter at rung 0. Unknown rides the transient ladder.
	return enterBackoff({ ...state, noProgressStreak: streak }, kind === "quota" ? "quota" : "transient", now, false);
}

/** Fixed tick order per the design; the nudge is always the last resort. */
export function transition(state: DrainState, event: DrainEvent, now: number): DrainTransition {
	if (!EVENT_PHASES[event.type].includes(state.phase)) {
		// arm from OFF is the only place a refusal is reported; a no-op event never is.
		return stay(state);
	}
	switch (event.type) {
		case "arm": {
			const refusal = armRefusal(event.pickable, event.queueOk);
			if (refusal !== null) return { state, action: WAIT, refusal };
			return { state: { ...INITIAL_STATE, phase: "armed" }, action: WAIT, refusal: null };
		}
		case "off":
			return stay({ ...INITIAL_STATE, phase: "off" });
		case "resume":
			// A resumed run starts with a clean no-progress slate; the hard-cap
			// total nudge count deliberately survives so resume cannot refresh it.
			return stay({
				...state,
				phase: "armed",
				noProgressStreak: 0,
				backoffKind: null,
				backoffRung: 0,
				backoffStartMs: null,
				pausedReason: null,
			});
		case "abort":
			return toPaused(state, PAUSE_REASON.abort);
		case "tick":
			return handleTick(state, event.obs, now);
		case "providerError":
			return onProviderError(state, event.kind, now);
		case "probeOk":
			// One successful probe restores normal behavior and resets the ladder.
			return stay({ ...state, phase: "armed", noProgressStreak: 0, backoffKind: null, backoffRung: 0, backoffStartMs: null });
		case "llmStop":
			// drain_stop is an explicit pause: the model named environment-level breakage.
			return toPaused(state, PAUSE_REASON.llmStop);
		case "llmDone":
			return stay({ ...state, phase: "done", pausedReason: null });
		// ponytail: `breaker` and `hardCap` duplicate the tick-internal gates in
		// recordNudge; no named #30 consumer yet. Remove them if #30 does not need
		// to force-pause from outside the tick.
		case "breaker":
			return toPaused(state, PAUSE_REASON.breaker);
		case "hardCap":
			return toPaused(state, PAUSE_REASON.hardCap);
		case "progress":
			// Handoffs, child steers and queue-fingerprint/label changes are progress,
			// not stalls. One event: callers report all three as `progress`.
			if (state.phase === "backoff") return stay({ ...state, noProgressStreak: 0 });
			return stay({ ...state, noProgressStreak: 0, nextAllowedAt: now });
	}
}
