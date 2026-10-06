import assert from "node:assert/strict";
import {
  ANSWER_LIMITS,
  ScreenLayout,
  hintBar,
  normalizeQuestion,
  renderAgentAnswer,
  type OptionItem,
  type QuestionSpec,
} from "./screen.ts";

// --- fallback-menu contract regexes (port of herdr-web-ui 0.3.49
// server/prompt.ts — the card appears only when these match) -----------------

/** herdr-web-ui: /^[\s>❯›]*=\s*(\d+)\.\s+(.+)$/ — wait, exact: /^\s*([›>❯])?\s*(\d+)\.\s+(.+)$/ */
const NUMBERED_OPTION_RE = /^\s*([›>❯])?\s*(\d+)\.\s+(.+)$/;
/** herdr-web-ui MENU_HINT_RE — the hint line must say "choose" */
const MENU_HINT_RE =
  /\b(?:select|choose|pick|confirm|navigate|move|esc|cancel)\b|[↑↓↵⏎]|\b(?:enter|type)\s+(?:(?:a|an|the)\s+)?number\b|\b\d\s*[-–]\s*\d\b/i;
/** herdr-web-ui: an input field waiting at a line's end voids the menu */
const INPUT_FIELD_RE = /:\s*\S{0,3}$/;
/** herdr-web-ui HINT_LINE_RE: a hint-like line inside the last row's wrap voids it */
const HINT_LINE_RE = /^(?:[↵⏎]|(?:Press|Enter|Select|Choose|Pick|Type|Esc|ESC)\b)/;
/** herdr-web-ui: a row with a trailing "(x)" letter key voids the menu (number may not be the key) */
const LETTER_KEY_SUFFIX_RE = /\(\w\)$/;

/** Strip ANSI escapes the way herdr-web-ui does before matching. */
function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal protocol
  // biome-ignore format: readability
  const ANSI_RE = /(?:\x1B\[[?<]?[\d;]*[A-Za-z]|\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)|\x1B.)/g;
  return text.replace(ANSI_RE, "").replace(/\s+$/, "");
}

/** Render the numbered option line for a row (cursor column width 2, like the real UI). */
function optionLine(index: number, item: OptionItem, cursor: boolean): string {
  const marker = cursor ? "❯" : " ";
  const checked = item.checked ? "[x] " : "";
  const description = item.description ? ` — ${item.description}` : "";
  return `${marker} ${index + 1}. ${checked}${item.label}${description}`;
}

// --- screen fixtures through the real renderer -------------------------------

function screenFor(
  question: QuestionSpec,
  state: { index: number; checked: Set<number>; customActive?: boolean },
): string[] {
  const normalized = normalizeQuestion(question);
  const layout = new ScreenLayout(normalized, normalized.options, {
    cursor: state.index,
    checked: state.checked,
    customActive: state.customActive ?? false,
    multi: question.type === "multiselect",
  });
  return layout.lines().map(stripAnsi);
}

// --- layout contract tests ----------------------------------------------------

function assertFallbackMenuContract(screen: string[], opts: { hintAt: number; rows: number }) {
  const hint = screen[opts.hintAt]!;
  assert.match(hint, MENU_HINT_RE, `hint line must match MENU_HINT_RE: ${hint}`);
  assert.doesNotMatch(hint, INPUT_FIELD_RE, "hint line must not read as an input field");
  assert.doesNotMatch(hint, /[\u2191\u2193]/, "no arrow keys on the hint: card buttons are digits/enter/esc only");
  // the last numbered row owns the space up to the hint (only blank/wrap lines allowed between)
  const numbered = screen
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => NUMBERED_OPTION_RE.test(line));
  assert.ok(numbered.length === opts.rows, `expected ${opts.rows} numbered rows, saw ${numbered.length}`);
  const lastRow = numbered[numbered.length - 1]!.index;
  for (const line of screen.slice(lastRow + 1, opts.hintAt)) {
    assert.doesNotMatch(line, NUMBERED_OPTION_RE, `no numbered row between last row and hint: ${line}`);
    assert.doesNotMatch(line, HINT_LINE_RE, `no hint-like line between rows and hint: ${line}`);
    assert.doesNotMatch(line, LETTER_KEY_SUFFIX_RE, `no "(x)" letter-key suffix on rows: ${line}`);
  }
  // numbers are 1..n in order
  numbered.forEach(({ line }, index) => assert.equal(Number.parseInt(line.match(NUMBERED_OPTION_RE)![2]!, 10), index + 1, `sequential numbering: ${line}`));
}

assert.equal(ANSWER_LIMITS.maxQuestions, 4);
assert.equal(ANSWER_LIMITS.maxOptions, 9);

// select: one question, cursor on the first row
{
  const question: QuestionSpec = {
    question: "Deploy now?",
    type: "select",
    options: [
      { label: "Deploy to production", description: "kubectl rollout restart" },
      { label: "Deploy to staging" },
      { label: "Cancel" },
    ],
  };
  const screen = screenFor(question, { index: 0, checked: new Set() });
  const hintAt = screen.findIndex((line) => line.includes("digit = pick"));
  assert.ok(hintAt > 0, `hint bar present: ${screen.join("\n")}`);
  assertFallbackMenuContract(screen, { hintAt, rows: 4 });
  assert.match(screen[0]!, /Deploy now\?$/);
  // cursor marker on row 1 only
  assert.match(screen[1]!, /^❯/);
  assert.match(screen[2]!, /^ {2}\d/);
}

// multiselect: checked marker renders inside the numbered row, still one row per option
{
  const question: QuestionSpec = {
    question: "Pick tests?",
    type: "multiselect",
    options: [{ label: "unit" }, { label: "integration" }, { label: "e2e" }],
  };
  const screen = screenFor(question, { index: 0, checked: new Set([0, 2]) });
  const hintAt = screen.findIndex((line) => line.includes("digit = toggle"));
  assert.ok(hintAt > 0, "hint bar present");
  assertFallbackMenuContract(screen, { hintAt, rows: 4 });
  assert.match(screen[1]!, /1\. \[x\] unit/);
  assert.match(screen[2]!, /2\. integration/);
}

// custom input row: a numbered "Type your own answer" row, never a bare input field
{
  const question: QuestionSpec = {
    question: "Name?",
    type: "text",
    options: [],
  };
  const screen = screenFor(question, { index: 0, checked: new Set() });
  const hintAt = screen.findIndex((line) => line.includes("enter = save"));
  assert.ok(hintAt > 0, "hint bar present");
  assertFallbackMenuContract(screen, { hintAt, rows: 1 });
  assert.match(screen[1]!, /Type your own answer/);
}

// custom mode (typing inside the input row): the editor line is NOT the screen's last —
// the hint bar stays last, so the fallback card never flips to the input-voiding shape
{
  const question: QuestionSpec = {
    question: "Name?",
    type: "text",
    options: [],
  };
  const screen = screenFor(question, { index: 0, checked: new Set(), customActive: true });
  const hintAt = screen.findIndex((line) => line.includes("enter = save"));
  assert.ok(hintAt > 0, "hint bar present");
  assert.match(screen[hintAt]!, /digit 1/);
  assert.doesNotMatch(screen[hintAt]!, INPUT_FIELD_RE, "hint stays the chooser line");
  // the draft line must not read as "Password:" style input field either
  assert.doesNotMatch(screen[hintAt - 1]!, INPUT_FIELD_RE);
}

// descriptions render INLINE on the numbered row (em-dash style) — the safest contract
// shape: no lines at all between rows, so fold-in ambiguity never arises
{
  const question: QuestionSpec = {
    question: "Wide?",
    type: "select",
    options: [
      { label: "first", description: "first description" },
      { label: "second", description: "second description" },
    ],
  };
  const screen = screenFor(question, { index: 0, checked: new Set() });
  const hintAt = screen.findIndex((line) => line.includes("digit = pick"));
  assert.ok(hintAt > 0, "hint bar present");
  assertFallbackMenuContract(screen, { hintAt, rows: 3 });
  assert.match(screen[1]!, /1\. first — first description$/);
  assert.match(screen[2]!, /2\. second — second description$/);
}

// hint bars per mode
assert.match(hintBar("select"), /digit = pick/);
assert.match(hintBar("multiselect"), /digit = toggle/);
assert.match(hintBar("text"), /digit 1 = type/);
assert.match(hintBar("confirm"), /digit = pick/);

// agent-facing envelope
assert.equal(renderAgentAnswer({ answers: [], cancelled: true }), "User declined to answer questions");
const envelope = renderAgentAnswer({
  cancelled: false,
  answers: [
    { questionIndex: 0, question: "Deploy now?", kind: "option", answer: "Deploy to production" },
    { questionIndex: 1, question: "Pick tests?", kind: "multi", answer: null, selected: ["unit", "e2e"] },
  ],
});
assert.match(envelope, /1 -> Deploy to production/);
assert.match(envelope, /2 -> unit, e2e/);

// wrapped long labels: contract must survive pi's own width wrapping (60 col here)
{
  const question: QuestionSpec = {
    question: "Which migration strategy should the team pick for this quarter's cutover?",
    type: "select",
    options: [
      { label: "Big-bang migration over a single maintenance weekend window" },
      { label: "Incremental dual-write with a read-through cache backfill phase" },
      { label: "Strangler pattern behind a facade route table" },
    ],
  };
  const wrapped: string[] = [];
  for (const line of screenFor(question, { index: 0, checked: new Set() })) {
    if (line.length <= 60) {
      wrapped.push(line);
    } else {
      // naive wrap like pi-tui does at width boundaries
      for (let at = 0; at < line.length; at += 60) wrapped.push(line.slice(at, at + 60));
    }
  }
  const hintAt = wrapped.findIndex((line) => line.includes("digit = pick"));
  assert.ok(hintAt > 0, "hint bar present after wrap");
  const numbers = wrapped
    .map((line) => line.match(NUMBERED_OPTION_RE))
    .filter(Boolean)
    .map((match) => Number.parseInt(match![2]!, 10));
  assert.deepEqual(numbers, [1, 2, 3, 4], `numbers survive wrap: ${wrapped.join(" | ")}`);
  // the last numbered line is the row that owns the wrap up to the hint
  const lastNumbered = wrapped.findIndex((line) => NUMBERED_OPTION_RE.test(line) && Number.parseInt(line.trim().match(NUMBERED_OPTION_RE)![2]!, 10) === 4);
  for (const line of wrapped.slice(lastNumbered + 1, hintAt)) {
    assert.doesNotMatch(line, HINT_LINE_RE, `no hint-like wrap line before the hint bar: ${line}`);
  }
}

console.log("ask-user self-check: all assertions passed");
