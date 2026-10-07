import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Bridge rpiv's public event contract to herdr's pane-state contract.
 *
 * @juicesharp/rpiv-ask-user-question emits `rpiv:ask-user:prompt`
 * (AskUserPromptEventPayload) before waiting and `rpiv:ask-user:blocked`
 * {active} while waiting / false when resolved. The herdr pi-integration
 * (herdr-agent-state.ts) consumes `herdr:blocked` {active,label} to flip the
 * pane's blocked/working state. This extension forwards the first — and
 * forwarding nothing else: labels come from the prompt payload's first
 * question text (truncated), falling back to the tool label when absent.
 */

type RpivPromptPayload = {
	questions?: ReadonlyArray<{ question?: string }>;
};

/** Label truncation keeps herdr's blocked message one or two lines. */
const MAX_LABEL = 80;

function translateLabel(payload: RpivPromptPayload | undefined): string {
	const first = payload?.questions?.[0]?.question;
	const text = first && first.length > 0 ? first : "Ask user question";
	return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

export default function (pi: ExtensionAPI) {
	let label: string | null = null;

	pi.events.on("rpiv:ask-user:prompt", (data: RpivPromptPayload) => {
		label = translateLabel(data);
	});

	pi.events.on("rpiv:ask-user:blocked", (data: { active?: boolean }) => {
		if (data?.active === false) {
			pi.events.emit("herdr:blocked", { active: false });
			label = null;
			return;
		}
		pi.events.emit("herdr:blocked", { active: true, label: label ?? "Ask user question" });
	});
}
