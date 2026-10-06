import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * ask_user tool with a herdr-web-ui-native dialog.
 *
 * The dialog renders every option as a numbered row and keeps a chooser
 * hint as the screen's last line — the exact shape herdr-web-ui's
 * fallback-menu parser (server/prompt.ts) turns into a chat card with one
 * button per row, each button typing that row's digit (no Enter suffix).
 * That makes every question answerable from the web/phone card: digits
 * pick or toggle, Enter submits, Esc goes back — the three keys the card
 * offers as buttons. Why not pi-ask-herdr / rpiv: both draw arrow-key
 * wizards whose hint bars match no herdr-web-ui reader, so the pane falls
 * to the generic ↑/↓/Enter/Esc card (nav lands on wrong rows; space
 * toggle is omp-only in herdr-web-ui's answerKeys).
 *
 * Herdr state: while a question waits the extension emits `herdr:blocked`
 * {active:true,label}, and {active:false} when it resolves — the herdr
 * pi-integration (herdr-agent-state.ts) maps that to the pane's
 * blocked/working state, which is also what arms the fallback card.
 *
 * All user-visible output goes through ctx.ui — never console.*.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	ANSWER_LIMITS,
	CUSTOM_ROW_LABEL,
	ScreenLayout,
	hintBar,
	normalizeQuestion,
	renderAgentAnswer,
	type AnswerRecord,
	type AskType,
	type OptionItem,
	type QuestionSpec,
	type ScreenState,
} from "./screen.ts";

interface OptionSchemaItem {
	label: string;
	description?: string;
}

interface RawQuestion {
	question: string;
	type?: AskType;
	options?: Array<string | OptionSchemaItem>;
	allow_custom?: boolean;
	default?: string;
}

interface RawParams {
	questions: RawQuestion[];
	timeout?: number;
}

export function registerAskUserTool(pi: ExtensionAPI) {
	const OptionSchema = Type.Object({
		label: Type.String({ description: "Display label and returned value" }),
		description: Type.Optional(Type.String({ description: "Optional longer description shown in the menu" })),
	});

	const QuestionSchema = Type.Object({
		question: Type.String({
			description: "The exact question shown to the user; include the context needed to answer",
		}),
		type: Type.Optional(
			StringEnum(["text", "confirm", "select", "multiselect"] as const, {
				description: "Input type: text (default), confirm, select, or multiselect",
			}),
		),
		options: Type.Optional(
			Type.Array(Type.Union([Type.String(), OptionSchema]), {
				description: "Required when type is select or multiselect; items can be strings or {label, description?}",
			}),
		),
		default: Type.Optional(Type.String({ description: "Default value for text input" })),
		allow_custom: Type.Optional(
			Type.Boolean({
				description:
					"For confirm: also offer an 'Other (custom)' explain option. For select/multiselect it is always enabled.",
			}),
		),
	});

	const AskParamsSchema = Type.Object({
		questions: Type.Array(QuestionSchema, {
			minItems: 1,
			description:
				"Questions to ask, in order. The user answers them one by one and can step back with Esc. Use a single-element array for one question.",
		}),
		timeout: Type.Optional(
			Type.Number({ description: "Optional total timeout in milliseconds for the whole batch. Omit for no timeout (default)." }),
		),
	});

	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description:
			"Ask the user one or more interactive questions and wait for the answers. When you need a user response before continuing, you MUST call ask_user instead of asking in assistant text.",
		promptSnippet: "Request required user input in an interactive prompt; use ask_user instead of asking in chat.",
		promptGuidelines: [
			"Whenever you need the user to answer a question before you can continue, you MUST call ask_user; do not ask the question in assistant prose.",
			"Do not end a response with a question for the user when ask_user is available. Call ask_user and wait for its result.",
			"Use ask_user only for missing information, choices, or confirmation that cannot be inferred safely from the available context. Omit timeout unless the user explicitly requests a deadline; no timeout is the default.",
			"Pass a single question as a one-element questions array; batch multiple related questions into one call so the user can answer them in sequence.",
			"For questions with type 'select' or 'multiselect', always provide the options array.",
			"Keep each question concise, but include enough decision context for the user to answer.",
			"Users can always choose 'Other (custom)' for select/multiselect to type their own answer.",
			"Use { label, description } objects for ask_user options when the user needs extra context to decide.",
		],
		parameters: AskParamsSchema,
		executionMode: "sequential",

		async execute(_toolCallId, params: RawParams, signal, _onUpdate, ctx: ExtensionContext) {
			const cancelledBatch = () => ({ answers: [] as AnswerRecord[], cancelled: true });

			if (ctx.mode !== "tui") {
				return {
					content: [{ type: "text", text: "ask_user can only be used in interactive TUI mode." }],
					details: cancelledBatch(),
				};
			}

			// Validate up front so the wizard never starts half-broken.
			const problems: string[] = [];
			params.questions.forEach((raw, index) => {
				if (!raw.question || !raw.question.trim()) {
					problems.push(`questions[${index}]: question text is empty`);
				}
				const type: AskType = raw.type ?? "text";
				const optionCount = (raw.options ?? []).length;
				if ((type === "select" || type === "multiselect") && (optionCount < 2 || optionCount > ANSWER_LIMITS.maxOptions)) {
					problems.push(
						`questions[${index}]: type '${type}' requires 2-${ANSWER_LIMITS.maxOptions} options (got ${optionCount}); the dialog is a numbered menu — one row per option`,
					);
				}
				if (type === "confirm" && raw.allow_custom && optionCount > 0) {
					problems.push(`questions[${index}]: confirm takes no options array`);
				}
			});
			if (params.questions.length > ANSWER_LIMITS.maxQuestions) {
				problems.push(`at most ${ANSWER_LIMITS.maxQuestions} questions per call`);
			}
			if (problems.length > 0) {
				return {
					content: [{ type: "text", text: `ask_user error:\n${problems.join("\n")}` }],
					details: cancelledBatch(),
				};
			}

			const specs = params.questions.map(normalizeQuestion);
			const label = specs[0]!.question;

			pi.events.emit("herdr:blocked", { active: true, label });
			let details: { answers: AnswerRecord[]; cancelled: boolean };
			try {
				details = await runWizard(specs, ctx, signal ?? undefined, params.timeout);
			} finally {
				pi.events.emit("herdr:blocked", { active: false });
			}

			return {
				content: [{ type: "text", text: renderAgentAnswer(details) }],
				details,
			};
		},

		renderCall(args: RawParams, theme) {
			const questions = Array.isArray(args.questions) ? args.questions : [];
			const count = questions.length;
			let text = theme.fg("toolTitle", theme.bold(count > 1 ? `Ask User (${count} questions)` : "Ask User"));
			if (count === 1) {
				const question = typeof questions[0]?.question === "string" ? questions[0].question.trim() : "";
				if (question) text += ` ${theme.fg("muted", question)}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as { answers: AnswerRecord[]; cancelled: boolean } | undefined;
			const textContent = result.content.find((item) => item.type === "text");
			const rawText = textContent?.type === "text" ? textContent.text : "";
			if (!details) return new Text(rawText, 0, 0);
			if (details.cancelled) return new Text(theme.fg("warning", "User declined to answer questions"), 0, 0);
			return new Text(renderAgentAnswer(details), 0, 0);
		},
	});
}

// --- wizard -------------------------------------------------------------------

type Done<T> = (result: T) => void;

/** Digit typing (the herdr-web-ui card buttons) plus the interactive keys. */
const DIGIT_RE = /^[1-9]$/;

function runWizard(
	specs: QuestionSpec[],
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	timeoutMs: number | undefined,
): Promise<{ answers: AnswerRecord[]; cancelled: boolean }> {
	return ctx.ui.custom<{ answers: AnswerRecord[]; cancelled: boolean }>((tui, theme, keybindings, done) => {
		return new AskWizard(specs, theme, done, signal, timeoutMs);
	});
}

class AskWizard {
	private readonly specs: QuestionSpec[];
	private readonly theme: { fg: (color: string, text: string) => string };
	private readonly done: Done<{ answers: AnswerRecord[]; cancelled: boolean }>;
	private readonly answers: AnswerRecord[] = [];
	private questionIndex = 0;
	private cursor = 0;
	private readonly checked = new Set<number>();
	private customActive = false;
	private draft = "";
	private readonly items: OptionItem[];
	private readonly state: ScreenState;
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		specs: QuestionSpec[],
		theme: { fg: (color: string, text: string) => string },
		done: Done<{ answers: AnswerRecord[]; cancelled: boolean }>,
		signal: AbortSignal | undefined,
		timeoutMs: number | undefined,
	) {
		this.specs = specs;
		this.theme = theme;
		this.done = done;
		const spec = specs[0]!;
		this.items = spec.options;
		this.state = {
			cursor: 0,
			checked: this.checked,
			customActive: false,
			draft: "",
			multi: spec.type === "multiselect",
		};
		if (signal) {
			signal.addEventListener(
				"abort",
				() => {
					this.finish({ answers: [], cancelled: true });
				},
				{ once: true },
			);
		}
		if (timeoutMs && timeoutMs > 0) {
			this.timer = setTimeout(() => {
				this.finish({ answers: [], cancelled: true });
			}, timeoutMs);
		}
	}

	private get spec(): QuestionSpec {
		return this.specs[this.questionIndex]!;
	}

	private get rowCount(): number {
		return this.items.length + (this.spec.allowCustom ? 1 : 0);
	}

	private finish(result: { answers: AnswerRecord[]; cancelled: boolean }) {
		if (this.timer) clearTimeout(this.timer);
		this.done(result);
	}

	private record(kind: AnswerRecord["kind"], answer: AnswerRecord["answer"], selected?: string[]): AnswerRecord {
		return {
			questionIndex: this.questionIndex,
			question: this.spec.question,
			kind,
			answer,
			...(selected ? { selected } : {}),
		};
	}

	/** Advance to the next question (or finish), resetting per-question state. */
	private advance(answer: AnswerRecord) {
		this.answers.push(answer);
		if (this.questionIndex + 1 >= this.specs.length) {
			this.finish({ answers: this.answers, cancelled: false });
			return;
		}
		this.questionIndex += 1;
		this.cursor = 0;
		this.checked.clear();
		this.customActive = false;
		this.draft = "";
		this.state.cursor = 0;
		this.state.customActive = false;
		this.state.draft = "";
		this.state.multi = this.spec.type === "multiselect";
	}

	/** Step back to the previous question, dropping its recorded answer. */
	private stepBack() {
		if (this.questionIndex === 0) {
			this.finish({ answers: [], cancelled: true });
			return;
		}
		this.questionIndex -= 1;
		this.answers.pop();
		this.cursor = 0;
		this.checked.clear();
		this.customActive = false;
		this.draft = "";
		this.state.cursor = 0;
		this.state.customActive = false;
		this.state.draft = "";
		this.state.multi = this.spec.type === "multiselect";
	}

	private pickCustom() {
		this.customActive = true;
		this.state.customActive = true;
		if (this.spec.type === "text") {
			this.draft = this.spec.default ?? "";
			this.state.draft = this.draft;
		}
	}

	/** Commit the custom row: text/confirm/select need text; multiselect takes what is checked. */
	private commitCustom() {
		const type = this.spec.type;
		if (type === "multiselect") {
			this.commitMulti();
			return;
		}
		const text = this.draft.trim();
		if (!text) return; // nothing typed: stay
		this.advance(this.record("custom", text));
	}

	private commitMulti() {
		const selected = [...this.checked].sort((a, b) => a - b).map((index) => this.items[index]!.label);
		this.advance(this.record("multi", selected, selected));
	}

	handleInput(data: string): void {
		// custom input editor mode: capture printable input until enter/escape
		if (this.customActive) {
			if (data === "\r" || data === "\n") {
				this.commitCustom();
				return;
			}
			if (data === "\x1b") {
				this.customActive = false;
				this.state.customActive = false;
				return;
			}
			if (data === "\x7f" || data === "\b") {
				this.draft = this.draft.slice(0, -1);
			} else if (data === "\x03") {
				this.finish({ answers: [], cancelled: true });
				return;
			} else if (data >= " " || data === "\t") {
				this.draft += data;
			}
			this.state.draft = this.draft;
			return;
		}

		if (data === "\x03") {
			// ctrl+c cancels the whole batch
			this.finish({ answers: [], cancelled: true });
			return;
		}

		// digits act first — they are what the herdr-web-ui card buttons send
		const digit = DIGIT_RE.exec(data);
		if (digit) {
			const row = Number.parseInt(digit[0], 10) - 1;
			if (row >= this.rowCount) return;
			this.cursor = row;
			this.state.cursor = row;
			if (row === this.items.length) {
				this.pickCustom();
				return;
			}
			if (this.spec.type === "multiselect") {
				if (this.checked.has(row)) this.checked.delete(row);
				else this.checked.add(row);
				return;
			}
			if (this.spec.type === "text") {
				this.pickCustom();
				return;
			}
			// confirm/select: a digit picks immediately and advances (omo-style)
			this.advance(this.record("option", this.items[row]!.label));
			return;
		}

		if (matchesKey(data, "up")) {
			if (this.rowCount > 0) {
				this.cursor = (this.cursor - 1 + this.rowCount) % this.rowCount;
				this.state.cursor = this.cursor;
			}
			return;
		}
		if (matchesKey(data, "down")) {
			if (this.rowCount > 0) {
				this.cursor = (this.cursor + 1) % this.rowCount;
				this.state.cursor = this.cursor;
			}
			return;
		}
		if (data === " ") {
			// space toggles on multiselect
			if (this.spec.type === "multiselect" && this.cursor < this.items.length) {
				if (this.checked.has(this.cursor)) this.checked.delete(this.cursor);
				else this.checked.add(this.cursor);
			}
			return;
		}
		if (data === "\r" || data === "\n" || matchesKey(data, "return")) {
			if (this.cursor === this.items.length) {
				this.pickCustom();
				return;
			}
			if (this.spec.type === "multiselect") {
				this.commitMulti();
				return;
			}
			if (this.spec.type === "text") {
				this.pickCustom();
				return;
			}
			this.advance(this.record("option", this.items[this.cursor]!.label));
			return;
		}
		if (data === "\x1b" || matchesKey(data, "escape")) {
			// esc steps back / cancels on the first question
			this.stepBack();
			return;
		}
	}
	render(width: number): string[] {
		const layout = new ScreenLayout(this.spec, this.items, this.state);
		const body = layout.lines();
		return [...body.slice(0, -1), this.theme.fg("dim", body[body.length - 1]!)].map((line) =>
			line.length > width ? `${line.slice(0, Math.max(1, width - 1))}…` : line,
		);
	}

	invalidate(): void {
		// rendered from scratch each frame
	}
}

export { CUSTOM_ROW_LABEL, hintBar };
