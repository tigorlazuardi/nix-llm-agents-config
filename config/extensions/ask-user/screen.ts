/**
 * Pure screen layout for the ask_user dialog.
 *
 * Zero imports — this module is also loaded by the self-check outside pi,
 * where @earendil-works/* packages do not resolve.
 *
 * The rendered shape is a CONTRACT with herdr-web-ui's fallbackMenu parser
 * (server/prompt.ts): a numbered menu that owns the screen's end becomes a
 * chat card with one button per option, each button typing that option's
 * digit — no Enter suffix, so mobile answering needs no keyboard and no
 * space key. Rules honored here (verified against 0.3.49 source):
 *   - every selectable row renders `N. label` (cursor ❯ on at most one row —
 *     parser allows <= 1 selected)
 *   - at least 2 numbered rows, numbers sequential 1..n (parser rejects a
 *     single row)
 *   - the hint line is the LAST line and directly follows the last numbered
 *     row — NO blank line between (the parser's end-walk stops at blanks and
 *     any shown line after it voids the menu); it says what to do
 *     (pick/toggle/esc), never starts with ❯ › > " ' or $, never ends like
 *     an input field ("Choice: 2"), and carries no arrow glyphs (the card
 *     only offers digit/enter/esc buttons)
 *   - no "(x)" letter-key suffixes on rows (a row with its own letter key
 *     means the number may not be the key)
 *   - the only blank line sits between the header (question / step) and the
 *     first row — above the menu, where the parser's scan-up stops anyway
 */

export const ANSWER_LIMITS = { maxQuestions: 4, maxOptions: 9 } as const;

export type AskType = "text" | "confirm" | "select" | "multiselect";

/** What activating a row means. */
export type RowKind = "option" | "custom" | "skip" | "multi";

export interface OptionItem {
	label: string;
	description?: string;
}

/** A selectable row in the numbered menu. */
export interface MenuRow {
	label: string;
	kind: RowKind;
	description?: string;
}

export interface QuestionSpec {
	question: string;
	type: AskType;
	/** FINAL row list: options plus derived custom/skip rows. */
	rows: MenuRow[];
	/** index of the custom-input row, or -1 */
	customRowIndex: number;
	/** index of the skip row, or -1 */
	skipRowIndex: number;
	multi: boolean;
	/** prefill for the text question's custom input */
	default?: string;
}

export interface AnswerRecord {
	questionIndex: number;
	question: string;
	kind: "option" | "custom" | "multi" | "skip";
	answer: string | string[] | null;
	/** chosen labels for multi; mirror of answer when both are set */
	selected?: string[];
}

export const CUSTOM_ROW_LABEL = "Type your own answer";
export const SKIP_ROW_LABEL = "Skip this question";

/**
 * Normalize raw tool params into a QuestionSpec with the FINAL numbered-row
 * list. text questions get two rows (Type + Skip) because the fallback-menu
 * parser needs at least two numbered rows to recognize a menu at all.
 */
export function normalizeQuestion(raw: {
	question: string;
	type?: AskType;
	options?: Array<string | OptionItem>;
	allow_custom?: boolean;
	default?: string;
}): QuestionSpec {
	const type: AskType = raw.type ?? "text";
	const rows: MenuRow[] = [];
	if (type === "confirm") {
		rows.push({ label: "Yes", kind: "option" }, { label: "No", kind: "option" });
	} else if (type === "text") {
		rows.push({ label: CUSTOM_ROW_LABEL, kind: "custom" }, { label: SKIP_ROW_LABEL, kind: "skip" });
	} else {
		for (const option of raw.options ?? []) {
			rows.push(
				typeof option === "string"
					? { label: option, kind: "option" }
					: { label: option.label, kind: "option", description: option.description },
			);
		}
	}
	const customRowIndex =
		type === "text" ? 0 : raw.allow_custom ?? type !== "confirm" ? rows.push({ label: CUSTOM_ROW_LABEL, kind: "custom" }) - 1 : -1;
	const skipRowIndex = type === "text" ? 1 : -1;
	return { question: raw.question, type, rows, customRowIndex, skipRowIndex, multi: type === "multiselect", default: raw.default };
}

/** Hint bar for a question type — always the screen's last line, directly under the last row.
 * Kept short so narrow panes never wrap it (a wrapped tail would break the fallback card). */
export function hintBar(type: AskType): string {
	switch (type) {
		case "multiselect":
			return "digit toggle · enter done · esc back · ctrl+c cancel";
		case "text":
			return "digit choose · enter select · esc back · ctrl+c cancel";
		default:
			return "digit pick · enter submit · esc back · ctrl+c cancel";
	}
}

export interface ScreenState {
	/** cursor position over the row list */
	cursor: number;
	/** checked option indexes (multiselect) */
	checked: Set<number>;
	/** true while the custom input editor is open */
	customActive: boolean;
	/** current draft text of the custom input */
	draft: string;
	multi: boolean;
}

export interface HeaderInfo {
	/** 1-based index of the active question */
	step?: number;
	/** total questions in the batch */
	total?: number;
}

/** Pure layout: header, blank, numbered rows, hint bar — nothing after the hint. */
export class ScreenLayout {
	private readonly question: QuestionSpec;
	private readonly state: ScreenState;
	private readonly header: HeaderInfo;

	constructor(question: QuestionSpec, state: ScreenState, header: HeaderInfo = {}) {
		this.question = question;
		this.state = state;
		this.header = header;
	}

	/** Structured lines: plain text (no styling). Styling happens in the wizard. */
	lines(): string[] {
		const lines: string[] = [this.question.question];
		if (this.header.step && this.header.total && this.header.total > 1) {
			lines.push(`Question ${this.header.step} of ${this.header.total}`);
		}
		lines.push("");
		this.question.rows.forEach((row, index) => {
			const marker = index === this.state.cursor && !this.state.customActive ? "❯" : " ";
			const checked = this.state.multi && this.state.checked.has(index) ? "[x] " : "";
			const description = row.description ? ` — ${row.description}` : "";
			const draft = row.kind === "custom" && (this.state.customActive || this.state.draft) ? `: ${this.state.draft}` : "";
			lines.push(`${marker} ${index + 1}. ${checked}${row.label}${description}${draft}`);
		});
		lines.push(hintBar(this.question.type));
		return lines;
	}
}

/** Compact agent-facing envelope; details carry the full records. */
export function renderAgentAnswer(result: { answers: AnswerRecord[]; cancelled: boolean }): string {
	if (result.cancelled) {
		return "User declined to answer questions";
	}
	return result.answers.map((answer, index) => `${index + 1} -> ${formatAnswer(answer)}`).join("\n");
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
