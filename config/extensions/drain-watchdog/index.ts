/**
 * drain-watchdog: pure decision core + the #30/#32 live effect layer.
 *
 * Every function above the factory is deterministic and side-effect free: no
 * network, no clock, no subprocesses, no pi-API calls at runtime — this module
 * is the single pure seam the self-check asserts against (plans/drain-watchdog
 * flow.html sections 0-6, 10). The default export at the bottom is the pi
 * extension factory: the `/watchdog` command, the watchdog_target/complete/handoff/sync/done/stop
 * model tools (main sessions only), the ARMED tick loop, nudges via steer,
 * state/audit session entries, and every timer. Timers are created only
 * on arm (never in the factory body), and child sessions never reach any of it.
 *
 * Semantics locked by the design:
 *  - Esc/abort moves a running phase to PAUSED; PAUSED only leaves via `resume`
 *    (EVENT_PHASES in `transition` makes every other event a no-op there).
 *  - Child sessions (PI_SUBAGENT_ID set): the factory registers nothing — no
 *    listeners, no commands, no timers.
 *  - The queue is an extension-held, tracker-agnostic ticket tree the model
 *    declares (watchdog_target) and keeps in sync (watchdog_complete/handoff/sync);
 *    the extension never calls the tracker. A run with no tickets declared
 *    refuses/pauses; it is never interpreted as "done" or an empty queue.
 *  - Tick order is fixed and the nudge is the last resort.
 *  - #38: the harness never reads run state files or names a flow; it only sees the ticket tree.
 *    The LLM decides completion: an idle tick with an empty frontier and no
 *    child only nudges (closing steps, then watchdog_done); the tick never completes.
 *
 * `progress` is dispatched by the live loop for child completion steers and
 * ticket-tree changes (complete/handoff/sync are progress by design, flow.html
 * section 5 — the breaker stays cold). The model decides completion: `llmDone`
 * (watchdog_done) is accepted from ARMED only when the ticket tree proves
 * nothing is left (`doneRefusal`).
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


import { isRetryableAssistantError, StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
type RuntimeMessage = Parameters<typeof isRetryableAssistantError>[0];

// --- Types -------------------------------------------------------------------

export type DrainPhase = "off" | "armed" | "backoff" | "paused" | "done";

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
	/** M4: wall-clock ms of the last stallNotify; gates re-notifying every tick. */
	lastStallNotifyAt: number | null;
	/** The run's ticket tree (model-declared, persisted with the run). */
	tickets: Ticket[];
};

// --- Ticket tree (tracker-agnostic queue) ---------------------------------------

export type TicketState = "open" | "done" | "limbo";
/** Stored ticket: id is opaque (e.g. "KRIPT-222", "#38"). */
export type Ticket = { id: string; state: TicketState; blockedBy: string[]; reason?: string };
/** What the model sends: unsent fields keep their stored value (new ticket: open, no blockers). */
export type TicketInput = { id: string; state?: TicketState; blockedBy?: string[]; reason?: string };

export type TickObservation = {
	/** Main is mid-run or has pending messages / a blocking UI prompt. */
	running: boolean;
	pendingMessages: boolean;
	childCount: number;
	/** How long every activity source has been quiet. */
	allIdleForMs: number;
	/** A ticket tree is declared (false = fail closed). */
	queueOk: boolean;
	pickable: number;
	/** Time since the last counted progress event (ticket change, steer, handoff). */
	progressAgeMs: number;
	/** Error message from the last ended run, if it ended in error. */
	lastError: string | null;
};

/** What the effect layer saw when the model called watchdog_done. */
export type DoneObservation = {
	queueOk: boolean;
	pickable: number;
	childCount: number;
};

/**
 * Why a watchdog_done promise must be refused, or null when the run is really
 * finished. The model only supplies the claim; the ticket tree and the child count
 * decide. Limbo/leftover tickets never block DONE.
 */
export function doneRefusal(o: DoneObservation): string | null {
	if (!o.queueOk) return "no tickets are declared (watchdog_target); cannot verify that the run is finished";
	if (o.pickable > 0) return `${o.pickable} pickable ticket(s) remain; keep working, or mark them done (watchdog_complete) or limbo (watchdog_handoff)`;
	if (o.childCount > 0) return `${o.childCount} child session(s) are still running`;
	return null;
}

export type DrainAction =
	| { type: "wait" }
	| { type: "nudge" }
	| { type: "stallNotify" }
	| { type: "pause"; reason: string }
	| { type: "done" }
	| { type: "probe"; delayMs: number; jitter: ProbeJitter };

export type DrainEvent =
	| { type: "arm"; queueOk: boolean; pickable: number }
	| { type: "off" }
	| { type: "resume" }
	| { type: "abort" }
	| { type: "tick"; obs: TickObservation }
	// `message` is the raw provider error text; the #32 reset-time honor parses it at the probe seam.
	| { type: "providerError"; kind: ProviderErrorKind; message?: string }
	| { type: "probeOk" }
	| { type: "llmStop"; reason?: string }
	// watchdog_done: the model's "promise". Carries the effect layer's live
	// observation; the core accepts it only when `doneRefusal` finds nothing left.
	| { type: "llmDone"; obs: DoneObservation }
	| { type: "progress" };

export type DrainTransition = {
	state: DrainState;
	action: DrainAction;
	refusal: string | null;
};

// --- Design-default parameters -----------------------------------------------

// ponytail: worst-case nudge latency after idle = IDLE_GRACE_MS + TICK_MS (the idle gate is only
// evaluated on a tick); fixed to 60s + 15s; add a one-shot idleSince+grace timer if a tick this
// frequent ever costs too much (each post-grace tick reads the ticket tree).
export const IDLE_GRACE_MS = 60_000;
export const TICK_MS = 15_000;
export const STALL_LIMIT_MS = 45 * 60_000;
export const BREAKER_K = 4;
export const HARD_CAP = 30;
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
	lastStallNotifyAt: null,
	tickets: [],
};

// --- Ticket tree functions ------------------------------------------------------

/** Reminder carried by tool results, nudges, PREP text and promptGuidelines. */
export const SYNC_REMINDER =
	"Keep ticket status in sync with the source tracker: move each ticket there when you call watchdog_complete / watchdog_handoff, and call watchdog_sync when the source changes unexpectedly (new, cancelled or re-blocked tickets).";

const TICKET_STATES: readonly TicketState[] = ["open", "done", "limbo"];

/** Boundary validation of model-sent tickets; fails closed on any malformed entry. */
export function parseTicketInputs(raw: unknown): { ok: true; tickets: TicketInput[] } | { ok: false; error: string } {
	if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "tickets must be a non-empty array" };
	const seen = new Set<string>();
	const tickets: TicketInput[] = [];
	for (const item of raw) {
		if (typeof item !== "object" || item === null) return { ok: false, error: "every ticket must be an object" };
		const t = item as Record<string, unknown>;
		if (typeof t.id !== "string" || t.id.trim() === "") return { ok: false, error: "every ticket needs a non-empty string id" };
		if (seen.has(t.id)) return { ok: false, error: `duplicate ticket id ${JSON.stringify(t.id)}` };
		seen.add(t.id);
		if (t.state !== undefined && !TICKET_STATES.includes(t.state as TicketState)) return { ok: false, error: `ticket ${t.id}: state must be open, done or limbo` };
		if (t.blockedBy !== undefined && (!Array.isArray(t.blockedBy) || t.blockedBy.some((b) => typeof b !== "string"))) return { ok: false, error: `ticket ${t.id}: blockedBy must be an array of ids` };
		if (t.reason !== undefined && typeof t.reason !== "string") return { ok: false, error: `ticket ${t.id}: reason must be a string` };
		tickets.push({ id: t.id, state: t.state as TicketState | undefined, blockedBy: t.blockedBy as string[] | undefined, reason: t.reason as string | undefined });
	}
	return { ok: true, tickets };
}

/** Pickable = open and every blocker is a known, done ticket (unknown blocker = not done: fail closed). */
export function pickableIds(tickets: readonly Ticket[]): string[] {
	const byId = new Map(tickets.map((t) => [t.id, t]));
	return tickets.filter((t) => t.state === "open" && t.blockedBy.every((b) => byId.get(b)?.state === "done")).map((t) => t.id);
}

/** Counts for the done report; leftover = open but not pickable (blocked by limbo, unknown or cyclic blockers). */
export function ticketCounts(tickets: readonly Ticket[]): { done: number; limbo: number; leftover: string[] } {
	const pickable = new Set(pickableIds(tickets));
	return {
		done: tickets.filter((t) => t.state === "done").length,
		limbo: tickets.filter((t) => t.state === "limbo").length,
		leftover: tickets.filter((t) => t.state === "open" && !pickable.has(t.id)).map((t) => t.id),
	};
}

/** Upsert by id; unsent fields stay; no deletion; any state transition allowed. */
export function upsertTickets(current: readonly Ticket[], inputs: readonly TicketInput[]): { tickets: Ticket[]; summary: string; closed: string[]; changed: number } {
	const tickets = current.map((t) => ({ ...t }));
	const tally = new Map<string, number>();
	const closed: string[] = [];
	let changed = 0;
	const bump = (label: string) => {
		changed++;
		tally.set(label, (tally.get(label) ?? 0) + 1);
	};
	for (const input of inputs) {
		const idx = tickets.findIndex((t) => t.id === input.id);
		if (idx < 0) {
			const fresh: Ticket = { id: input.id, state: input.state ?? "open", blockedBy: input.blockedBy ?? [] };
			if (input.reason !== undefined) fresh.reason = input.reason;
			tickets.push(fresh);
			bump("new");
			if (fresh.state !== "open") closed.push(fresh.id);
			continue;
		}
		const old = tickets[idx]!;
		const next: Ticket = { id: old.id, state: input.state ?? old.state, blockedBy: input.blockedBy ?? old.blockedBy };
		const reason = input.reason ?? old.reason;
		if (reason !== undefined) next.reason = reason;
		const same = next.state === old.state && next.reason === old.reason && next.blockedBy.length === old.blockedBy.length && next.blockedBy.every((b, i) => b === old.blockedBy[i]);
		if (same) continue;
		bump(next.state !== old.state ? `${old.state}->${next.state}` : "updated");
		if (next.state !== "open") closed.push(next.id);
		tickets[idx] = next;
	}
	const parts = [...tally].map(([label, n]) => `${n} ${label}`);
	return { tickets, summary: `${changed} changed${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`, closed, changed };
}

export type TicketEdit = { ok: true; tickets: Ticket[] } | { ok: false; error: string };

/** watchdog_complete: mark a known ticket done (idempotent). Unknown id fails closed. */
export function completeTicket(tickets: readonly Ticket[], id: string): TicketEdit {
	if (!tickets.some((t) => t.id === id)) return { ok: false, error: `unknown ticket ${JSON.stringify(id)}; declare it with watchdog_sync first` };
	return { ok: true, tickets: tickets.map((t) => (t.id === id ? { ...t, state: "done" as const } : t)) };
}

/** watchdog_handoff: mark a known ticket limbo (human review) with a required reason. */
export function handoffTicket(tickets: readonly Ticket[], id: string, reason: string): TicketEdit {
	if (reason.trim() === "") return { ok: false, error: "reason must not be empty" };
	if (!tickets.some((t) => t.id === id)) return { ok: false, error: `unknown ticket ${JSON.stringify(id)}; declare it with watchdog_sync first` };
	return { ok: true, tickets: tickets.map((t) => (t.id === id ? { ...t, state: "limbo" as const, reason: reason.trim() } : t)) };
}

/** The final report carried by the accepted watchdog_done result, notification and audit. */
export function doneReport(tickets: readonly Ticket[]): string {
	const { done, limbo, leftover } = ticketCounts(tickets);
	const lines = [`DONE: ${done} done, ${limbo} limbo, ${leftover.length} blocked-by-limbo.`];
	const limboTickets = tickets.filter((t) => t.state === "limbo");
	if (limboTickets.length > 0) lines.push(`Limbo (needs human review): ${limboTickets.map((t) => `${t.id} — ${t.reason ?? "no reason recorded"}`).join("; ")}`);
	if (leftover.length > 0) lines.push(`Not worked (blocked by limbo, unknown or cyclic blockers): ${leftover.join(", ")}`);
	return lines.join("\n");
}

function isStoredTicket(value: unknown): value is Ticket {
	if (typeof value !== "object" || value === null) return false;
	const t = value as Record<string, unknown>;
	return typeof t.id === "string" && TICKET_STATES.includes(t.state as TicketState) && Array.isArray(t.blockedBy) && t.blockedBy.every((b) => typeof b === "string") && (t.reason === undefined || typeof t.reason === "string");
}

// --- Arm gating ---------------------------------------------------------------

/** Refusal reason for arming, or null when the run may arm. */
export function armRefusal(pickable: number, queueOk: boolean): string | null {
	if (!queueOk) return "no tickets declared; refusing to arm";
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
	// Real stack text: "All claude accounts have exhausted their quota (cached quota
	// state, no upstream attempt; ...)" — without these it classified unknown and
	// the breaker paused the run mid quota window.
	/exhausted their quota/i,
	/cached quota state/i,
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
 * Probe-jitter policy for the #32 backoff effect path.
 *
 * - `symmetric` (±20%, `jitteredDelayMs`): default for pure ladder steps, so
 *   parallel sessions wake the provider apart on recovery.
 * - `after` (0…+20%, `jitterAfterMs`): a reset-time-driven probe may only fire
 *   AT or AFTER the advertised reset instant — an early wake fails for certain
 *   and would burn the one probe the ladder bought.
 */
export type ProbeJitter = "symmetric" | "after";

/** Minute/hour/second unit table for REL_RESET_RE capture 2 (keyed by first letter). */
const RESET_UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, s: 1_000 };

/** Probe text: a minimal nudge, not a prompt (flow.html section 6). */
export const PROBE_TEXT = "drain-watchdog probe: continue the drain flow.";

/** Any "reset/retry/try again ... at/after/in" hint — cheap pre-filter before the precise parses. */
const RESET_HINT = /\b(?:resets?|try again|retry)\b[^.\n]*\b(?:at|after|in)\b/i;
/** Relative reset: "reset after 5m", "resets in 30 minutes", "retry after 300 seconds". */
const REL_RESET_RE = /\b(?:reset|resets|retry|try again)[^\d\n]{0,20}(\d{1,4})\s*(m(?:in(?:ute)?)?s?|h(?:our)?s?|s(?:econd)?s?)\b/i;
/** Absolute ISO-ish reset: "reset at 2026-01-31T14:32" (date required — "at 14:32" is the clock form). */
const ISO_RESET_RE = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?\b/;
/** Clock-time reset: "resets at 14:32" / "reset at 2:07:00 PM" (pad via 24h conversion). */
const CLOCK_RESET_RE = /\b(?:reset|resets|retry|try again)[^.\n]{0,20}at\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(AM|PM)?/i;

/** Probe text goes to the model as a steer; keep it structurally minimal and distinct. */
export function isProbeText(content: string): boolean {
	return content === PROBE_TEXT;
}

/**
 * Reset time carried by a provider error, as a delay in ms from `now`.
 *
 * Accepted (loose, English provider texts; case-insensitive):
 *   "reset after 5m" / "resets in 5 minutes" / "retry after 300 seconds"
 *   "try again after 90m" — a window over MAX_RESET_DELAY_MS is unusable (null);
 *   "resets at 14:32"           — clock time (HH:MM or HH:MM:SS), today or +1 day, LOCAL
 *   "reset at 2026-01-31T14:32" — ISO-ish date-time (offset-less forms parse LOCAL)
 *
 * Returns null when the text carries no usable reset time (caller keeps the
 * ladder step): no hint, a window over MAX_RESET_DELAY_MS (any form), or a
 * relative window of 0. An absolute instant that already passed (clock skew,
 * provider slack) is usable and clamps to 0, so it probes immediately. A reset
 * inside the window is honored as-is.
 *
 * MAX_RESET_DELAY_MS ceiling (ponytail: fixed to 30 min; raise toward the 3 h
 * quota rung when a real provider advertises a longer window): a longer window
 * is not honored and the ladder step applies instead (extra early probes, never
 * a probe that out-waits the run). The outage budget stays the long-horizon
 * bound and pauses loudly.
 * Clock form: built with local `setHours`, so a DST transition can skew it by
 * +-1 h; the cap check bounds that harm (delay lands in [0, cap] or null).
 */
export const MAX_RESET_DELAY_MS = 30 * 60_000;
export function parseResetTimeMs(message: string, now: number): number | null {
	if (!RESET_HINT.test(message)) return null;
	const rel = REL_RESET_RE.exec(message);
	if (rel !== null) {
		const n = Number.parseInt(rel[1]!, 10);
		const ms = n * RESET_UNITS[rel[2]![0]!.toLowerCase()]!;
		if (ms <= 0 || ms > MAX_RESET_DELAY_MS) return null;
		return ms;
	}
	const iso = ISO_RESET_RE.exec(message);
	if (iso !== null) {
		const t = Date.parse(iso[0]!);
		if (Number.isNaN(t)) return null;
		const delay = Math.max(t - now, 0);
		return delay > MAX_RESET_DELAY_MS ? null : delay;
	}
	const clock = CLOCK_RESET_RE.exec(message);
	if (clock === null) return null;
	const [hh, mm, ss] = clock[1]!.split(":").map(Number);
	if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
	const ampm = clock[2]?.toUpperCase();
	const hour24 = ampm === "PM" && hh < 12 ? hh + 12 : ampm === "AM" && hh === 12 ? 0 : hh;
	const target = new Date(now);
	target.setHours(hour24, mm!, ss ?? 0, 0);
	if (target.getTime() <= now) target.setDate(target.getDate() + 1);
	const delay = target.getTime() - now;
	return delay > MAX_RESET_DELAY_MS ? null : delay;
}

/**
 * Probe delay for a provider error at `now`, on `kind`'s ladder at `rung`.
 * A parsed reset time overrides (clamped) the ladder step; a plain ladder
 * step comes back symmetric-jitter, a reset-driven step `after`-jitter.
 */
export function probeDelayForError(
	message: string,
	now: number,
	kind: "transient" | "quota",
	rung: number,
): { delayMs: number; jitter: ProbeJitter } {
	const reset = parseResetTimeMs(message, now);
	if (reset !== null) return { delayMs: reset, jitter: "after" };
	return { delayMs: nextLadderDelayMs(kind, rung), jitter: "symmetric" };
}

/**
 * Jittered delay: `baseMs` scaled into ±20% by an injected `r` in [0, 1)
 * (the caller passes Math.random(); the core stays pure). r outside [0, 1] is
 * clamped and NaN is treated as the midpoint, so a bad source never widens the
 * band.
 */
export function jitteredDelayMs(baseMs: number, r: number): number {
	const unit = Number.isNaN(r) ? 0.5 : Math.min(Math.max(r, 0), 1);
	return Math.round(baseMs * (1 - JITTER_FRACTION + 2 * JITTER_FRACTION * unit));
}

/**
 * Upward-only jitter for reset-driven probes: `baseMs` scaled into [baseMs,
 * baseMs*1.2] by an injected `r` in [0, 1). A probe waiting out a provider's
 * reset instant may fire AT or AFTER the advertised time — never before it,
 * or the wake fails for certain. Bounds/clamp/NaN follow `jitteredDelayMs`.
 */
export function jitterAfterMs(baseMs: number, r: number): number {
	const unit = Number.isNaN(r) ? 0.5 : Math.min(Math.max(r, 0), 1);
	return Math.round(baseMs * (1 + JITTER_FRACTION * unit));
}

// NOTE (recorded): the cooldown ladder is keyed on the run's TOTAL nudge
// count, not the no-progress streak, so after 5 nudges every re-nudge waits 30
// min even with progress in between. Design wording ("grows per nudge without
// progress") is ambiguous; revisit when #35 shows real stall-recovery timing.
function nudgeLadderDelayMs(nudgeNumber: number): number {
	return NUDGE_LADDER_MIN[Math.min(Math.max(nudgeNumber - 1, 0), NUDGE_LADDER_MIN.length - 1)] * 60_000;
}

// --- Tool gate -----------------------------------------------------------------

/**
 * Ticket/stop/done tool availability gate. The tools exist only in the
 * main-session factory, but a registered tool must still refuse when the
 * factory somehow runs in a child context (children can NEVER invoke them,
 * flow.html section 5) and when no watchdog run is live (nothing to update,
 * nothing to pause). Smallest sound no-active-run behavior: an error result —
 * a ticket edit would otherwise look recorded when it did nothing.
 */
export type ToolGate =
	| { ok: true }
	| { ok: false; error: string };

export type WatchdogToolKind = "complete" | "handoff" | "sync" | "stop" | "done";

export function watchdogToolGate(kind: WatchdogToolKind, childSession: boolean, phase: DrainPhase): ToolGate {
	if (childSession) return { ok: false, error: `watchdog_${kind} is main-session only; child sessions cannot invoke it` };
	if (phase === "off" || phase === "done") return { ok: false, error: `watchdog_${kind} ignored: no active watchdog run (phase ${phase}); arm one with /watchdog first` };
	return { ok: true };
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

/**
 * watchdog_target availability gate: main session only, and only while a
 * discovery request from /watchdog is pending (the model must not choose a run
 * target on its own initiative). `/watchdog` always starts with discovery: the
 * tracker is the model's business, never the extension's.
 */
export function targetToolGate(childSession: boolean, discovering: boolean): ToolGate {
	if (childSession) return { ok: false, error: "watchdog_target is main-session only; child sessions cannot invoke it" };
	if (!discovering) return { ok: false, error: "watchdog_target ignored: no target selection is pending; the operator starts one with /watchdog" };
	return { ok: true };
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

/**
 * Nudge text (flow.html section 2): tell the model to never stop with a
 * question, continue its flow, and hand off what it may not work on.
 */
export function buildNudgeText(p: { target: string | null; pickable: number }): string {
	const target = p.target === null ? "the accepted tickets" : p.target;
	if (p.pickable <= 0) {
		// Empty frontier, no child: the LLM decides it is finished (the tick never completes the run).
		return [
			`drain-watchdog: unattended run on ${target}; you are idle with no pickable ticket and no child running.`,
			"No pickable ticket and no child running: finish any closing steps (merge, PR, cleanup), then call watchdog_done; do not open new work. The watchdog verifies the ticket tree and completes the run at once.",
			SYNC_REMINDER,
		].join("\n");
	}
	return [
		`drain-watchdog: unattended run on ${target}; you are idle with ${p.pickable} pickable ticket(s) in the watchdog ticket tree. Do not ask the user — continue the drain flow you are running now. Work in parallel, not one ticket at a time: read the frontier fresh and, while slots are free (PARALLEL_WIDTH), start every independent pickable ticket at once, each in its own worktree. All work merges into the target's integration/<slug> branch, so parallel tickets stay close to the same base and conflicts stay small.`,
		"Ambiguous or product-question tickets, and low-tolerance work (auth/authz, secrets/credentials, DB migrations, public API contracts, money/billing, data deletion, irreversible operations), must leave the tree through watchdog_handoff (limbo, human review) instead of waiting; finished tickets go through watchdog_complete.",
		SYNC_REMINDER,
		"When no pickable ticket is left and no child is running, finish any closing steps (merge, PR, cleanup), then call watchdog_done; do not open new work.",
	].join("\n");
}


// --- Operator UI (persistent widget + command completion) --------------------

export type WidgetView = {
	phase: DrainPhase;
	/** PREP in flight while the core is still OFF: discovery or arm confirmation. */
	prep: "discover" | "proof" | null;
	target: string | null;
	pickable: number;
	children: number;
	nudgeCount: number;
	noProgressStreak: number;
	idleMs: number;
	/** Time until the watchdog may nudge (idle grace and cooldown); 0 = due at the next tick. */
	nudgeInMs?: number;
	pausedReason: string | null;
	backoffKind: "transient" | "quota" | null;
};

const ANSI = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m" } as const;
const paint = (color: keyof typeof ANSI, text: string): string => `${ANSI[color]}${text}${ANSI.reset}`;

function clock(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The persistent watchdog widget (string[] above the editor), or null when
 * there is nothing to show (OFF without a PREP). Green ARMED, yellow
 * BACKOFF/PREP, red PAUSED, dim DONE. Pure: the effect layer
 * supplies the view and the clock.
 */
export function watchdogWidgetLines(v: WidgetView): string[] | null {
	if (v.phase === "off" && v.prep === null) return null;
	let head: string;
	let color: keyof typeof ANSI;
	let hint: string;
	let body: string;
	switch (v.phase) {
		case "armed":
			[head, color, hint] = ["\u25cf ARMED", "green", "/watchdog status \u00b7 Esc jeda \u00b7 /watchdog off"];
			break;
		case "backoff":
			[head, color, hint] = [`\u25d0 BACKOFF${v.backoffKind === null ? "" : ` (${v.backoffKind})`}`, "yellow", "probe otomatis \u00b7 Esc jeda \u00b7 /watchdog off"];
			break;
		case "paused":
			[head, color, hint] = ["\u25cb PAUSED", "red", "/watchdog resume \u00b7 /watchdog off"];
			break;
		case "done":
			[head, color, hint] = ["\u2713 DONE", "dim", "/watchdog off untuk membersihkan"];
			break;
		default:
			[head, color, hint] = [v.prep === "discover" ? "\u2026 PREP: memilih target" : "\u2026 PREP: bukti kesiapan", "cyan", "jawab pertanyaan model \u00b7 /watchdog off batal"];
	}
	const ref = v.target === null ? "(target belum dipilih)" : v.target;
	if (v.phase === "paused") body = `${v.pausedReason ?? "alasan tidak tercatat"}`;
	else if (v.phase === "off" || v.phase === "done") body = `${v.pickable} pickable terakhir`;
	else body = `${v.pickable} pickable \u00b7 ${v.children} jalan \u00b7 nudge ${v.nudgeCount}/${HARD_CAP} \u00b7 idle ${clock(v.idleMs)} \u00b7 ${v.nudgeInMs === undefined ? "" : v.nudgeInMs > 0 ? `nudge dalam ${clock(v.nudgeInMs)} \u00b7 ` : "nudge di tick berikut \u00b7 "}breaker ${v.noProgressStreak}/${BREAKER_K}`;
	return [
		`${paint(color, "\u250c")} watchdog ${paint("bold", paint(color, head))} ${paint(color, "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")}`,
		`${paint(color, "\u2502")} ${ref}`,
		`${paint(color, "\u2502")} ${v.phase === "paused" ? paint("red", body) : body}`,
		`${paint(color, "\u2514\u2500")} ${paint("dim", hint)}`,
	];
}

const WATCHDOG_SUBCOMMANDS: readonly { name: string; description: string }[] = [
	{ name: "status", description: "Tampilkan fase, target, nudge, dan antrean" },
	{ name: "resume", description: "Lanjutkan run yang PAUSED" },
	{ name: "off", description: "Matikan watchdog dan batalkan PREP" },
	{ name: "on", description: "Mulai PREP (opsional: on <ref>)" },
];

/**
 * Argument completion for `/watchdog`: only the first word completes
 * (`/watchdog sta` -> `status`); a ref or anything with a space gets none.
 */
export function watchdogCompletions(prefix: string): { value: string; label: string; description: string }[] | null {
	if (/\s/.test(prefix)) return null;
	const p = prefix.toLowerCase();
	const hits = WATCHDOG_SUBCOMMANDS.filter((c) => c.name.startsWith(p)).map((c) => ({ value: c.name, label: c.name, description: c.description }));
	return hits.length === 0 ? null : hits;
}

const STATE_ENTRY_TYPE = "drain-watchdog-state";

/** Valid DrainPhase values, for restoring persisted state without trusting it. */
const DRAIN_PHASES: readonly DrainPhase[] = ["off", "armed", "backoff", "paused", "done"];

/**
 * A live run a new PREP must not replace (the run is being observed: work,
 * backoff probe). `/watchdog off` is the way out; PAUSED has
 * its own resume path. One definition, used by the PREP guard and the status
 * detail line, so a phase added to the live loop cannot silently miss a guard
 * again.
 */
export const isActivePhase = (phase: DrainPhase): boolean => phase === "armed" || phase === "backoff";

/**
 * Latest valid persisted watchdog state from session entries (null when the
 * session has none). Entries from before the last compaction may be gone, and
 * a fresh run keeps the latest valid entry only — garbage is ignored, never
 * half-applied. ponytail: entries pruned by a null-keeping compaction can lose
 * the state; the watchdog then restores OFF and waits for /watchdog again.
 */
/**
 * Per-field shape validation for restoreDrainState. A naive `typeof value ===
 * typeof fallback` check (the original approach) breaks every nullable field:
 * `typeof null === "object"`, so a real persisted string/number value never
 * matches a `null` fallback and is wrongly discarded. Each DrainState key is
 * validated against its actual declared type instead.
 */
function isValidDrainField(key: string, value: unknown): boolean {
	switch (key) {
		case "phase":
			return typeof value === "string" && DRAIN_PHASES.includes(value as DrainPhase);
		case "noProgressStreak":
		case "nudgeCount":
		case "nextAllowedAt":
		case "backoffRung":
			return typeof value === "number" && Number.isFinite(value);
		case "backoffKind":
			return value === null || value === "transient" || value === "quota";
		case "backoffStartMs":
		case "lastStallNotifyAt":
			return value === null || (typeof value === "number" && Number.isFinite(value));
		case "pausedReason":
			return value === null || typeof value === "string";
		case "tickets":
			return Array.isArray(value) && value.every(isStoredTicket);
		default:
			return false;
	}
}

export function restoreDrainState(entries: readonly unknown[]): DrainState | null {
	// M5(c): session entries are untrusted/heterogeneous (hence every branch below
	// re-checks shape at runtime); a narrower object-literal parameter type only
	// pretended to type-check and rejected tsc's own malformed-input test cases
	// (null, a bare string, a `role`-bearing message entry) that this function
	// must tolerate.
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (typeof e !== "object" || e === null) continue;
		const entry = e as { type?: unknown; customType?: unknown; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
		if (typeof entry.data !== "object" || entry.data === null) continue;
		const data = entry.data as Record<string, unknown>;
		if (typeof data.phase !== "string" || !DRAIN_PHASES.includes(data.phase as DrainPhase)) continue;
		const merged: Record<string, unknown> = { ...INITIAL_STATE };
		for (const key of Object.keys(INITIAL_STATE)) {
			if (!Object.hasOwn(data, key)) continue;
			const value = data[key];
			// H4: `typeof value === typeof fallback` broke every nullable field
			// (backoffKind/backoffStartMs/pausedReason default to `null`, and
			// `typeof null === "object"`), so any real persisted value — a string or
			// number — never matched and silently fell back to null. That dropped a
			// restored BACKOFF's kind/start time, so session_start fell back to the
			// transient ladder (`backoffKind ?? "transient"`) and the outage budget
			// restarted (`backoffStartMs !== null && ...` always read as a fresh
			// outage) even when the real outage was a 12h quota backoff already
			// hours in. Validate each key by its real shape instead.
			if (isValidDrainField(key, value)) merged[key] = value;
		}
		return merged as DrainState;
	}
	return null;
}

/**
 * The run target (opaque id string) persisted with the state entry, restored
 * separately so the pure DrainState shape stays untouched. Latest entry wins;
 * an invalid value degrades to null.
 */
export function restoreRunTarget(entries: readonly unknown[]): string | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (typeof e !== "object" || e === null) continue;
		const entry = e as { type?: unknown; customType?: unknown; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
		if (typeof entry.data !== "object" || entry.data === null) continue;
		const value = (entry.data as { runTarget?: unknown }).runTarget;
		return typeof value === "string" && value.trim() !== "" ? value : null;
	}
	return null;
}

// --- State machine ---------------------------------------------------------------
const WAIT: DrainAction = { type: "wait" };
const stay = (state: DrainState): DrainTransition => ({ state, action: WAIT, refusal: null });

const PAUSE_REASON = {
	queue: "no tickets declared in the watchdog ticket tree",
	auth: "provider auth error; needs human",
	unknown: "repeated unknown provider errors with no progress",
	breaker: "no progress after breaker nudges; run paused",
	hardCap: "hard nudge cap reached; run paused",
	outage: "provider outage budget exhausted",
	abort: "aborted (Esc/abort)",
	llmStop: "watchdog_stop",
} as const;

/** watchdog_stop's own reason text overrides the generic llmStop reason when given. */
const stopReason = (reason: string | undefined): string =>
	reason === undefined || reason.trim() === "" ? PAUSE_REASON.llmStop : reason.trim();

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
 * `llmDone` (watchdog_done) is accepted from ARMED only, and only with a live
 * observation that `doneRefusal` clears (no pickable ticket, no children); a
 * refused claim is a no-op that keeps the run going, and the tool reports the
 * reason back to the model. BACKOFF never accepts it: a provider outage is not
 * a finished run.
 */
const EVENT_PHASES: Record<DrainEvent["type"], readonly DrainPhase[]> = {
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

/**
 * Enter/escalate BACKOFF and emit the probe action. #32: when the error text
 * carries a reset time, `probeDelayForError` overrides (clamped) the ladder
 * step; a reset-driven probe is flagged `after`-jitter so the effect layer
 * never schedules it before the advertised reset instant.
 */
function enterBackoff(
	state: DrainState,
	kind: "transient" | "quota",
	now: number,
	escalate: boolean,
	message: string | undefined,
): DrainTransition {
	const rung = escalate ? state.backoffRung + 1 : 0;
	const probe = probeDelayForError(message ?? "", now, kind, rung);
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
		action: { type: "probe", delayMs: probe.delayMs, jitter: probe.jitter },
		refusal: null,
	};
}

/**
 * The only place a nudge is recorded: breaker and hard-cap
 * gate first, then count, streak and the 3/6/12/24/30 min cooldown. There is
 * deliberately no external "nudge" event — effects must not re-record.
 */
function recordNudge(
	state: DrainState,
	now: number,
	action: { type: "nudge" },
): DrainTransition {
	if (state.noProgressStreak >= BREAKER_K) return toPaused(state, PAUSE_REASON.breaker);
	if (state.nudgeCount >= HARD_CAP) return toPaused(state, PAUSE_REASON.hardCap);
	const nudgeCount = state.nudgeCount + 1;
	return {
		state: {
			...state,
			noProgressStreak: state.noProgressStreak + 1,
			nudgeCount,
			nextAllowedAt: now + nudgeLadderDelayMs(nudgeCount),
		},
		action,
		refusal: null,
	};
}

/**
 * M2: idleGraceMs/stallLimitMs are configurable (PI_WATCHDOG_IDLE_GRACE_MS /
 * PI_WATCHDOG_STALL_LIMIT_MS, Nix module options) but the decision used to
 * always read the frozen IDLE_GRACE_MS/STALL_LIMIT_MS constants — the options
 * only changed notify/audit text, never the actual threshold. Default to the
 * constants so every pre-#30-M2 call site (including every self-check row)
 * keeps its exact behavior; only the factory's live tick() passes the
 * configured values through.
 */
export type TickConfig = { idleGraceMs: number; stallLimitMs: number };
export const DEFAULT_TICK_CONFIG: TickConfig = { idleGraceMs: IDLE_GRACE_MS, stallLimitMs: STALL_LIMIT_MS };

function handleTick(state: DrainState, obs: TickObservation, now: number, config: TickConfig): DrainTransition {
	// Cycle-start activity: legitimately busy; the effect layer resets the idle clock.
	if (obs.running || obs.pendingMessages) return stay(state);
	// Idle grace shields steer deliveries that just landed.
	if (obs.allIdleForMs < config.idleGraceMs) return stay(state);
	// Nudge cooldown (design order: cooldown gate sits before the queue observation).
	if (now < state.nextAllowedAt) return stay(state);

	if (!obs.queueOk) return toPaused(state, PAUSE_REASON.queue);

	// Children running: observe only. A stall notifies; it never nudges the main.
	if (obs.childCount > 0) {
		// M4: progressAgeMs stays >= STALL_LIMIT_MS on every tick once stalled, so
		// without a cooldown this re-notified (and would re-run any future queue
		// re-check tied to it) on EVERY tick of an already-reported stall. Only
		// re-notify once another full stall window has passed since the last one.
		if (obs.progressAgeMs >= config.stallLimitMs && (state.lastStallNotifyAt === null || now - state.lastStallNotifyAt >= config.stallLimitMs)) {
			return { state: { ...state, lastStallNotifyAt: now }, action: { type: "stallNotify" }, refusal: null };
		}
		return stay(state);
	}

	// Provider error on the last ended run hands over to the backoff path.
	if (obs.lastError !== null) return onProviderError(state, classifyProviderError(obs.lastError), now, obs.lastError);

	// Nudge is the last resort.
	return recordNudge(state, now, { type: "nudge" });
}

function onProviderError(state: DrainState, kind: ProviderErrorKind, now: number, message: string | undefined): DrainTransition {
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
		return enterBackoff({ ...state, noProgressStreak: streak }, outageKind, now, !upgrade, message);
	}
	// Outside backoff: enter at rung 0. Unknown rides the transient ladder.
	return enterBackoff({ ...state, noProgressStreak: streak }, kind === "quota" ? "quota" : "transient", now, false, message);
}

/** Fixed tick order per the design; the nudge is always the last resort. */
export function transition(state: DrainState, event: DrainEvent, now: number, config: TickConfig = DEFAULT_TICK_CONFIG): DrainTransition {
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
			return handleTick(state, event.obs, now, config);
		case "providerError":
			return onProviderError(state, event.kind, now, event.message);
		case "probeOk":
			// One successful probe restores normal behavior and resets the ladder. It is
			// NOT progress, so the no-progress streak survives: a stuck run must still
			// reach the breaker/hard cap through a provider blip.
			return stay({ ...state, phase: "armed", backoffKind: null, backoffRung: 0, backoffStartMs: null });
		case "llmStop":
			// watchdog_stop is an explicit pause: the model named environment-level breakage,
			// and its reason travels into pausedReason/audit/notify verbatim.
			return toPaused(state, stopReason(event.reason));
		case "llmDone":
			// Promise path: verified against the live observation, never taken on faith.
			// Refused -> no-op (the tool reports the reason). Accepted -> the only path to
			// DONE, so timers stop and the final report is audited.
			if (doneRefusal(event.obs) !== null) return stay(state);
			return { state: { ...state, phase: "done", pausedReason: null }, action: { type: "done" }, refusal: null };
		// L3: `breaker`/`hardCap` DrainEvents (distinct from the tick-internal
		// noProgressStreak/nudgeCount gates above, which still use PAUSE_REASON.breaker/
		// hardCap) had no dispatcher anywhere in this file — removed per their own
		// ponytail note.
		case "progress":
			// Ticket-tree changes, child steers and handoffs are progress,
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

const PREP_INSTRUCTION = (target: string, pickable: number): string =>
	`drain-watchdog PREP for ${target}: the declared ticket tree has ${pickable} pickable ticket(s). End your turn now; the operator is asked to confirm arming.\n${SYNC_REMINDER}`;

const DISCOVER_INSTRUCTION = (ref: string | null): string =>
	[
		"drain-watchdog PREP: the operator did not pick the run target yet" + (ref !== null && ref.trim() !== "" ? ` (they wrote: ${JSON.stringify(ref.trim())})` : "") + ".",
		"Find the candidate run targets yourself: the map, spec, epic, or ticket(s) this work is about, in whatever tracker this project uses. Use this conversation first, then the tracker. Never ask the operator to look anything up.",
		"Then ask the operator to choose with ask_user_question: 2-4 candidates, each labelled with its id and title, the most likely one first marked (Recommended). If exactly one candidate is clearly right, still confirm it.",
		"Call the watchdog_target tool with the chosen id (`issue`, any opaque string such as KRIPT-222 or #38) and `tickets`: the target's ticket tree, each { id, blockedBy?, state?, reason? } read from the tracker. It continues PREP for you. If no candidate exists, tell the operator and stop; do not guess.",
		SYNC_REMINDER,
	].join("\n");

export default function watchdogExtension(pi: ExtensionAPI) {
	// Child sessions never run the watchdog: no listeners, no command, no timers,
	// no state — the factory returns before registering anything (self-checked).
	if (isChildSession(process.env)) return;

	// Every tool execute() runs in the same (main-session) process that armed the
	// watchdog, so these locals ARE the live state; the gate reads them per call.

	const env = process.env as Record<string, string | undefined>;
	const tickMs = readIntEnv(env, "PI_WATCHDOG_TICK_MS", TICK_MS);
	// M2: handleTick now takes these two as a TickConfig param (passed at the
	// tick() call site below), so both can move freely in either direction —
	// previously only handleTick's own frozen IDLE_GRACE_MS/STALL_LIMIT_MS
	// constants decided, and these env values only changed notify/audit text.
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
	let widgetTimer: Timer | null = null;
	let uiPromptDepth = 0;
	let childCount = 0;
	let probeInFlight = false;
	let idleSinceMs = Date.now();
	let progressSinceMs = idleSinceMs;
	let runTarget: string | null = null;
	// PREP bookkeeping is deliberately not persisted: PREP is interactive, and an
	// unconfirmed readiness dies with the session or the next command.
	let prepTarget: string | null = null;
	// Ticket tree declared during PREP; it joins the run state on arm.
	let prepTickets: Ticket[] = [];
	// True from a discovery request (/watchdog without a single target ref) until the model
	// hands the operator's pick back through watchdog_target (or PREP is reset).
	let discovering = false;
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
		if (widgetTimer !== null) {
			clearInterval(widgetTimer);
			widgetTimer = null;
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

	/** Live view of the ticket tree: derived from state. */
	const queueView = () => ({ ok: state.tickets.length > 0, pickable: pickableIds(state.tickets).length });

	const persist = () => {
		// runTarget rides along so a restored run keeps its target label.
		// restoreDrainState ignores the extra key; restoreRunTarget reads it back.
		pi.appendEntry(STATE_ENTRY_TYPE, { ...state, runTarget });
		refreshWidget();
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
		// Countdown to the next nudge moves per second; the tick only runs per minute.
		widgetTimer = setInterval(refreshWidget, WIDGET_REFRESH_MS);
	};

	/**
	 * Probe timer at the effect boundary (#32): the core's probe action carries the
	 * base delay plus a jitter policy — `symmetric` for ladder steps (±20%,
	 * parallel wakes hit the provider apart), `after` for reset-time-driven probes
	 * (0…+20%, never before the advertised reset instant). On a failed probe
	 * delivery BACKOFF can wedge; the next real event or /watchdog resume recovers it.
	 */
	const scheduleProbe = (baseDelayMs: number, jitter: ProbeJitter = "symmetric") => {
		if (closed) return; // M1: never arm a timer after session_shutdown.
		clearProbeTimer();
		const delay = jitter === "after" ? jitterAfterMs(baseDelayMs, Math.random()) : jitteredDelayMs(baseDelayMs, Math.random());
		probeTimer = setTimeout(() => {
			probeTimer = null;
			if (closed || state.phase !== "backoff") return; // M1: shutdown may land mid-delay.
			probeInFlight = true;
			audit("probe-delivered", {});
			deliver(PROBE_MESSAGE_TYPE, PROBE_TEXT);
		}, delay);
	};


	const WIDGET_KEY = "drain-watchdog";
	const WIDGET_REFRESH_MS = 1000;

	/** Redraws the persistent widget from live state; cheap, idempotent, never throws into callers. */
	const refreshWidget = () => {
		try {
			const ctx = latestCtx;
			if (closed || ctx === null || !ctx.hasUI) return;
			const prep: WidgetView["prep"] = prepTarget !== null ? "proof" : discovering ? "discover" : null;
			const lines = watchdogWidgetLines({
				phase: state.phase,
				prep,
				target: runTarget ?? prepTarget,
				pickable: pickableIds(prepTarget !== null ? prepTickets : state.tickets).length,
				children: childCount,
				nudgeCount: state.nudgeCount,
				noProgressStreak: state.noProgressStreak,
				idleMs: Date.now() - idleSinceMs,
				nudgeInMs: Math.max(0, idleGraceMs - (Date.now() - idleSinceMs), state.nextAllowedAt - Date.now()),
				pausedReason: state.pausedReason,
				backoffKind: state.backoffKind,
			});
			ctx.ui.setWidget(WIDGET_KEY, lines === null ? undefined : lines);
		} catch {
			// A UI failure must never break a tick, a tool call, or a state transition.
		}
	};

	const armRun = (target: string, tickets: Ticket[]) => {
		const pickable = pickableIds(tickets).length;
		const t = transition(state, { type: "arm", queueOk: tickets.length > 0, pickable }, Date.now());
		if (t.refusal !== null) {
			audit("arm-refused", { reason: t.refusal });
			notify(`drain-watchdog: refusing to arm — ${t.refusal}`, "error");
			return false;
		}
		state = { ...t.state, tickets };
		runTarget = target;
		idleSinceMs = progressSinceMs = Date.now();
		childCount = 0;
		probeInFlight = false;
		persist();
		audit("armed", { target, pickable, tickets: tickets.length });
		startLoop();
		notify(`drain-watchdog ARMED on ${target}: tick every ${Math.round(tickMs / 1000)}s.`, "info");
		return true;
	};

	const apply = (t: DrainTransition, source: string) => {
		const previous = state;
		state = t.state;
		if (state !== previous) persist();
		// L1: resume/off/probeOk/restored-paused/provider-error-to-backoff change phase but
		// previously wrote no audit entry at all (only the persisted state entry); the
		// ticket requires an audit trail for every state change, not just the subset of
		// actions below that already happen to audit something.
		if (state.phase !== previous.phase) audit("transition", { from: previous.phase, to: state.phase, source });
		switch (t.action.type) {
			case "wait":
				break;
			case "nudge":
				audit("nudge", { source, streak: state.noProgressStreak, nudgeCount: state.nudgeCount, pickable: pickableIds(state.tickets).length });
				deliver(NUDGE_MESSAGE_TYPE, buildNudgeText({ target: runTarget, pickable: pickableIds(state.tickets).length }));
				break;
			case "stallNotify":
				audit("stall-notify", { children: childCount, stallLimitMs });
				notify(`drain-watchdog: children are running but no progress for ${Math.round(stallLimitMs / 60_000)}m — inspect the herdr panes; no nudge sent.`, "warning");
				break;
			case "pause":
				clearTimers();
				audit("paused", { reason: t.action.reason, target: runTarget });
				notify(`drain-watchdog PAUSED: ${t.action.reason}${runTarget === null ? "" : ` (run target ${runTarget}, ${pickableIds(state.tickets).length} pickable)`}; /watchdog resume when ready.`, "warning");
				break;
			case "done":
				clearTimers();
				audit("done", { target: runTarget, report: doneReport(state.tickets) });
				notify(`drain-watchdog ${doneReport(state.tickets)}`, "info");
				runTarget = null;
				break;
			case "probe":
				audit("probe-scheduled", { rung: state.backoffRung, delayMs: t.action.delayMs, jitter: t.action.jitter });
				scheduleProbe(t.action.delayMs, t.action.jitter);
				break;
		}
	};

	const tick = async () => {
		if (closed || tickInFlight) return; // M1: shutdown may land between setInterval ticks.
		const ctx = latestCtx;
		if (ctx === null) return;
		const now = Date.now();
		refreshWidget(); // idle clock moves between persists; ponytail: redrawn once per tick, not per second.
		// Any activity resets the idle clock and skips the tick (flow.html section 2).
		if (!ctx.isIdle() || ctx.hasPendingMessages() || uiPromptDepth > 0) {
			idleSinceMs = now;
			return;
		}
		if (state.phase !== "armed") {
			if (state.phase === "backoff") return; // only the probe ladder drives BACKOFF
			clearTimers();
			return;
		}
		if (now - idleSinceMs < idleGraceMs) return;
		if (now < state.nextAllowedAt) return;
		tickInFlight = true;
		try {
			const q = queueView();
			const observedAt = Date.now();
			const obs: TickObservation = {
				running: false,
				pendingMessages: false,
				childCount,
				allIdleForMs: observedAt - idleSinceMs,
				queueOk: q.ok,
				pickable: q.pickable,
				progressAgeMs: observedAt - progressSinceMs,
				// Provider errors are reported once, from the run outcome, via the
				// providerError event — re-reporting the same failure every tick would
				// escalate the ladder without probes.
				lastError: null,
			};
			// M2: idleGraceMs/stallLimitMs are the configured (env/module) values — the
			// core's own threshold must match the one already gating the pre-filter
			// below and the notify/audit text, or shortening either option silently
			// does nothing.
			apply(transition(state, { type: "tick", obs }, observedAt, { idleGraceMs, stallLimitMs }), "tick");
		} catch (e) {
			// H2: `startLoop` fires `void tick()` with no caller-side catch, so any throw
			// here (apply/appendEntry/sendMessage can throw) becomes an unhandled
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
		if (runTarget !== null) bits.push(`run target ${runTarget}`);
		if (isActivePhase(state.phase)) {
			bits.push(`nudges ${state.nudgeCount}`, `no-progress ${state.noProgressStreak}`, `pickable ${pickableIds(state.tickets).length}`, `children ${childCount}`);
		}
		notify(`drain-watchdog: ${bits.join(" ")}`);
	};

	/** Ticket-tree proof for a chosen target (watchdog_target hand-back); the model proves readiness next. */
	const prepProof = (target: string, tickets: Ticket[]): string | null => {
		const pickable = pickableIds(tickets).length;
		const refusal = armRefusal(pickable, tickets.length > 0);
		if (refusal !== null) {
			audit("prep-refused", { reason: refusal, target, tickets: tickets.length });
			notify(`drain-watchdog: ${refusal} — not armed`, "error");
			return `${refusal} — not armed`;
		}
		prepTarget = target;
		prepTickets = tickets;
		readyDeclared = true; // the confirm runs at agent_settled, after this turn really ends.
		refreshWidget();
		audit("prep-proof", { target, pickable, tickets: tickets.length });
		notify(`drain-watchdog PREP: target ${target}, ${pickable} pickable of ${tickets.length}. Waiting for the turn to end, then your confirmation.`, "info");
		return null;
	};

	const runPrep = (ref: string | null, ctx: ExtensionCommandContext) => {
		if (!ctx.hasUI) {
			notify("drain-watchdog: PREP needs an interactive UI", "error");
			return;
		}
		if (isActivePhase(state.phase)) {
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
		prepTickets = [];
		discovering = false;
		runTarget = null;

		// The extension never reads a tracker: the model finds the target and its
		// ticket tree and hands both back through watchdog_target.
		discovering = true;
		audit("prep-discover", { ref });
		notify("drain-watchdog PREP: asking the model to find the target and its ticket tree for you to confirm.", "info");
		pi.sendUserMessage(DISCOVER_INSTRUCTION(ref));
		refreshWidget();
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
				discovering = false;
				prepTarget = null;
				prepTickets = [];
				clearTimers();
				childCount = 0;
				probeInFlight = false;
				notify("drain-watchdog: off");
				refreshWidget();
				return;
			}
			case "resume": {
				if (state.phase !== "paused") {
					notify(`drain-watchdog: nothing to resume (phase ${state.phase})`, "warning");
					return;
				}
				// M5(c): read the phase off the transition result, not the (by-then
				// mutated-via-`apply`) outer `state` — tsc cannot see across the `apply`
				// call that `state = t.state`, so comparing the outer variable here
				// against "armed" right after the "paused" guard above reads as an
				// always-false, no-overlap comparison (TS2367) even though it is true
				// at runtime.
				const result = transition(state, { type: "resume" }, Date.now());
				apply(result, "resume");
				if (result.state.phase === "armed") {
					idleSinceMs = progressSinceMs = Date.now();
					startLoop();
					notify("drain-watchdog resumed");
				}
				return;
			}
			case "prep":
				runPrep(cmd.ref, ctx);
				return;
		}
	};

	// --- Model tools (main sessions only; flow.html sections 4-5) ----------------

	const textResult = (text: string, isError = false, details?: Record<string, unknown>): AgentToolResult =>
		({ content: [{ type: "text", text }], isError, ...(details === undefined ? {} : { details }) }) as AgentToolResult;

	/** Shared gate for the live-run ticket tools. Returns an error result or null. */
	const ticketToolGuard = (kind: WatchdogToolKind): AgentToolResult | null => {
		const gate = watchdogToolGate(kind, isChildSession(process.env), state.phase);
		if (!gate.ok) return textResult(gate.error, true);
		if (closed) return textResult(`watchdog_${kind} ignored: session is shutting down`, true);
		return null;
	};

	/** Store a changed ticket tree: progress for the breaker, persist, audit. */
	const commitTickets = (tickets: Ticket[], event: string, detail: Record<string, unknown>) => {
		const next = { ...state, tickets };
		state = next;
		progressSinceMs = Date.now();
		apply(transition(state, { type: "progress" }, Date.now()), event);
		if (state === next) persist(); // progress is a no-op in PAUSED; the tree change must still be saved
		audit(event, { ...detail, pickable: pickableIds(tickets).length });
	};

	const pickableText = (tickets: readonly Ticket[]): string => {
		const ids = pickableIds(tickets);
		return `Pickable now: ${ids.length === 0 ? "none" : ids.join(", ")}.`;
	};

	/** watchdog_stop effect: pause with the model's reason; the core owns resume. */
	const runStop = (reason: string) => {
		const trimmed = reason.trim();
		const stop = transition(state, { type: "llmStop", reason: trimmed }, Date.now());
		if (stop.state.phase === state.phase && stop.action.type === "wait") {
			// Gate already covered off/done; this is the residual no-op guard (e.g. a
			// concurrent pause landed between the gate and here).
			return { text: `watchdog_stop ignored: no active watchdog run (phase ${state.phase})` };
		}
		apply(stop, "watchdog_stop");
		return { text: `Watchdog paused: ${stop.state.pausedReason ?? PAUSE_REASON.llmStop}. /watchdog resume when ready.` };
	};

	const ticketSchema = Type.Object({
		id: Type.String({ description: "Opaque ticket id from the source tracker (e.g. KRIPT-222, #38)" }),
		state: Type.Optional(StringEnum(["open", "done", "limbo"] as const, { description: "Default open" })),
		blockedBy: Type.Optional(Type.Array(Type.String(), { description: "Ids of tickets that must be done first" })),
		reason: Type.Optional(Type.String({ description: "Why the ticket is in limbo" })),
	});

	pi.registerTool({
		name: "watchdog_complete",
		label: "Watchdog Complete",
		description: `Mark a ticket done in the watchdog ticket tree (counts as watchdog progress). Main session only. ${SYNC_REMINDER}`,
		promptSnippet: "Mark a drained ticket done in the watchdog ticket tree (progress); also move it in the source tracker",
		promptGuidelines: [SYNC_REMINDER],
		parameters: Type.Object({ id: Type.String({ description: "Ticket id to mark done" }) }),
		async execute(_id, params) {
			const refused = ticketToolGuard("complete");
			if (refused !== null) return refused;
			const edit = completeTicket(state.tickets, params.id);
			if (!edit.ok) return textResult(`watchdog_complete: ${edit.error}`, true);
			commitTickets(edit.tickets, "complete", { id: params.id });
			return textResult(`Ticket ${params.id} marked done. ${pickableText(edit.tickets)} Now move ${params.id} to its done status in the source tracker. ${SYNC_REMINDER}`, false, { id: params.id });
		},
	});

	pi.registerTool({
		name: "watchdog_handoff",
		label: "Watchdog Handoff",
		description: `Put a ticket in limbo (needs human review) with a reason; its dependents stay blocked and the watchdog keeps going with the next pickable ticket. Counts as watchdog progress. Main session only. ${SYNC_REMINDER}`,
		promptSnippet: "Move a ticket to limbo (human review) with a reason; the run continues with the next pickable ticket",
		promptGuidelines: [
			"Hand low-tolerance work (auth/authz, secrets/credentials, DB migrations, public API contracts, money/billing, data deletion, irreversible operations) and ambiguous or blocked tickets through watchdog_handoff BEFORE claiming the ticket.",
			SYNC_REMINDER,
		],
		parameters: Type.Object({
			id: Type.String({ description: "Ticket id to hand off" }),
			reason: Type.String({ description: "Why a human must review it" }),
		}),
		async execute(_id, params) {
			const refused = ticketToolGuard("handoff");
			if (refused !== null) return refused;
			const edit = handoffTicket(state.tickets, params.id, params.reason);
			if (!edit.ok) return textResult(`watchdog_handoff: ${edit.error}`, true);
			commitTickets(edit.tickets, "handoff", { id: params.id, reason: params.reason.trim() });
			return textResult(`Ticket ${params.id} is in limbo (human review). ${pickableText(edit.tickets)} Now move ${params.id} to its human-review status in the source tracker and keep going. ${SYNC_REMINDER}`, false, { id: params.id });
		},
	});

	pi.registerTool({
		name: "watchdog_sync",
		label: "Watchdog Sync",
		description: `Upsert tickets in the watchdog ticket tree by id (unsent fields stay; a new id is open, also for SPLIT children; any state transition is allowed; nothing is deleted — a ticket cancelled in the source goes to limbo with a reason). Counts as watchdog progress. Main session only. ${SYNC_REMINDER}`,
		promptSnippet: "Sync the watchdog ticket tree with the source tracker (new, re-blocked, reopened or cancelled tickets)",
		promptGuidelines: [SYNC_REMINDER],
		parameters: Type.Object({ tickets: Type.Array(ticketSchema, { description: "Tickets to upsert" }) }),
		async execute(_id, params) {
			const refused = ticketToolGuard("sync");
			if (refused !== null) return refused;
			const parsed = parseTicketInputs(params.tickets);
			if (!parsed.ok) return textResult(`watchdog_sync: ${parsed.error}`, true);
			const result = upsertTickets(state.tickets, parsed.tickets);
			if (result.changed === 0) return textResult(`watchdog_sync: 0 changed. ${pickableText(state.tickets)} ${SYNC_REMINDER}`, false, { changed: 0 });
			commitTickets(result.tickets, "sync", { summary: result.summary });
			const stopNote = result.closed.length > 0 ? ` Ticket(s) ${result.closed.join(", ")} are now done/limbo: stop any live child still working on them.` : "";
			return textResult(`watchdog_sync: ${result.summary}. ${pickableText(result.tickets)}${stopNote} ${SYNC_REMINDER}`, false, { changed: result.changed });
		},
	});

	/**
	 * watchdog_done effect: the model's promise that nothing is left. The ticket
	 * tree and child count are re-read here and the core
	 * decides; a refused promise changes nothing and the reason goes back to the
	 * model. Accepted -> DONE at once, no idle wait.
	 */
	const runDone = (): { text: string; ok: boolean } => {
		const q = queueView();
		const obs: DoneObservation = { queueOk: q.ok, pickable: q.pickable, childCount };
		const refusal = doneRefusal(obs);
		if (refusal !== null) {
			audit("done-refused", { reason: refusal, ...obs });
			refreshWidget();
			return { text: `watchdog_done refused: ${refusal}.`, ok: false };
		}
		const report = doneReport(state.tickets);
		apply(transition(state, { type: "llmDone", obs }, Date.now()), "watchdog_done");
		return { text: `Run complete. The watchdog is DONE; include this report in your final report:\n${report}`, ok: true };
	};

	pi.registerTool({
		name: "watchdog_done",
		label: "Watchdog Done",
		description:
			"Declare the unattended drain run finished. The watchdog verifies its own ticket tree (no pickable ticket), and running children; only when nothing is left does it complete the run (DONE) immediately, without waiting for idle time, and returns the done/limbo/blocked-by-limbo report. Otherwise it refuses and says what remains. Main session only.",
		promptSnippet: "Declare the drain run finished once no ticket is pickable; the watchdog verifies and completes it",
		promptGuidelines: [
			"Call watchdog_done when no pickable ticket is left, no child is running, and you have run any closing steps (merge, PR, cleanup); the watchdog verifies and refuses a premature call. Limbo and blocked-by-limbo tickets do not block DONE; copy the returned report into your final report.",
			SYNC_REMINDER,
		],
		parameters: Type.Object({}),
		async execute() {
			// Repeat call after DONE: not an error, hand back the report.
			if (state.phase === "done" && !isChildSession(process.env)) {
				return textResult(`Run already complete. The watchdog is DONE; include this report in your final report:\n${doneReport(state.tickets)}`, false, { phase: state.phase });
			}
			const gate = watchdogToolGate("done", isChildSession(process.env), state.phase);
			if (!gate.ok) return textResult(gate.error, true);
			if (closed) return textResult("watchdog_done ignored: session is shutting down", true);
			if (state.phase !== "armed") {
				return textResult(`watchdog_done ignored: phase ${state.phase} cannot complete (only armed)`, true);
			}
			try {
				const { text, ok } = runDone();
				return textResult(text, !ok, { phase: state.phase });
			} catch (e) {
				return textResult(`watchdog_done failed: ${String(e)}`, true);
			}
		},
	});

	pi.registerTool({
		name: "watchdog_stop",
		label: "Watchdog Stop",
		description:
			"Pause the unattended drain run for environment-level breakage (tracker auth gone, dirty repo, disk full) — not for single-ticket problems. Records the reason in the audit trail; /watchdog resume continues afterwards. Main session only.",
		promptSnippet: "Pause the drain watchdog run for environment-level breakage, reason audited",
		promptGuidelines: [
			"Use watchdog_stop only for environment-level breakage (tracker auth gone, repo broken, disk full); hand single-ticket problems through watchdog_handoff instead.",
			SYNC_REMINDER,
		],
		parameters: Type.Object({
			reason: Type.String({ description: "What broke in the environment, for the audit trail and the operator" }),
		}),
		async execute(_id, params, _signal, _update, _toolCtx) {
			const gate = watchdogToolGate("stop", isChildSession(process.env), state.phase);
			if (!gate.ok) return textResult(gate.error, true);
			if (closed) return textResult("watchdog_stop ignored: session is shutting down", true);
			const { text } = runStop(params.reason);
			if (closed) return textResult("watchdog_stop raced session shutdown; re-run it after restart (state is persisted).", true);
			return textResult(text, false, { pausedReason: state.pausedReason });
		},
	});

	pi.registerTool({
		name: "watchdog_target",
		label: "Watchdog Target",
		description: `Hand the operator-chosen run target and its ticket tree back to a pending /watchdog PREP. Only valid after /watchdog asked you to find the target and the operator chose one. \`issue\` is an opaque id (e.g. KRIPT-222, #38). \`tickets\` is the target's tree read from the tracker: every ticket with its blockers. Main session only. ${SYNC_REMINDER}`,
		promptSnippet: "Hand the operator-chosen run target and its ticket tree back to a pending /watchdog PREP",
		promptGuidelines: [
			"Use watchdog_target only when /watchdog asked you to find the run target and the operator chose one; never choose a target on your own.",
			SYNC_REMINDER,
		],
		parameters: Type.Object({
			issue: Type.String({ description: "Opaque id of the run target the operator chose (map, spec, epic or ticket)" }),
			tickets: Type.Array(ticketSchema, { description: "The ticket tree to drain: id, blockedBy, optional state" }),
		}),
		async execute(_id, params) {
			const gate = targetToolGate(isChildSession(process.env), discovering);
			if (!gate.ok) return textResult(gate.error, true);
			if (closed) return textResult("watchdog_target ignored: session is shutting down", true);
			const issue = typeof params.issue === "string" ? params.issue.trim() : "";
			if (issue === "") return textResult(`watchdog_target: ${JSON.stringify(params.issue)} is not a usable target id`, true);
			const parsed = parseTicketInputs(params.tickets);
			if (!parsed.ok) return textResult(`watchdog_target: ${parsed.error}`, true);
			const tickets = upsertTickets([], parsed.tickets).tickets;
			discovering = false; // one pick per request; a refused proof needs a fresh /watchdog.
			audit("prep-target", { target: issue, tickets: tickets.length });
			const error = prepProof(issue, tickets);
			if (error !== null) return textResult(`watchdog_target: ${error}`, true);
			return textResult(`Target ${issue} accepted.\n${PREP_INSTRUCTION(issue, pickableIds(tickets).length)}`, false, { issue });
		},
	});

	// --- Event wiring ------------------------------------------------------------

	pi.registerCommand("watchdog", {
		description: "Unattended drain watchdog (PREP -> ARMED; also: resume | off | status)",
		getArgumentCompletions: watchdogCompletions,
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
		prepTickets = [];
		discovering = false;
		readyDeclared = false;
		idleSinceMs = progressSinceMs = Date.now();
		const restored = restoreDrainState(ctx.sessionManager.getEntries());
		if (restored === null || restored.phase === "off" || restored.phase === "done") {
			state = { ...INITIAL_STATE };
			return;
		}
		state = restored;
		// #38 C: keep the run target across a restart (targeted state read).
		runTarget = restoreRunTarget(ctx.sessionManager.getEntries());
		if (state.phase === "armed") {
			audit("restored", { phase: state.phase });
			startLoop();
			refreshWidget();
			notify(`drain-watchdog: restored live run (${state.phase}) after restart`);
		} else if (state.phase === "backoff") {
			audit("restored", { phase: "backoff", kind: state.backoffKind, rung: state.backoffRung });
			// #32: the raw error text is not persisted, so a restored BACKOFF re-probes on
			// the ladder step (symmetric jitter); only the live outage that just parsed a
			// reset time gets the reset-driven `after` jitter. The outage budget still
			// measures from the restored backoffStartMs, so no budget time is lost.
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
	});

	pi.on("agent_end", (event) => {
		// Reset before classifying: a probe that itself errors must not leave a stale
		// flag that launders an unrelated later run into a false probeOk.
		const wasProbe = probeInFlight;
		probeInFlight = false;
		const err = extractLastError(event.messages);
		if (err !== null) {
			// One providerError per failed run; ticks never re-report it (tick
			// observations carry lastError: null on purpose). The raw text rides along:
			// the #32 probe seam parses a carried reset time out of it.
			apply(transition(state, { type: "providerError", kind: classifyProviderError(err), message: err }, Date.now()), "provider-error");
		} else if (wasProbe) {
			apply(transition(state, { type: "probeOk" }, Date.now()), "probe-ok");
		}
	});

	pi.on("agent_settled", async (event, ctx) => {
		latestCtx = ctx;
		refreshWidget();
		if (event.aborted) {
			// Esc always wins: a live run PAUSEs and stays paused; PREP proof dies.
			readyDeclared = false;
			prepTarget = null;
			prepTickets = [];
			discovering = false;
			apply(transition(state, { type: "abort" }, Date.now()), "abort");
			refreshWidget();
			return;
		}
		if (readyDeclared && prepTarget !== null) {
			const target = prepTarget;
			const tickets = prepTickets;
			readyDeclared = false;
			if (!ctx.hasUI) {
				notify("drain-watchdog: no UI to confirm arming; run /watchdog again", "warning");
				prepTarget = null;
				return;
			}
			const go = await ctx.ui.confirm(
				"Arm unattended drain?",
				`Target ${target} (${pickableIds(tickets).length} pickable of ${tickets.length}). Arm the watchdog for an unattended run?`,
			);
			prepTarget = null;
			refreshWidget();
			if (closed) return; // M1: session_shutdown fired while ui.confirm was pending.
			if (!go) {
				audit("arm-declined", { target });
				notify("drain-watchdog: operator declined; nothing armed");
				return;
			}
			if (!armRun(target, tickets)) return;
			// Kick-off: the operator just confirmed, the turn has settled, and the queue
			// is non-empty — start the first pass now instead of waiting a full idle
			// grace for the first nudge. Not a core nudge: no nudgeCount, no cooldown.
			const pickable = pickableIds(tickets).length;
			audit("kickoff", { target, pickable });
			deliver(NUDGE_MESSAGE_TYPE, buildNudgeText({ target, pickable }));
		}
	});
}
