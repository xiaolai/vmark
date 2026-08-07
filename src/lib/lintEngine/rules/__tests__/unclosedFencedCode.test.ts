// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../../linter";

describe("E08 unclosedFencedCode", () => {
  it("does NOT flag matched fences", () => {
    const source = "```\nsome code\n```";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E08")).toBe(false);
  });

  it("flags an opening fence without a closing fence", () => {
    const source = "```\nsome code\nno closing fence";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E08")).toBe(true);
  });

  it("does NOT flag when wrong char closes (``` vs ~~~)", () => {
    // Opening with ``` but closing with ~~~ does not close the fence
    const source = "```\nsome code\n~~~";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E08")).toBe(true);
  });

  it("accepts longer closing fence (````  closes ```)", () => {
    const source = "```\nsome code\n````";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E08")).toBe(false);
  });

  it("does NOT flag 4+ space indented lines as fences", () => {
    const result = lintMarkdown("    ```\n    code\n    ```");
    expect(result.some((d) => d.ruleId === "E08")).toBe(false);
  });

  it("diagnostic points to the opening line (1-based)", () => {
    const source = "Normal text\n```\nunclosed";
    const result = lintMarkdown(source);
    const d = result.find((d) => d.ruleId === "E08");
    expect(d?.line).toBe(2);
  });

  it("sets uiHint to sourceOnly", () => {
    const source = "```\nunclosed";
    const result = lintMarkdown(source);
    const d = result.find((d) => d.ruleId === "E08");
    expect(d?.uiHint).toBe("sourceOnly");
  });

  it("handles tilde fence unclosed", () => {
    const source = "~~~\nsome code";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E08")).toBe(true);
  });

  it("handles nested-looking content (fence inside fence is still just text)", () => {
    // Once inside a fence, inner ``` just counts as text
    const source = "````\n```\nsome code\n```\n````";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E08")).toBe(false);
  });

  it("does NOT flag valid document with no fences", () => {
    const result = lintMarkdown("# Title\n\nNormal paragraph.");
    expect(result.some((d) => d.ruleId === "E08")).toBe(false);
  });

  // Issue 6: closing fence must be fence chars + optional whitespace only
  it("does NOT close fence when closing line has trailing non-whitespace (permissive bug)", () => {
    // ``` followed by language tag should NOT be treated as a closing fence
    const source = "```\nsome code\n```js\nmore text";
    const result = lintMarkdown(source);
    // The ``` on line 3 has "js" after it — NOT a valid closing fence
    expect(result.some((d) => d.ruleId === "E08")).toBe(true);
  });

  it("DOES close fence when closing line has only trailing whitespace", () => {
    const source = "```\nsome code\n```   \n";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E08")).toBe(false);
  });
});
