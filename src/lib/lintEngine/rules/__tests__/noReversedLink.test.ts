// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../../linter";

describe("E03 noReversedLink", () => {
  it("flags (text)[url] pattern", () => {
    const result = lintMarkdown("(text)[url]");
    expect(result.some((d) => d.ruleId === "E03")).toBe(true);
  });

  it("does NOT flag correct [text](url) syntax", () => {
    const result = lintMarkdown("[text](url)");
    expect(result.some((d) => d.ruleId === "E03")).toBe(false);
  });

  it("does NOT flag (text)[ref] inside a fenced code block", () => {
    const source = "```\n(text)[url]\n```";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E03")).toBe(false);
  });

  it("does NOT flag (text)[ref] inside inline code", () => {
    const result = lintMarkdown("Use `(text)[url]` for example");
    expect(result.some((d) => d.ruleId === "E03")).toBe(false);
  });

  it("flags (text)[ref] style reference link syntax", () => {
    const result = lintMarkdown("(click here)[some-ref]");
    expect(result.some((d) => d.ruleId === "E03")).toBe(true);
  });

  it("still flags (text)[url] inside a blockquote", () => {
    const result = lintMarkdown("> (text)[url]");
    expect(result.some((d) => d.ruleId === "E03")).toBe(true);
  });

  it("flags multiple reversed links on same line", () => {
    const result = lintMarkdown("(a)[b] and (c)[d]");
    const e03 = result.filter((d) => d.ruleId === "E03");
    expect(e03.length).toBe(2);
  });

  it("sets uiHint to sourceOnly", () => {
    const result = lintMarkdown("(text)[url]");
    const d = result.find((d) => d.ruleId === "E03");
    expect(d?.uiHint).toBe("sourceOnly");
  });

  it("reports correct line and column (1-based)", () => {
    const source = "Normal line\n(text)[url]";
    const result = lintMarkdown(source);
    const d = result.find((d) => d.ruleId === "E03");
    expect(d?.line).toBe(2);
    expect(d?.column).toBe(1);
  });

  it("does NOT flag plain parentheses and brackets that are separate", () => {
    const result = lintMarkdown("See (example) and [link](url)");
    expect(result.some((d) => d.ruleId === "E03")).toBe(false);
  });

  it("does NOT flag when inside tilde code block", () => {
    const source = "~~~\n(text)[url]\n~~~";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E03")).toBe(false);
  });
  // Audit R3 #825/#826/#827/#829: the rule used to carry its own inline-code
  // scanner that toggled on EVERY backtick, and a flat regex with no escape or
  // nesting awareness. Code regions now come from the MDAST the parser already
  // produced, so every CommonMark shape below is decided by the real parser.

  it("flags a reversed link on a line holding one literal backtick", () => {
    // A lone backtick opens nothing — the old toggle scanner treated the rest
    // of the line as code and silently dropped the diagnostic.
    const result = lintMarkdown("A ` backtick, then (text)[url] here");
    expect(result.some((d) => d.ruleId === "E03")).toBe(true);
  });

  it("does NOT flag inside a multi-backtick code span", () => {
    const result = lintMarkdown("Use ``(text)[url]`` verbatim");
    expect(result.some((d) => d.ruleId === "E03")).toBe(false);
  });

  it("does NOT flag inside a code span that spans two lines", () => {
    const result = lintMarkdown("Start `code (text)[url]\nstill code` end");
    expect(result.some((d) => d.ruleId === "E03")).toBe(false);
  });

  it("does NOT flag an ESCAPED opening parenthesis", () => {
    const result = lintMarkdown("Literal \\(text)[url] is not a link");
    expect(result.some((d) => d.ruleId === "E03")).toBe(false);
  });

  it("flags a reversed link whose text contains nested parentheses", () => {
    const result = lintMarkdown("(a (b))[url]");
    expect(result.some((d) => d.ruleId === "E03")).toBe(true);
  });

  it("does NOT flag inside a fenced code block nested in a blockquote", () => {
    const source = "> ```\n> (text)[url]\n> ```";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E03")).toBe(false);
  });

  it("does NOT flag inside an indented code block", () => {
    const source = "Text\n\n    (text)[url]\n";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E03")).toBe(false);
  });

  it("reports an offset that indexes the source at the match", () => {
    const source = "line one\nline two\n(text)[url]";
    const d = lintMarkdown(source).find((x) => x.ruleId === "E03");
    expect(d).toBeDefined();
    expect(source.slice(d!.offset, d!.endOffset)).toBe("(text)[url]");
  });
});
