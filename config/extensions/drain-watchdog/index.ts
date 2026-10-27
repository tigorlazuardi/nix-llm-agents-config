/**
 * drain-watchdog: pure decision core + the #30 live effect layer.
 *
 * Every function above the factory is deterministic and side-effect free: no
 * network, no clock, no subprocesses, no pi-API calls at runtime — this module
 * is the single pure seam the self-check asserts against (plans/drain-watchdog
 * flow.html sections 0-6, 10). The default export at the bottom is the pi
 * extension factory: the `/watchdog` command, the ARMED tick loop, nudges via
 * steer, state/audit session entries, and every timer. Timers are created only
 * on arm (never in the factory body), and child sessions never reach any of it.
 *
 * Semantics locked by the design:
 *  - Esc/abort moves a running phase to PAUSED; PAUSED only leaves via `resume`
 *    (EVENT_PHASES in `transition` makes every other event a no-op there).
 *  - Child sessions (PI_SUBAGENT_ID set): the factory registers nothing — no
 *    listeners, no commands, no timers.
 *  - A queue command that fails, prints garbage, or prints multiple numbers
 *    refuses/pauses; it is never interpreted as "done" or an empty queue
 *    (docs/agents/issue-tracker.md refusal rule).
 *  - Tick order is fixed and the nudge is the last resort.
 *
 * `progress` is dispatched by the live loop for child completion steers and
 * queue fingerprint changes (label/status changes sit behind the count-only
 * contract). Only the harness decides completion: `llmDone` is accepted from
 * FINALIZING alone (flow.html sections 3 and 10).
 *
 * Imports `isRetryableAssistantError` from @earendil-works/pi-ai, so the module
 * needs pi-ai resolvable (checks.nix symlinks it from the pi runtime into the
 * copy's node_modules; a real session resolves it itself). It is not loadable
 * from a bare directory.
 *
 * ponytail: ladder lengths, breaker/hard-cap thresholds, and stall/idle
 * budgets are fixed design defaults baked in below; the factory reads
 * PI_WATCHDOG_* env overrides wired from the Nix module as session variables.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isRetryableAssistantError } from "@earendil-works/pi-ai";
import type { ExecResult, ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

// The runtime only reads stopReason/errorMessage; the rest of AssistantMessage is irrelevant here.
type RuntimeMessage = Parameters<typeof isRetryableAssistantError>[0];

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
/** Backoff jitter half-width: delays land within +-20% of the ladder step. */
const JITTER_FRACTION = 0.2;

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

// Quota text must be matched BEFORE the runtime's retry check: the runtime
// treats its own quota strings as non-retryable, and a "429 ..." quota body
// must not ride the transient ladder. Superset of pi-ai's non-retryable list
// (GoUsageLimitError, FreeUsageLimitError, subscription_sharing_*).
const QUOTA_PATTERNS = [
	/usage limit/i,
	/GoUsageLimitError/,
	/FreeUsageLimitError/,
	/subscription_sharing_usage_limit_exceeded/,
	/subscription_sharing_workplace_individual_usage_limit_exceeded/,
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

// ponytail: the runtime's `isRetryableAssistantError` has no bare Node errno
// codes (it matches "connection refused", not "ECONNREFUSED"); this tiny
// supplement covers them. Drop an entry when pi-ai starts matching it.
const TRANSIENT_ERRNO = /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE)\b/;

/**
 * Check order is quota -> auth -> transient -> unknown, so a quota or auth text
 * that also carries a transient-looking marker ("429 insufficient_quota",
 * "403 ... network policy") never rides the transient ladder. Transient is the
 * runtime's own retryability verdict (`isRetryableAssistantError`, reused so the
 * watchdog and the agent retry loop agree) plus the errno supplement above.
 * Auth pauses immediately; unknown rides the transient ladder but counts toward
 * the breaker. Accepted consequence of reusing the runtime regex: a bare 429/5xx
 * number anywhere in the text ("request id 503") counts as transient, as it does
 * for the runtime retry loop.
 */
export function classifyProviderError(message: string): ProviderErrorKind {
	if (QUOTA_PATTERNS.some((re) => re.test(message))) return "quota";
	if (AUTH_PATTERNS.some((re) => re.test(message))) return "auth";
	if (isRetryableAssistantError({ stopReason: "error", errorMessage: message } as RuntimeMessage)) return "transient";
	if (TRANSIENT_ERRNO.test(message)) return "transient";
	return "unknown";
}

// --- Backoff ladders -----------------------------------------------------------

/**
 * Base delay for a backoff rung in ms; rungs beyond the ladder clamp to the
 * last step. Deterministic: apply `jitteredDelayMs` at the point of use.
 */
export function nextLadderDelayMs(kind: "transient" | "quota", rung: number): number {
	const ladder = kind === "quota" ? QUOTA_LADDER_MIN : TRANSIENT_LADDER_MIN;
	return ladder[Math.min(Math.max(rung, 0), ladder.length - 1)] * 60_000;
}

/**
 * Jittered delay: `baseMs` scaled into +-20% by an injected `r` in [0, 1)
 * (the caller passes Math.random(); the core stays pure). r outside [0, 1] is
 * clamped and NaN is treated as the midpoint, so a bad source never widens the
 * band. Consumed by the #32 backoff effect path when it schedules a probe.
 */
export function jitteredDelayMs(baseMs: number, r: number): number {
	const unit = Number.isNaN(r) ? 0.5 : Math.min(Math.max(r, 0), 1);
	return Math.round(baseMs * (1 - JITTER_FRACTION + 2 * JITTER_FRACTION * unit));
}

// NOTE (recorded): the cooldown ladder is keyed on the run's TOTAL nudge
// count, not the no-progress streak, so after 5 nudges every re-nudge waits 30
// min even with progress in between. Design wording ("grows per nudge without
// progress") is ambiguous; revisit when #35 shows real stall-recovery timing.
function nudgeLadderDelayMs(nudgeNumber: number): number {
	return NUDGE_LADDER_MIN[Math.min(Math.max(nudgeNumber - 1, 0), NUDGE_LADDER_MIN.length - 1)] * 60_000;
}

// --- Handoff exit --------------------------------------------------------------

export type HandoffKind = "needs-info" | "human" | "wontfix";

// ponytail: GitHub tracker labels only (flow.html section 5 table); Jira/Huly
// need a status change, not a label, and come from the tracker doc when a second
// tracker exists.
const HANDOFF_LABEL: Record<HandoffKind, string> = {
	"needs-info": "needs-info",
	human: "ready-for-human",
	wontfix: "wontfix",
};

/**
 * Label a handed-off ticket gets so it leaves the `drain-queue` result (no
 * "dead but still queued" ticket). Fails closed: an unknown kind throws rather
 * than yielding a label that would leave the ticket queued.
 */
export function handoffExit(kind: HandoffKind): { label: string } {
	const label = Object.hasOwn(HANDOFF_LABEL, kind) ? HANDOFF_LABEL[kind] : undefined;
	if (label === undefined) throw new Error(`unknown handoff kind: ${String(kind)}`);
	return { label };
}

// --- SPLIT predicate ------------------------------------------------------------

export type ReviewAxis = "standards" | "spec";

/** What the caller does with a finished review. */
export type SplitDecision = "split" | "fixLoop" | "handoff" | "none";

/**
 * SPLIT rule: only a review that FINISHED with FAIL after exceeding its axis
 * budget (10 min standards, 20 min spec) splits, and only while depth < cap;
 * at the cap an over-budget FAIL is a `handoff` (ticket -> `ready-for-human`,
 * see `handoffExit`). FAIL within budget is the ordinary `fixLoop`; PASS never
 * splits; a hung review (no verdict) is `none` — stall detection covers it.
 */
export function shouldSplit(
	axis: ReviewAxis,
	verdict: "pass" | "fail" | null | undefined,
	durationMs: number,
	splitDepth: number,
): SplitDecision {
	if (verdict !== "fail") return "none";
	const budget = axis === "spec" ? SPEC_REVIEW_BUDGET_MS : STANDARDS_REVIEW_BUDGET_MS;
	if (durationMs <= budget) return "fixLoop";
	return splitDepth >= SPLIT_DEPTH_CAP ? "handoff" : "split";
}

// --- Live-loop helpers (#30 effect layer decisions) -------------------------
// #30's factory consumes these; all decisions stay pure and asserted here so the
// ONE test seam of #27 holds. No pi API types appear above the factory below.

/** Positive-int env var reader; non-numeric or <=0 values fall back. Same
 *  naming contract as pi-idle-compact's readIntEnv, but env is passed in so
 *  the self-check can assert it without touching process state. */
export function readIntEnv(env: Record<string, string | undefined>, name: string, fallback: number): number {
	const raw = env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type WatchdogSubcommand = { sub: "prep" | "resume" | "off" | "status"; ref: string | null };

/**
 * Argument grammar of `/watchdog`: `resume` / `off` / `status` are control
 * subcommands; anything else (including `on` with an optional ref) enters PREP.
 */
export function parseWatchdogSubcommand(args: string): WatchdogSubcommand {
	const trimmed = args.trim();
	const first = (trimmed.split(/\s+/)[0] ?? "").toLowerCase();
	if (first === "resume") return { sub: "resume", ref: null };
	if (first === "off") return { sub: "off", ref: null };
	if (first === "status") return { sub: "status", ref: null };
	if (first === "") return { sub: "prep", ref: null };
	if (first === "on") {
		const rest = trimmed.slice(first.length).trim();
		return { sub: "prep", ref: rest === "" ? null : rest };
	}
	return { sub: "prep", ref: trimmed };
}

/** Distinct issue numbers mentioned as `#N` tokens, ascending. */
export function extractIssueNumbers(text: string): number[] {
	const found = new Set<number>();
	for (const m of text.matchAll(/(?<!\w)#\d+(?!\w)/g)) {
		const n = Number.parseInt(m[0].slice(1), 10);
		if (n > 0) found.add(n);
	}
	return [...found].sort((a, b) => a - b);
}

/** First bare number in a git branch name ("issue-30" -> 30); null when none. */
export function issueNumberFromBranch(branch: string): number | null {
	const m = /\d+/.exec(branch);
	if (!m) return null;
	const n = Number.parseInt(m[0], 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * PREP target resolution. A ref that names exactly one issue or exactly one
 * session-context candidate resolves; anything else asks the operator — the
 * command never silently picks a target (flow.html section 0).
 */
export type TargetResolution =
	| { status: "resolved"; number: number }
	| { status: "ask"; candidates?: number[] };

export function pickTarget(ref: string | null, candidates: number[]): TargetResolution {
	const refNumbers = ref === null ? [] : extractIssueNumbers(ref);
	if (refNumbers.length === 1) return { status: "resolved", number: refNumbers[0] };
	if (refNumbers.length > 1) return { status: "ask", candidates: refNumbers };
	if (candidates.length === 1) return { status: "resolved", number: candidates[0] };
	if (candidates.length > 1) return { status: "ask", candidates };
	return { status: "ask" };
}

/**
 * First fenced block with the exact info string; null when missing. The whole
 * block body is the executable queue command (docs/agents/issue-tracker.md).
 */
export function extractFencedBlock(markdown: string, infoString: string): string | null {
	const escaped = infoString.replace(/[.*+?^${}()[\]\\]/g, "\\$&");
	const re = new RegExp(String.raw`(?:^|\n)\`\`\`${escaped}[ \t]*\r?\n([\s\S]*?)\r?\n\`\`\`[ \t]*(?:\r?\n|$)`);
	const m = re.exec(markdown);
	return m === null ? null : m[1].replace(/\s+$/, "");
}

/** Joined text of a message's text content parts; accepts loose shapes. */
export function messageText(message: unknown): string {
	if (typeof message !== "object" || message === null) return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (typeof part === "object" && part !== null) {
			const p = part as { type?: unknown; text?: unknown };
			if (p.type === "text" && typeof p.text === "string") parts.push(p.text);
		}
	}
	return parts.join("\n");
}

/**
 * PREP -> ARMED gate: the model declares readiness by ending a turn whose last
 * non-empty line is exactly `READY`. Any other ending (question, prose, `not
 * ready`) keeps PREP open; only the operator confirm then arms.
 */
export function isReadyDeclaration(text: string): boolean {
	const lines = text.trimEnd().split(/\r?\n/);
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i].trim();
		if (line === "") continue;
		return line === "READY";
	}
	return false;
}

export type RunMessage = { role?: unknown; stopReason?: unknown; errorMessage?: unknown };

/**
 * Error text of the last assistant message in the run that ended with
 * stopReason "error" (scanned from the end); null when the run had no error.
 * Aborted runs report `aborted` and are handled by the abort event instead.
 */
export function extractLastError(messages: readonly RunMessage[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (typeof m !== "object" || m === null) continue;
		if (m.role !== "assistant" || m.stopReason !== "error") continue;
		return typeof m.errorMessage === "string" && m.errorMessage !== "" ? m.errorMessage : "unknown provider error";
	}
	return null;
}

export const SUBAGENT_SPAWN_TOOLS = ["subagent", "subagent_resume"] as const;
/** pi-herdr-subagents surfaces new or resumed running children via these tools.
 *  ponytail: fragile pairing — a session restart drops armed counts while
 *  panes keep running; count drifts after a restart until every child exits. */
export function isSubagentSpawnTool(toolName: string): boolean {
	return (SUBAGENT_SPAWN_TOOLS as readonly string[]).includes(toolName);
}

/** Child completion arrives in the main session as a `subagent_result` steer.
 *  `subagent_status`/`subagent_ping` steers arrive mid-run and must NOT be
 *  counted as completion. */
export function isSubagentCompletionNotice(customType: unknown): boolean {
	return customType === "subagent_result";
}

/** compare pickable/inflight between ticks: a change is a progress event. */
export function queueFingerprint(o: { pickable: number; inflight: number }): string {
	return `${o.pickable}/${o.inflight}`;
}

/**
 * Nudge text (flow.html section 2): tell the model to never stop with a
 * question, continue its flow, and hand off what it may not work on.
 */
export function buildNudgeText(p: { target: number | null; pickable: number }): string {
	const target = p.target === null ? "the accepted tickets" : `#${p.target}`;
	return [
		`drain-watchdog: unattended run on ${target}; you are idle with ${p.pickable} pickable ticket(s) in the drain queue. Do not ask the user — continue per the drain flow now: run the next pass on the next pickable ticket.`,
		"Ambiguous or product-question tickets, and low-tolerance work (auth/authz, secrets/credentials, DB migrations, public API contracts, money/billing, data deletion, irreversible operations), must leave the queue through the tracker's exit labels (needs-info / ready-for-human / wontfix) instead of waiting.",
	].join("\n");
}

/** Minimal backoff probe: one cheap wake after a provider error, not a prompt. */
export const PROBE_TEXT = "drain-watchdog probe: continue the drain flow.";

/** Closing nudge of a finalizing flow (flow.html section 10; one per successful delivery). */
export const FINALIZE_NUDGE_TEXT =
	"drain-watchdog: frontier is empty. Finish the closing steps (final review, integration branch/PR, cleanup) and stop; do not open new work.";

const STATE_ENTRY_TYPE = "drain-watchdog-state";

/** Valid DrainPhase values, for restoring persisted state without trusting it. */
const DRAIN_PHASES: readonly DrainPhase[] = ["off", "armed", "backoff", "paused", "done", "finalizing"];

/**
 * Latest valid persisted watchdog state from session entries (null when the
 * session has none). Entries from before the last compaction may be gone, and
 * a fresh run keeps the latest valid entry only — garbage is ignored, never
 * half-applied. ponytail: entries pruned by a null-keeping compaction can lose
 * the state; the watchdog then restores OFF and waits for /watchdog again.
 */
export function restoreDrainState(
	entries: readonly { type?: unknown; customType?: unknown; data?: unknown }[],
): DrainState | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (typeof e !== "object" || e === null) continue;
		if (e.type !== "custom" || e.customType !== STATE_ENTRY_TYPE) continue;
		if (typeof e.data !== "object" || e.data === null) continue;
		const data = e.data as Record<string, unknown>;
		if (typeof data.phase !== "string" || !DRAIN_PHASES.includes(data.phase as DrainPhase)) continue;
		const merged: Record<string, unknown> = { ...INITIAL_STATE };
		for (const key of Object.keys(INITIAL_STATE)) {
			if (!Object.hasOwn(data, key)) continue;
			const value = data[key];
			const fallback = (INITIAL_STATE as Record<string, unknown>)[key];
			// Only keys keep their restored value; a corrupted type falls back.
			if (typeof value === typeof fallback && value !== null) merged[key] = value;
		}
		return merged as DrainState;
	}
	return null;
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
	finalize: "finalization not confirmed after the closing nudge; run paused",
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
 * `llmDone` is FINALIZING-only: the model cannot declare the run finished from
 * ARMED/BACKOFF (flow.html sections 3, 10); there it is a no-op, which keeps the
 * run going (safer than pausing an unattended run on a model's early claim) and
 * lets the #31 tool report the refusal back to the model.
 */
const EVENT_PHASES: Record<DrainEvent["type"], readonly DrainPhase[]> = {
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
		if (obs.hasClosingSteps) {
			// Exactly ONE closing nudge (design section 10, #34). Idle again after it
			// with closing steps still open: pause, visibly, rather than nudge more or
			// wait forever unattended. Breaker + hard cap still gate the first nudge.
			if (state.phase === "finalizing") return toPaused(state, PAUSE_REASON.finalize);
			return recordNudge(state, now, { type: "finalizeNudge" });
		}
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
		// A quota error upgrades a transient-opened outage to the quota ladder (rung
		// 0 = 30 min) and the 12 h budget, still measured from the outage start.
		// Transient/unknown errors keep the kind that opened the outage: unknown
		// inside a quota outage deliberately stays on the (longer) quota ladder, a
		// conservative deviation from "unknown -> transient ladder".
		const upgrade = kind === "quota" && state.backoffKind !== "quota";
		const outageKind = upgrade ? "quota" : (state.backoffKind ?? "transient");
		const budget = outageKind === "quota" ? QUOTA_OUTAGE_BUDGET_MS : TRANSIENT_OUTAGE_BUDGET_MS;
		if (state.backoffStartMs !== null && now - state.backoffStartMs >= budget) {
			return toPaused(state, PAUSE_REASON.outage);
		}
		return enterBackoff({ ...state, noProgressStreak: streak }, outageKind, now, !upgrade);
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
			// NOTE (recorded): so a resume after a hard-cap PAUSE re-pauses on the
			// first nudge tick, and `off` + `arm` (fresh INITIAL_STATE) does refresh the
			// cap. Semantics left as designed; revisit when a live pass shows it matters.
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
			// One successful probe restores normal behavior and resets the ladder. It is
			// NOT progress, so the no-progress streak survives: a stuck run must still
			// reach the breaker/hard cap through a provider blip.
			return stay({ ...state, phase: "armed", backoffKind: null, backoffRung: 0, backoffStartMs: null });
		case "llmStop":
			// drain_stop is an explicit pause: the model named environment-level breakage.
			return toPaused(state, PAUSE_REASON.llmStop);
		case "llmDone":
			return stay({ ...state, phase: "done", pausedReason: null });
		// ponytail: `breaker` and `hardCap` duplicate the tick-internal gates in
		// recordNudge and have no named consumer. Remove them if #30 does not need
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

// --- Live effect layer (default factory) ----------------------------------
// Effect layer only: every decision comes from the pure core above. Timers are
// created on arm/restore/resume (never here in the factory body); a child
// session leaves the factory without registering anything.

const AUDIT_ENTRY_TYPE = "drain-watchdog-audit";
const NUDGE_MESSAGE_TYPE = "drain-watchdog-nudge";
const PROBE_MESSAGE_TYPE = "drain-watchdog-probe";
const QUEUE_DOCS_RELPATH = "docs/agents/issue-tracker.md";
/** Queue block execution budget: the block walks every pickable issue with one
 *  `gh api` call each; a healthy repo finishes well under a minute. */
const QUEUE_TIMEOUT_MS = 300_000;

const PREP_INSTRUCTION = (target: number, pickable: number): string =>
	[
		`drain-watchdog PREP for #${target}: the drain-queue block reported ${pickable} pickable ticket(s).`,
		"Prove readiness now: run the project's check command (nix flake check here; it is long, so give it a generous timeout and report the result).",
		"If it is green and the drained scope covers the queue, end a turn whose last line is exactly:",
		"READY",
		"If it failed, report what failed. Do not write READY.",
	].join("\n");

export default function watchdogExtension(pi: ExtensionAPI) {
	// Child sessions never run the watchdog: no listeners, no command, no timers,
	// no state — the factory returns before registering anything (self-checked).
	if (isChildSession(process.env)) return;

	const env = process.env as Record<string, string | undefined>;
	const tickMs = readIntEnv(env, "PI_WATCHDOG_TICK_MS", 60_000);
	// The core's handleTick also floors on its own IDLE_GRACE_MS (3m, frozen in
	// the #29 core): a value configured below that floor still waits the full
	// 3m before a tick can act, it just no longer widens the window beyond it.
	const idleGraceMs = readIntEnv(env, "PI_WATCHDOG_IDLE_GRACE_MS", IDLE_GRACE_MS);
	const stallLimitMs = readIntEnv(env, "PI_WATCHDOG_STALL_LIMIT_MS", STALL_LIMIT_MS);
	// ponytail: only the three timing knobs are env-wired; BREAKER_K and HARD_CAP
	// live inside the core's recordNudge and wiring them would mean a core change.
	// Make them env-tunable when a second consumer boots with different thresholds.

	type Timer = ReturnType<typeof setTimeout>;

	let latestCtx: ExtensionContext | null = null;
	let state: DrainState = { ...INITIAL_STATE };
	let timer: Timer | null = null;
	let probeTimer: Timer | null = null;
	let tickInFlight = false;
	let uiPromptDepth = 0;
	let childCount = 0;
	let probeInFlight = false;
	let idleSinceMs = Date.now();
	let progressSinceMs = idleSinceMs;
	let lastQueue = { pickable: 0, inflight: 0 };
	let runTarget: number | null = null;
	// PREP bookkeeping is deliberately not persisted: PREP is interactive, and an
	// unconfirmed readiness dies with the session or the next command.
	let prepTarget: number | null = null;
	let prepPickable = 0;
	let prepInflight = 0;
	let readyDeclared = false;

	// M1: set true in session_shutdown, reset false in session_start. Checked after every
	// await that precedes a state mutation or timer creation (tick, agent_settled's
	// ui.confirm, runPrep's awaits, scheduleProbe's delayed delivery) so no in-flight
	// async work can arm/nudge/persist/start a timer after teardown.
	let closed = false;
	const clearTickTimer = () => {
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		}
	};
	const clearProbeTimer = () => {
		if (probeTimer !== null) {
			clearTimeout(probeTimer);
			probeTimer = null;
		}
	};
	const clearTimers = () => {
		clearTickTimer();
		clearProbeTimer();
	};

	const notify = (message: string, level: "info" | "warning" | "error" = "info") => {
		if (latestCtx?.hasUI) latestCtx.ui.notify(message, level);
	};

	const deliver = (customType: string, content: string) => {
		pi.sendMessage({ customType, content, display: true }, { triggerTurn: true, deliverAs: "steer" });
	};

	const audit = (event: string, detail: Record<string, unknown> = {}) => {
		pi.appendEntry(AUDIT_ENTRY_TYPE, { ts: new Date().toISOString(), event, phase: state.phase, ...detail });
	};

	const persist = () => {
		pi.appendEntry(STATE_ENTRY_TYPE, { ...state });
	};

	const startLoop = () => {
		if (closed) return; // M1: never start a timer after session_shutdown.
		// H3: only the tick interval is (re)created here. Clearing the probe timer too
		// used to wedge a restored BACKOFF run: session_start calls scheduleProbe(...)
		// then startLoop() to keep ticks alive for probeOk, and this killed the probe
		// it had just scheduled a line above, so BACKOFF never woke up again.
		clearTickTimer();
		timer = setInterval(() => {
			void tick();
		}, tickMs);
	};

	const scheduleProbe = (baseDelayMs: number) => {
		if (closed) return; // M1: never arm a timer after session_shutdown.
		clearProbeTimer();
		// Jitter at the effect boundary: the core's ladder value is the base; the
		// delivery widens it +-20% (jitteredDelayMs) so parallel wakes do not hit the
		// provider together. On a failed probe delivery BACKOFF can wedge; the next
		// real event or /watchdog resume recovers it.
		const delay = jitteredDelayMs(baseDelayMs, Math.random());
		probeTimer = setTimeout(() => {
			probeTimer = null;
			if (closed || state.phase !== "backoff") return; // M1: shutdown may land mid-delay.
			probeInFlight = true;
			audit("probe-delivered", {});
			deliver(PROBE_MESSAGE_TYPE, PROBE_TEXT);
		}, delay);
	};

	type QueueResult = { ok: boolean; pickable: number; inflight: number; error: string };

	const runQueueCommand = async (ctx: ExtensionContext): Promise<QueueResult> => {
		const fail = (error: string): QueueResult => ({ ok: false, pickable: 0, inflight: 0, error });
		let markdown: string;
		try {
			markdown = readFileSync(join(ctx.cwd, QUEUE_DOCS_RELPATH), "utf8");
		} catch {
			return fail(`${QUEUE_DOCS_RELPATH} is not readable`);
		}
		const queueBlock = extractFencedBlock(markdown, "drain-queue");
		if (queueBlock === null || queueBlock.trim() === "") return fail(`no drain-queue block in ${QUEUE_DOCS_RELPATH}`);
		let res: ExecResult;
		try {
			res = await pi.exec("bash", ["-c", queueBlock], { cwd: ctx.cwd, timeout: QUEUE_TIMEOUT_MS });
		} catch (e) {
			// H1/H2: pi.exec is the real API (ctx.exec does not exist); a spawn-level throw
			// (not just a non-zero exit, which parseQueueOutput already handles) must also refuse.
			return fail(`drain-queue command threw: ${String(e)}`);
		}
		const parsed = parseQueueOutput(res.stdout, res.code);
		if (!parsed.ok) return fail(`drain-queue command failed (exit ${res.code}); refusing`);
		// drain-inflight is optional by contract; a missing/failing block is counted
		// as 0 (ponytail: a ticket misread inflight as 0 only matters for DONE, which
		// also requires childCount === 0).
		let inflight = 0;
		const inflightBlock = extractFencedBlock(markdown, "drain-inflight");
		if (inflightBlock !== null) {
			try {
				const res2 = await pi.exec("bash", ["-c", inflightBlock], { cwd: ctx.cwd, timeout: QUEUE_TIMEOUT_MS });
				const parsed2 = parseQueueOutput(res2.stdout, res2.code);
				if (parsed2.ok) inflight = parsed2.count;
			} catch {
				// Optional block: a throwing command counts as 0, same as a failing one.
			}
			const parsed2 = parseQueueOutput(res2.stdout, res2.code);
			if (parsed2.ok) inflight = parsed2.count;
		}
		return { ok: true, pickable: parsed.count, inflight, error: "" };
	};

	const armRun = (target: number | null, pickable: number, inflight: number) => {
		const t = transition(state, { type: "arm", queueOk: true, pickable }, Date.now());
		if (t.refusal !== null) {
			audit("arm-refused", { reason: t.refusal });
			notify(`drain-watchdog: refusing to arm — ${t.refusal}`, "error");
			return false;
		}
		state = t.state;
		runTarget = target;
		lastQueue = { pickable, inflight };
		idleSinceMs = progressSinceMs = Date.now();
		childCount = 0;
		probeInFlight = false;
		persist();
		audit("armed", { target, pickable, inflight });
		startLoop();
		notify(`drain-watchdog ARMED${target === null ? "" : ` on #${target}`}: tick every ${Math.round(tickMs / 1000)}s.`, "info");
		return true;
	};

	const apply = (t: DrainTransition, source: string) => {
		const previous = state;
		state = t.state;
		if (state !== previous) persist();
		switch (t.action.type) {
			case "wait":
				break;
			case "nudge":
				audit("nudge", { source, streak: state.noProgressStreak, nudgeCount: state.nudgeCount, pickable: lastQueue.pickable });
				deliver(NUDGE_MESSAGE_TYPE, buildNudgeText({ target: runTarget, pickable: lastQueue.pickable }));
				break;
			case "finalizeNudge":
				audit("finalize-nudge", { source });
				deliver(NUDGE_MESSAGE_TYPE, FINALIZE_NUDGE_TEXT);
				break;
			case "stallNotify":
				audit("stall-notify", { children: childCount, stallLimitMs });
				notify(`drain-watchdog: children are running but no progress for ${Math.round(stallLimitMs / 60_000)}m — inspect the herdr panes; no nudge sent.`, "warning");
				break;
			case "pause":
				clearTimers();
				audit("paused", { reason: t.action.reason, target: runTarget });
				// The pause names the run target (the count-only queue contract cannot
				// say WHICH queued ticket is stuck; the target and counts do).
				notify(`drain-watchdog PAUSED: ${t.action.reason}${runTarget === null ? "" : ` (run target #${runTarget}, last queue ${lastQueue.pickable} pickable)`}; /watchdog resume when ready.`, "warning");
				break;
			case "done":
				clearTimers();
				audit("done", { leftovers: t.action.leftovers, target: runTarget });
				notify(`drain-watchdog DONE: drain queue empty${t.action.leftovers ? " with leftover blockers" : ""}, no children running.`, "info");
				runTarget = null;
				break;
			case "probe":
				audit("probe-scheduled", { rung: state.backoffRung, delayMs: t.action.delayMs });
				scheduleProbe(t.action.delayMs);
				break;
		}
	};

	const tick = async () => {
		if (closed || tickInFlight) return; // M1: shutdown may land between setInterval ticks.
		const ctx = latestCtx;
		if (ctx === null) return;
		const now = Date.now();
		// Any activity resets the idle clock and skips the tick (flow.html section 2).
		if (!ctx.isIdle() || ctx.hasPendingMessages() || uiPromptDepth > 0) {
			idleSinceMs = now;
			return;
		}
		if (state.phase !== "armed" && state.phase !== "finalizing") {
			if (state.phase === "backoff") return; // only the probe ladder drives BACKOFF
			clearTimers();
			return;
		}
		if (now - idleSinceMs < idleGraceMs) return;
		if (now < state.nextAllowedAt) return;
		tickInFlight = true;
		try {
			const previousQueue = { ...lastQueue };
			const q = await runQueueCommand(ctx);
			if (closed) return; // M1: shutdown landed while the queue command was running.
			const observedAt = Date.now();
			const obs: TickObservation = {
				running: false,
				pendingMessages: false,
				childCount,
				allIdleForMs: observedAt - idleSinceMs,
				queueOk: q.ok,
				pickable: q.pickable,
				inflight: q.inflight,
				progressAgeMs: observedAt - progressSinceMs,
				// Provider errors are reported once, from the run outcome, via the
				// providerError event — re-reporting the same failure every tick would
				// escalate the ladder without probes.
				lastError: null,
				// The count-only contract cannot express which tickets block which,
				// so DONE-with-leftovers observation is not available here.
				leftoverBlocked: false,
				// Closing-step detection is the #34 flow; plain DONE on an empty frontier.
				hasClosingSteps: false,
			};
			// L2: assign before `apply` so a nudge/pause/audit in this same apply call
			// reports THIS tick's pickable count, not the previous tick's (or arm-time's).
			lastQueue = { pickable: q.pickable, inflight: q.inflight };
			apply(transition(state, { type: "tick", obs }, observedAt), "tick");
			if (q.ok && queueFingerprint(lastQueue) !== queueFingerprint(previousQueue)) {
				// Queue fingerprint change counts as progress (design section 2).
				progressSinceMs = observedAt;
				apply(transition(state, { type: "progress" }, observedAt), "queue-change");
			}
		} catch (e) {
			// H2: `startLoop` fires `void tick()` with no caller-side catch, so any throw
			// here (runQueueCommand's own containment only covers its exec calls;
			// apply/appendEntry/sendMessage can still throw) becomes an unhandled
			// rejection unless it is caught and paused right here. Fail-closed: pause,
			// never silently continue, never DONE.
			try {
				apply(toPaused(state, `tick failed: ${String(e)}`), "tick-error");
			} catch {
				// State mutation itself is failing (e.g. appendEntry down); nothing more
				// can be done safely from inside the tick's own error path.
			}
		} finally {
			tickInFlight = false;
		}
	};

	const notifyStatus = () => {
		const bits = [`phase ${state.phase}`];
		if (state.pausedReason !== null) bits.push(`reason: ${state.pausedReason}`);
		if (runTarget !== null) bits.push(`run target #${runTarget}`);
		if (state.phase === "armed" || state.phase === "backoff" || state.phase === "finalizing") {
			bits.push(`nudges ${state.nudgeCount}`, `no-progress ${state.noProgressStreak}`, `queue ${lastQueue.pickable}/${lastQueue.inflight}`, `children ${childCount}`);
		}
		notify(`drain-watchdog: ${bits.join(" ")}`);
	};

	const collectTargetCandidates = async (ctx: ExtensionCommandContext): Promise<number[]> => {
		const found = new Set<number>();
		// Session context: issue numbers mentioned in the conversation (best-effort
		// scan; a failed scan leaves the branch fallback below).
		try {
			for (const entry of ctx.sessionManager.getEntries()) {
				for (const n of extractIssueNumbers(JSON.stringify(entry) ?? "")) found.add(n);
			}
		} catch {
			// keep whatever was collected so far
		}
		// Git branch containing an issue number.
		try {
			const branch = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ctx.cwd, timeout: 10_000 });
			const n = issueNumberFromBranch(branch.stdout.trim());
			if (n !== null) found.add(n);
		} catch {
			// off-repo or no git; context scan above may already have resolved
		}
		return [...found].sort((a, b) => a - b);
	};

	const runPrep = async (ref: string | null, ctx: ExtensionCommandContext) => {
		if (!ctx.hasUI) {
			notify("drain-watchdog: PREP needs an interactive UI", "error");
			return;
		}
		if (state.phase === "armed" || state.phase === "backoff") {
			notify("drain-watchdog: run already active — /watchdog off first", "warning");
			return;
		}
		if (state.phase === "paused") {
			notify("drain-watchdog: run paused — /watchdog resume, or /watchdog off to reset", "warning");
			return;
		}
		// A fresh run starts from OFF (DONE is terminal in the core; a new /watchdog
		// invocation after DONE builds a new run).
		state = { ...INITIAL_STATE };
		clearTimers();
		childCount = 0;
		probeInFlight = false;
		readyDeclared = false;
		prepTarget = null;
		runTarget = null;

		const resolution = pickTarget(ref, await collectTargetCandidates(ctx));
		if (closed) return; // M1: session_shutdown fired while scanning for a target.
		if (resolution.status === "ask") {
			const answer = resolution.candidates
				? await ctx.ui.select("drain-watchdog: multiple issue candidates — pick the run target", resolution.candidates.map((n) => `#${n}`))
				: await ctx.ui.input("drain-watchdog: no issue found in conversation or branch — enter the issue number");
			if (closed) return; // M1: session_shutdown fired while the picker was open.
			const nums = answer === undefined ? [] : extractIssueNumbers(answer);
			if (nums.length !== 1) {
				notify("drain-watchdog: PREP cancelled (no single target chosen)");
				return;
			}
			prepTarget = nums[0];
		} else {
			prepTarget = resolution.number;
		}

		const q = await runQueueCommand(ctx);
		if (closed) return; // M1: session_shutdown fired while the queue command was running.
		const refusal = armRefusal(q.pickable, q.ok);
		if (refusal !== null) {
			audit("prep-refused", { reason: refusal, error: q.error });
			notify(`drain-watchdog: ${q.error || refusal} — not armed`, "error");
			return;
		}
		prepPickable = q.pickable;
		prepInflight = q.inflight;
		audit("prep-proof", { target: prepTarget, pickable: q.pickable, inflight: q.inflight });
		notify(`drain-watchdog PREP: target #${prepTarget}, ${q.pickable} pickable, ${q.inflight} inflight. Waiting for the model's readiness proof (READY) then your confirmation.`, "info");
		pi.sendUserMessage(PREP_INSTRUCTION(prepTarget, q.pickable));
	};

	const runWatchdogCommand = async (rawArgs: string, ctx: ExtensionCommandContext) => {
		const cmd = parseWatchdogSubcommand(rawArgs);
		switch (cmd.sub) {
			case "status":
				notifyStatus();
				return;
			case "off": {
				if (state.phase === "done" || state.phase === "off") {
					state = { ...INITIAL_STATE }; // DONE is terminal; off+rearm is a fresh run
				} else {
					apply(transition(state, { type: "off" }, Date.now()), "off");
				}
				runTarget = null;
				clearTimers();
				childCount = 0;
				probeInFlight = false;
				notify("drain-watchdog: off");
				return;
			}
			case "resume": {
				if (state.phase !== "paused") {
					notify(`drain-watchdog: nothing to resume (phase ${state.phase})`, "warning");
					return;
				}
				apply(transition(state, { type: "resume" }, Date.now()), "resume");
				if (state.phase === "armed") {
					idleSinceMs = progressSinceMs = Date.now();
					startLoop();
					notify("drain-watchdog resumed");
				}
				return;
			}
			case "prep":
				await runPrep(cmd.ref, ctx);
				return;
		}
	};

	// --- Event wiring ------------------------------------------------------------

	pi.registerCommand("watchdog", {
		description: "Unattended drain watchdog (PREP -> READY -> ARMED; also: resume | off | status)",
		handler: async (args, ctx) => {
			latestCtx = ctx;
			await runWatchdogCommand(args, ctx);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		latestCtx = ctx;
		closed = false; // M1: a fresh session may create timers again.
		clearTimers();
		childCount = 0;
		probeInFlight = false;
		uiPromptDepth = 0;
		prepTarget = null;
		readyDeclared = false;
		idleSinceMs = progressSinceMs = Date.now();
		const restored = restoreDrainState(ctx.sessionManager.getEntries());
		if (restored === null || restored.phase === "off" || restored.phase === "done") {
			state = { ...INITIAL_STATE };
			return;
		}
		state = restored;
		if (state.phase === "armed" || state.phase === "finalizing") {
			audit("restored", { phase: state.phase });
			startLoop();
			notify(`drain-watchdog: restored live run (${state.phase}) after restart`);
		} else if (state.phase === "backoff") {
			audit("restored", { phase: "backoff", kind: state.backoffKind, rung: state.backoffRung });
			scheduleProbe(nextLadderDelayMs(state.backoffKind ?? "transient", state.backoffRung));
			// The probe timer also needs the tick loop alive for probeOk restoration.
			startLoop();
		} else {
			// PAUSED stays paused (resume is the only exit from a paused run).
			audit("restored", { phase: "paused", reason: state.pausedReason }); // L1
			notify(`drain-watchdog: restored PAUSED — ${state.pausedReason ?? "unknown reason"}. /watchdog resume`, "warning");
		}
	});

	pi.on("session_shutdown", () => {
		// M1: no pending await (tick, agent_settled's ui.confirm, runPrep) may arm/nudge/
		// persist/start a timer after this point.
		closed = true;
		// Timers never leak past teardown; persisted state decides the next start.
		clearTimers();
	});

	const bumpIdle = () => {
		idleSinceMs = Date.now();
	};

	pi.on("agent_start", () => bumpIdle());
	pi.on("turn_start", () => bumpIdle());
	pi.on("input", () => bumpIdle());
	pi.on("ui_prompt_start", () => {
		uiPromptDepth++;
		bumpIdle();
	});
	pi.on("ui_prompt_end", () => {
		uiPromptDepth = Math.max(0, uiPromptDepth - 1);
		bumpIdle();
	});

	// pi-herdr-subagents runs children as separate pi processes that steer their
	// completion in; the known fallback (observation) is tool_call minus the
	// subagent_result completion steers. Counts restart at 0 on session_start.
	pi.on("tool_call", (event) => {
		if (isSubagentSpawnTool(event.toolName)) childCount++;
	});

	pi.on("message_end", (event) => {
		const customType = (event.message as { customType?: unknown }).customType;
		if (isSubagentCompletionNotice(customType)) {
			childCount = Math.max(0, childCount - 1);
			progressSinceMs = Date.now();
			// A completion steer is progress; the run stays live (nextAllowedAt reset).
			apply(transition(state, { type: "progress" }, Date.now()), "child-completion");
		}
		// PREP readiness proof: the model ends a turn with a bare READY line. Arm
		// confirmation happens at agent_settled, after the turn really ended.
		if (prepTarget !== null && !readyDeclared && isReadyDeclaration(messageText(event.message))) {
			readyDeclared = true;
		}
	});

	pi.on("agent_end", (event) => {
		// Reset before classifying: a probe that itself errors must not leave a stale
		// flag that launders an unrelated later run into a false probeOk.
		const wasProbe = probeInFlight;
		probeInFlight = false;
		const err = extractLastError(event.messages);
		if (err !== null) {
			// One providerError per failed run; ticks never re-report it (tick
			// observations carry lastError: null on purpose).
			apply(transition(state, { type: "providerError", kind: classifyProviderError(err) }, Date.now()), "provider-error");
		} else if (wasProbe) {
			apply(transition(state, { type: "probeOk" }, Date.now()), "probe-ok");
		}
	});

	pi.on("agent_settled", async (event, ctx) => {
		latestCtx = ctx;
		if (event.aborted) {
			// Esc always wins: a live run PAUSEs and stays paused; PREP proof dies.
			readyDeclared = false;
			prepTarget = null;
			apply(transition(state, { type: "abort" }, Date.now()), "abort");
			return;
		}
		if (readyDeclared && prepTarget !== null) {
			const target = prepTarget;
			readyDeclared = false;
			if (!ctx.hasUI) {
				notify("drain-watchdog: READY seen but no UI to confirm arming; run /watchdog again", "warning");
				prepTarget = null;
				return;
			}
			const go = await ctx.ui.confirm(
				"Arm unattended drain?",
				`The model declared READY for #${target} (${prepPickable} pickable). Arm the watchdog for an unattended run?`,
			);
			prepTarget = null;
			if (closed) return; // M1: session_shutdown fired while ui.confirm was pending.
			if (!go) {
				audit("arm-declined", { target });
				notify("drain-watchdog: operator declined; nothing armed");
				return;
			}
			armRun(target, prepPickable, prepInflight);
		}
	});
}
