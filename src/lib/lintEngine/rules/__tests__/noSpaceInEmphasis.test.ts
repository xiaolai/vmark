// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../../linter";

describe("E05 noSpaceInEmphasis", () => {
  it("flags ** bold ** with spaces", () => {
    const result = lintMarkdown("** bold **");
    expect(result.some((d) => d.ruleId === "E05")).toBe(true);
  });

  it("does NOT flag **bold** without spaces", () => {
    const result = lintMarkdown("**bold**");
    expect(result.some((d) => d.ruleId === "E05")).toBe(false);
  });

  it("flags * italic * with spaces", () => {
    const result = lintMarkdown("* italic *");
    expect(result.some((d) => d.ruleId === "E05")).toBe(true);
  });

  it("does NOT flag *italic* without spaces", () => {
    const result = lintMarkdown("*italic*");
    expect(result.some((d) => d.ruleId === "E05")).toBe(false);
  });

  it("flags __ bold __ with spaces", () => {
    const result = lintMarkdown("__ bold __");
    expect(result.some((d) => d.ruleId === "E05")).toBe(true);
  });

  it("does NOT flag __bold__ without spaces", () => {
    const result = lintMarkdown("__bold__");
    expect(result.some((d) => d.ruleId === "E05")).toBe(false);
  });

  it("does NOT flag emphasis inside a fenced code block", () => {
    const source = "```\n** bold **\n```";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E05")).toBe(false);
  });

  it("does NOT flag emphasis inside inline code", () => {
    const result = lintMarkdown("Use `** bold **` to show example");
    expect(result.some((d) => d.ruleId === "E05")).toBe(false);
  });

  it("does NOT flag emphasis inside a double-backtick code span", () => {
    const result = lintMarkdown("Use ``** bold **`` to show example");
    expect(result.some((d) => d.ruleId === "E05")).toBe(false);
  });

  it("flags emphasis after a closed double-backtick span", () => {
    const result = lintMarkdown("``code`` then ** bold **");
    expect(result.some((d) => d.ruleId === "E05")).toBe(true);
  });

  it("flags emphasis after a double-backtick span containing a backtick", () => {
    const result = lintMarkdown("`` ` `` then ** bold **");
    expect(result.some((d) => d.ruleId === "E05")).toBe(true);
  });

  it("flags emphasis after an escaped backtick (literal, not code)", () => {
    const result = lintMarkdown("\\` and ** bold **");
    expect(result.some((d) => d.ruleId === "E05")).toBe(true);
  });

  it("flags emphasis after an unmatched backtick", () => {
    const result = lintMarkdown("a ` b and ** bold **");
    expect(result.some((d) => d.ruleId === "E05")).toBe(true);
  });

  it("sets uiHint to sourceOnly", () => {
    const result = lintMarkdown("** bold **");
    const d = result.find((d) => d.ruleId === "E05");
    expect(d?.uiHint).toBe("sourceOnly");
  });

  it("reports correct line (1-based)", () => {
    const source = "Normal text\n** bold **";
    const result = lintMarkdown(source);
    const d = result.find((d) => d.ruleId === "E05");
    expect(d?.line).toBe(2);
  });

  it("does NOT flag * used as list bullet", () => {
    const result = lintMarkdown("* list item one\n* list item two");
    expect(result.some((d) => d.ruleId === "E05")).toBe(false);
  });

  it("flags _ italic _ with underscore and spaces", () => {
    const result = lintMarkdown("_ italic _");
    expect(result.some((d) => d.ruleId === "E05")).toBe(true);
  });

  it("does NOT flag arithmetic like 3 * 4 * 5", () => {
    const result = lintMarkdown("3 * 4 * 5");
    expect(result.some((d) => d.ruleId === "E05")).toBe(false);
  });

  it("does NOT flag arithmetic with variables like x = 2 * y * 3", () => {
    const result = lintMarkdown("x = 2 * y * 3");
    expect(result.some((d) => d.ruleId === "E05")).toBe(false);
  });

  it("does NOT flag identifier arithmetic like x * y * z", () => {
    const result = lintMarkdown("x * y * z");
    expect(result.some((d) => d.ruleId === "E05")).toBe(false);
  });

  it("flags a multi-char word between stars even when digits flank both sides", () => {
    // "chapter 2 * important * 3 examples" — the flanks look numeric, but
    // the middle operand is a real word, so this is emphasis, not math.
    const result = lintMarkdown("chapter 2 * important * 3 examples");
    expect(result.some((d) => d.ruleId === "E05")).toBe(true);
  });

  it("still flags spaced emphasis between words", () => {
    const result = lintMarkdown("some * emphasized * text");
    expect(result.some((d) => d.ruleId === "E05")).toBe(true);
  });

  it("still flags spaced emphasis of a number between words", () => {
    // Digits INSIDE the delimiters are fine — only numeric operands on
    // BOTH sides (infix-operator shape) suppress the warning.
    const result = lintMarkdown("the answer * 42 * indeed");
    expect(result.some((d) => d.ruleId === "E05")).toBe(true);
  });

  it("does NOT flag a single spaced star pair like a * b", () => {
    // A lone `*` between words never matches the two-delimiter pattern —
    // there is no closing delimiter, so it cannot be spaced emphasis.
    const result = lintMarkdown("a * b");
    expect(result.some((d) => d.ruleId === "E05")).toBe(false);
  });
});

// Audit 20260907 round 3 (#831/#833/#834/#836/#837). Each case was a false
// positive produced by this rule's private idea of where code is, or by a
// regex that ignored escapes. It now reads `sourceMask`, the same model E01
// and W03 use.
describe("E05 — text that only LOOKS like spaced emphasis", () => {
  const flagged = (input: string) => lintMarkdown(input).some((d) => d.ruleId === "E05");

  it.each([
    { name: "inside a code span that crosses a line ending (#831)", input: "`code\n** bold **\nmore`\n" },
    { name: "inside a double-backtick span (#831)", input: "a ``x\n** bold **\ny`` b\n" },
    { name: "inside a fence a blockquote prefixes (#836)", input: "> ```\n> ** bold **\n> ```\n" },
    { name: "inside a fence a list item prefixes (#836)", input: "- item\n\n  ```\n  ** bold **\n  ```\n" },
    { name: "a match whose closing marker is inside a code span (#837)", input: "a ** b `c ** d` e\n" },
    { name: "an ESCAPED opening delimiter (#833)", input: "a \\* text * b\n" },
    { name: "CJK identifiers around infix multiplication (#834)", input: "甲 * 乙 * 丙\n" },
    { name: "a negative operand (#834)", input: "x * -4 * y\n" },
  ])("$name is not flagged", ({ input }) => {
    expect(flagged(input)).toBe(false);
  });

  // The other direction, which is what makes the operand rule worth keeping:
  // a WORDY flank is emphasis, and widening the operand rule far enough to
  // accept it would silence the rule's own purpose.
  it.each([
    { name: "a wordy flank is still emphasis", input: "some * emphasized * text\n" },
    { name: "an unescaped delimiter beside an escaped one", input: "a \\* b ** c ** d\n" },
    { name: "emphasis after a fenced block closes", input: "```\ncode\n```\n\n** bold **\n" },
  ])("$name", ({ input }) => {
    expect(flagged(input)).toBe(true);
  });

  it("reports the offset of the real source, not of a recount", () => {
    const source = "line one\n\n** bold **\n";
    const d = lintMarkdown(source).find((x) => x.ruleId === "E05");
    expect(d).toBeDefined();
    expect(source.slice(d!.offset, d!.offset + 2)).toBe("**");
  });
});
