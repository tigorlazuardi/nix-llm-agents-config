import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Idle-debounced auto-compaction.
 *
 * Native pi threshold compaction fires mid-run ("compacts inside the same
 * agent run and resumes"), which races with in-flight work: evidence pointers,
 * pending background jobs, and follow-up bookkeeping can be summarized away.
 * This extension compacts only when the agent has settled AND stayed idle for
 * a debounce window:
 *
 * 1. On `agent_settled` (pi guarantees no automatic continuation), if context
 *    tokens >= threshold, arm a delay timer.
 * 2. Any activity (agent_start / turn_start / user input) cancels the timer.
 * 3. On fire, compaction is skipped while background jobs are still pending
 *    (bash_bg / agent_bg / monitor arms; patty's terminal `job-finished`
 *    notices disarm). The next settle cycle re-arms.
 * 4. `session_before_compact` cancels native mid-run "threshold" compaction
 *    while jobs are pending (pi re-checks after tools finish). Manual /compact
 *    and "overflow" emergencies are never cancelled.
 *
 * ponytail: patty foreground->background flips (Ctrl+Shift+B, `bg-manual`) are
 * not counted as arms; the settle + before_compact guards still apply. Track
 * them if races ever point here. Restart resets the pending count.
 */

/** Tools whose execution arms a background job. */
export const BG_ARM_TOOLS = new Set(["bash_bg", "agent_bg", "monitor"]);

/** Patty customTypes that mean a job reached a terminal state. */
export const BG_TERMINAL_NOTICES = new Set(["job-finished", "bg-timeout"]);

export function isArmTool(toolName: string): boolean {
	return BG_ARM_TOOLS.has(toolName);
}

export function isTerminalBgNotice(customType: unknown): boolean {
	return typeof customType === "string" && BG_TERMINAL_NOTICES.has(customType);
}

export function shouldAttemptCompact(tokens: number | undefined, thresholdTokens: number): boolean {
	return typeof tokens === "number" && tokens >= thresholdTokens;
}

export function readIntEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export default function (pi: ExtensionAPI) {
	const thresholdTokens = readIntEnv("PI_IDLE_COMPACT_THRESHOLD_TOKENS", 150_000);
	const delayMs = readIntEnv("PI_IDLE_COMPACT_DELAY_MS", 5_000);

	let timer: ReturnType<typeof setTimeout> | null = null;
	let pendingBg = 0;

	const disarm = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const notify = (ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info") => {
		if (ctx.hasUI) ctx.ui.notify(message, level);
	};

	pi.on("tool_call", async (event) => {
		if (isArmTool(event.toolName)) pendingBg++;
	});

	pi.on("message_end", async (event) => {
		if (isTerminalBgNotice((event.message as { customType?: unknown }).customType)) {
			pendingBg = Math.max(0, pendingBg - 1);
		}
	});

	// Any of these mean the agent woke up: cancel the pending compact.
	pi.on("agent_start", async () => disarm());
	pi.on("turn_start", async () => disarm());
	pi.on("input", async () => disarm());

	pi.on("agent_settled", async (_event, ctx) => {
		disarm();
		const tokens = ctx.getContextUsage()?.tokens;
		if (!shouldAttemptCompact(tokens, thresholdTokens)) return;
		timer = setTimeout(() => {
			timer = null;
			if (pendingBg > 0) {
				notify(ctx, `pi-idle-compact: deferred, ${pendingBg} background job(s) pending`, "warning");
				return;
			}
			notify(ctx, `pi-idle-compact: compacting at ~${tokens} tokens after ${delayMs}ms idle`);
			ctx.compact({
				onComplete: () => notify(ctx, "pi-idle-compact: compaction completed"),
				onError: (error) => notify(ctx, `pi-idle-compact: compaction failed: ${error.message}`, "error"),
			});
		}, delayMs);
	});

	// Belt and suspenders: native mid-run threshold compaction is the race we
	// are replacing. Defer it while jobs are pending; pi re-checks after tools
	// finish. Never stand between the user's /compact or an overflow rescue.
	pi.on("session_before_compact", async (event) => {
		if (event.reason !== "threshold") return;
		if (pendingBg > 0) return { cancel: true };
	});

	pi.on("session_start", async () => {
		disarm();
		pendingBg = 0;
	});
}
