import assert from "node:assert/strict";
import {
  ANSWER_LIMITS,
  ScreenLayout,
  hintBar,
  normalizeQuestion,
  renderAgentAnswer,
  type AskType,
  type QuestionSpec,
} from "./screen.ts";

// --- fallback-menu contract regexes (port of herdr-web-ui 0.3.49
// server/prompt.ts — the card appears only when these match) -----------------

/** herdr-web-ui NUMBERED_OPTION_RE: /^\s*([›>❯])?\s*(\d+)\.\s+(.+)$/ */
const NUMBERED_OPTION_RE = /^\s*([›>❯])?\s*(\d+)\.\s+(.+)$/;
/** herdr-web-ui MENU_HINT_RE — the hint line must say to choose */
const MENU_HINT_RE =
  /\b(?:select|choose|pick|confirm|navigate|move|esc|cancel)\b|[↑↓↵⏎]|\b(?:enter|type)\s+(?:(?:a|an|the)\s+)?number\b|\b\d\s*[-–]\s*\d\b/i;
/** herdr-web-ui INPUT_FIELD_RE: a line waiting at its end voids the menu */
const INPUT_FIELD_RE = /:\s*\S{0,3}$/;
/** herdr-web-ui NOT_PROMPT_TEXT_RE: a hint starting like a quote/prompt is no hint */
const NOT_PROMPT_TEXT_RE = /^(?:[❯›>"'“]|\$ )/;
/** herdr-web-ui SELECTED_RE: the hint may not start with a selection marker */
const SELECTED_RE = /^[❯›>]\s*/;
/** herdr-web-ui HINT_LINE_RE: a hint-like line inside the last row's wrap voids it */
const HINT_LINE_RE = /^(?:[↵⏎]|(?:Press|Enter|Select|Choose|Pick|Type|Esc|ESC)\b)/;
/** herdr-web-ui: a row with a trailing "(x)" letter key voids the menu */
const LETTER_KEY_SUFFIX_RE = /\(\w\)$/;
/** herdr-web-ui DIVIDER_RE: pure divider lines are dropped from the shown screen */
const DIVIDER_RE = /^[\s╭╮╰╯├┤┬┴┼─━═╌▔]+$/;

/** Port of herdr-web-ui fallbackMenu over our rendered screen (ANSI already stripped). */
function parseFallbackLike(screen: string[]): { rows: number[]; hintAt: number } | null {
  const lines = screen.map((line) => line.replace(/\s+$/, ""));
  const shown = lines.flatMap((line, index) => (line && !DIVIDER_RE.test(line) ? [index] : []));
  const lastRow = [...shown].reverse().find((index) => NUMBERED_OPTION_RE.test(lines[index]!.trim()));
  const hintIndex = shown.at(-1);
  if (lastRow === undefined || hintIndex === undefined || hintIndex === lastRow) return null;
  const hint = lines[hintIndex]!;
  if (!MENU_HINT_RE.test(hint) || SELECTED_RE.test(hint) || NOT_PROMPT_TEXT_RE.test(hint) || INPUT_FIELD_RE.test(hint)) {
    return null;
  }
  let end = lastRow + 1;
  const numberAt = lines[lastRow]!.search(/\d/);
  while (end < hintIndex && lines[end] && !DIVIDER_RE.test(lines[end]!) && lines[end]!.search(/\S/) > numberAt) end += 1;
  if (shown.some((index) => index >= end && index < hintIndex) || end - lastRow - 1 > 2) return null;
  let start = lastRow;
  while (start > 0 && lines[start - 1] && !DIVIDER_RE.test(lines[start - 1]!)) start -= 1;
  while (start < lastRow && !NUMBERED_OPTION_RE.test(lines[start]!.trim())) start += 1;
  const rows: number[] = [];
  for (let index = start; index < end; index += 1) {
    const match = lines[index]!.trim().match(NUMBERED_OPTION_RE);
    if (match) rows.push(Number.parseInt(match[2]!, 10));
  }
  if (!rows.length || !rows.every((row, index) => row === index + 1) || rows.length < 2 || rows.length > 9) return null;
  // a row ending in its own letter key means the number may not be the key
  for (const index of rows.map((_, at) => start + at)) {
    if (/\(\w\)$/.test(lines[index]!)) return null;
  }
  return { rows, hintAt: hintIndex };
}

/** Render the screen for a spec + state, styled lines stripped like herdr-web-ui does. */
function screenFor(
  question: QuestionSpec,
  state: { index: number; checked: Set<number>; customActive?: boolean; draft?: string },
  header: { step?: number; total?: number } = {},
): string[] {
  const layout = new ScreenLayout(question, {
    cursor: state.index,
    checked: state.checked,
    customActive: state.customActive ?? false,
    draft: state.draft ?? "",
    multi: question.multi,
  }, header);
  // pi pane width budget: our two-column padding is part of the line here
  return layout.lines().map((line) => ` ${line}`);
}

/** The full card contract, checked the way herdr-web-ui checks it. */
function assertFallbackCard(screen: string[], expectedRows: number) {
  const parsed = parseFallbackLike(screen);
  assert.ok(parsed, `no fallback card for screen:\n${screen.join("\n")}`);
  assert.equal(parsed.rows.length, expectedRows, `row count: ${parsed.rows.join(",")}`);
  const hint = screen[parsed.hintAt]!;
  assert.doesNotMatch(hint, /[\u2191\u2193]/, "no arrow glyphs on the hint: card buttons are digits/enter/esc only");
}

assert.equal(ANSWER_LIMITS.maxQuestions, 4);
assert.equal(ANSWER_LIMITS.maxOptions, 9);

// select: options + derived custom row, cursor on the first row
{
  const spec = normalizeQuestion({
    question: "Deploy now?",
    type: "select",
    options: [
      { label: "Deploy to production", description: "kubectl rollout restart" },
      { label: "Deploy to staging" },
      { label: "Cancel" },
    ],
  });
  const screen = screenFor(spec, { index: 0, checked: new Set() });
  assertFallbackCard(screen, 4);
  assert.match(screen[0]!, /Deploy now\?$/);
  assert.equal(screen[1]!.trim(), "");
  assert.match(screen[2]!, /^ ❯ 1\. Deploy to production — kubectl rollout restart$/);
  assert.match(screen[3]!, /^ {3}2\. Deploy to staging$/);
  const hint = screen.at(-1)!;
  assert.match(hint, /digit pick/);
  assert.match(hint, /enter submit/);
}

// multiselect: checked marker renders inside the numbered row
{
  const spec = normalizeQuestion({
    question: "Pick tests?",
    type: "multiselect",
    options: [{ label: "unit" }, { label: "integration" }, { label: "e2e" }],
  });
  const screen = screenFor(spec, { index: 0, checked: new Set([0, 2]) });
  assertFallbackCard(screen, 4);
  assert.match(screen[2]!, /1\. \[x\] unit/);
  assert.match(screen[3]!, /2\. integration/);
  assert.match(screen[4]!, /3\. \[x\] e2e/);
  assert.match(screen.at(-1)!, /digit toggle/);
}

// text: two rows minimum (parser needs >= 2 numbered rows) — Type + Skip
{
  const spec = normalizeQuestion({ question: "Name?", type: "text", default: "world" });
  assert.equal(spec.rows.length, 2);
  assert.equal(spec.customRowIndex, 0);
  assert.equal(spec.skipRowIndex, 1);
  const screen = screenFor(spec, { index: 0, checked: new Set() });
  assertFallbackCard(screen, 2);
  assert.match(screen[2]!, /Type your own answer/);
  assert.match(screen[3]!, /Skip this question/);
  assert.match(screen.at(-1)!, /digit choose/);
}

// custom mode: draft rides the custom row; the hint stays the last line (not the draft)
{
  const spec = normalizeQuestion({ question: "Name?", type: "text" });
  const screen = screenFor(spec, { index: 0, checked: new Set(), customActive: true, draft: "hel" });
  assertFallbackCard(screen, 2);
  assert.match(screen[2]!, /Type your own answer: hel$/);
  assert.doesNotMatch(screen.at(-1)!, INPUT_FIELD_RE, "hint never reads as an input field");
}

// confirm: exactly Yes/No (+ custom row when allowed)
{
  const spec = normalizeQuestion({ question: "Proceed?", type: "confirm" });
  const screen = screenFor(spec, { index: 0, checked: new Set() });
  assertFallbackCard(screen, 2);
  assert.match(screen[2]!, /1\. Yes/);
  assert.match(screen[3]!, /2\. No/);
}

// batch header on question 2 of 3
{
  const spec = normalizeQuestion({ question: "Second?", type: "confirm", allow_custom: false });
  const screen = screenFor(spec, { index: 0, checked: new Set() }, { step: 2, total: 3 });
  assertFallbackCard(screen, 2);
  assert.match(screen[1]!, /Question 2 of 3/);
}

// hint bars per mode
assert.match(hintBar("select"), /digit pick/);
assert.match(hintBar("multiselect"), /digit toggle/);
assert.match(hintBar("text"), /digit choose/);
assert.match(hintBar("confirm"), /digit pick/);

// agent-facing envelope
assert.equal(renderAgentAnswer({ answers: [], cancelled: true }), "User declined to answer questions");
const envelope = renderAgentAnswer({
  cancelled: false,
  answers: [
    { questionIndex: 0, question: "Deploy now?", kind: "option", answer: "Deploy to production" },
    { questionIndex: 1, question: "Pick tests?", kind: "multi", answer: null, selected: ["unit", "e2e"] },
    { questionIndex: 2, question: "Name?", kind: "skip", answer: null },
    { questionIndex: 3, question: "Why?", kind: "custom", answer: "because" },
  ],
});
assert.match(envelope, /1 -> Deploy to production/);
assert.match(envelope, /2 -> unit, e2e/);
assert.match(envelope, /3 -> \(no answer\)/);
assert.match(envelope, /4 -> because/);

// wrapped long labels: numbers survive pi's width wrapping (60 col here)
{
  const spec = normalizeQuestion({
    question: "Which migration strategy should the team pick for this quarter's cutover?",
    type: "select",
    options: [
      { label: "Big-bang migration over a single maintenance weekend window" },
      { label: "Incremental dual-write with a read-through cache backfill phase" },
      { label: "Strangler pattern behind a facade route table" },
    ],
  });
  const wrapped: string[] = [];
  for (const line of screenFor(spec, { index: 0, checked: new Set() })) {
    if (line.length <= 60) {
      wrapped.push(line);
    } else {
      for (let at = 0; at < line.length; at += 60) wrapped.push(line.slice(at, at + 60));
    }
  }
  assertFallbackCard(wrapped, 4);
}

console.log("ask-user self-check: all assertions passed");
