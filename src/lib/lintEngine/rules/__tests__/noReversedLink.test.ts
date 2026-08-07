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
});
