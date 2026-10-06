/**
 * Pure screen layout for the ask_user dialog.
 *
 * Zero imports — this module is also loaded by the self-check outside pi,
 * where @earendil-works/* packages do not resolve.
 *
 * The rendered shape is a CONTRACT with herdr-web-ui's fallback-menu parser
 * (server/prompt.ts): a numbered menu that owns the screen's end becomes a
 * chat card with one button per option, each button typing that option's
 * digit — no Enter suffix, so mobile answering needs no keyboard and no
 * space key. Rules honored here (herdr-web-ui 0.3.49 regexes, ported in the
 * self-check):
 *   - every option renders as `N. label` (cursor marker ❯ on at most one row)
 *   - the hint line is the LAST line and says what to do (select/choose/esc),
 *     never ends like an input field, and carries no arrow glyphs
 *   - no "(x)" letter-key suffixes and no hint-like lines between rows
 *   - checked multiselect rows use an [x] mark inside the label, never a
 *     second selected-marker
 */

export const ANSWER_LIMITS = { maxQuestions: 4, maxOptions: 9 } as const;

export type AskType = "text" | "confirm" | "select" | "multiselect";

export interface OptionItem {
	label: string;
	description?: string;
}

export interface QuestionSpec {
	question: string;
	type: AskType;
	options: OptionItem[];
	allowCustom: boolean;
	default?: string;
}

export interface AnswerRecord {
	questionIndex: number;
	question: string;
	kind: "option" | "custom" | "multi";
	answer: string | string[] | null;
	/** chosen labels for multi; mirror of answer when both are set */
	selected?: string[];
}

/** Normalize raw tool params into a QuestionSpec with concrete option rows. */
export function normalizeQuestion(raw: {
	question: string;
	type?: AskType;
	options?: Array<string | OptionItem>;
	allow_custom?: boolean;
	default?: string;
}): QuestionSpec {
	const type: AskType = raw.type ?? "text";
	let options: OptionItem[] = [];
	if (type === "confirm") {
		options = [
			{ label: "Yes", description: raw.allow_custom ? undefined : undefined },
			{ label: "No" },
		];
	} else if (type === "select" || type === "multiselect") {
		options = (raw.options ?? []).map((option) =>
			typeof option === "string" ? { label: option } : { label: option.label, description: option.description },
		);
	}
	return {
		question: raw.question,
		type,
		options,
		allowCustom: raw.allow_custom ?? type !== "confirm",
		default: raw.default,
	};
}

/** The custom "Type your own answer" row, appended after the options when allowed. */
export const CUSTOM_ROW_LABEL = "Type your own answer";

/** Hint bar for a question type — always the screen's last line. */
export function hintBar(type: AskType): string {
	switch (type) {
		case "multiselect":
			return "digit = toggle · enter = done · esc = back · ctrl+c = cancel";
		case "text":
			return "digit 1 = type · enter = save · esc = back · ctrl+c = cancel";
		default:
			return "digit = pick · enter = submit · esc = back · ctrl+c = cancel";
	}
}

export interface ScreenState {
	/** cursor position over all rows (options + custom row when present) */
	cursor: number;
	/** checked option indexes (multiselect) */
	checked: Set<number>;
	/** true while the custom input editor is open */
	customActive: boolean;
	/** current draft text of the custom input */
	draft: string;
	multi: boolean;
}

/** Pure layout: one numbered row per option, blank, hint bar last. */
export class ScreenLayout {
	private readonly question: QuestionSpec;
	private readonly items: OptionItem[];
	private readonly state: ScreenState;

	constructor(
		question: QuestionSpec,
		items: OptionItem[],
		state: ScreenState,
	) {
		this.question = question;
		this.items = items;
		this.state = state;
	}

	/** Total selectable rows: options plus the custom row when allowed. */
	rowCount(): number {
		return this.items.length + (this.question.allowCustom ? 1 : 0);
	}

	/** Index of the custom row, or -1 when absent. */
	customRowIndex(): number {
		return this.question.allowCustom ? this.items.length : -1;
	}

	lines(): string[] {
		const lines: string[] = [];
		lines.push(this.question.question);
		this.items.forEach((item, index) => {
			const marker = index === this.state.cursor ? "❯" : " ";
			const checked = this.state.multi && this.state.checked.has(index) ? "[x] " : "";
			const description = item.description ? ` — ${item.description}` : "";
			lines.push(`${marker} ${index + 1}. ${checked}${item.label}${description}`);
		});
		if (this.question.allowCustom) {
			const index = this.items.length;
			const marker = index === this.state.cursor && !this.state.customActive ? "❯" : " ";
			const shown = this.state.customActive || this.state.draft ? `: ${this.state.draft}` : "";
			lines.push(`${marker} ${index + 1}. ${CUSTOM_ROW_LABEL}${shown}`);
		}
		lines.push("");
		lines.push(hintBar(this.question.type));
		return lines;
	}
}

/** Compact agent-facing envelope; details carry the full records. */
export function renderAgentAnswer(result: { answers: AnswerRecord[]; cancelled: boolean }): string {
	if (result.cancelled) {
		return "User declined to answer questions";
	}
	return result.answers
		.map((answer, index) => `${index + 1} -> ${formatAnswer(answer)}`)
		.join("\n");
}

function formatAnswer(answer: AnswerRecord): string {
	if (answer.kind === "multi") {
		const labels = answer.selected ?? (Array.isArray(answer.answer) ? answer.answer : []);
		return labels.join(", ") || "(nothing selected)";
	}
	if (answer.answer === null || answer.answer === undefined) {
		return "(no answer)";
	}
	return String(answer.answer);
}
