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
  // Audit R3 #861/#862/#863.

  it("does NOT close a fence on a line whose suffix is Unicode whitespace", () => {
    // CommonMark permits only spaces and tabs after a closing fence; `trim()`
    // also ate NBSP, U+2003 and friends, silently closing a fence that is open.
    const source = "```\nsome code\n```\u00a0\nmore text";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E08")).toBe(true);
  });

  it("DOES close a fence when the line ends with a retained CR (CRLF input)", () => {
    const source = "```\r\nsome code\r\n```\r\n";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E08")).toBe(false);
  });

  it("does NOT treat a backtick opener with a backtick in its info string as a fence", () => {
    // CommonMark: an info string after ``` may not contain a backtick, so this
    // line opens nothing and the document has no unclosed fence.
    const source = "```js`\nnot code\n";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E08")).toBe(false);
  });

  it("still allows a backtick in a TILDE opener's info string", () => {
    const source = "~~~js`\nstill open\n";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E08")).toBe(true);
  });

  it("reports an offset that indexes the source at the opening fence", () => {
    const source = "para\n\n  ```ts\nunclosed";
    const d = lintMarkdown(source).find((x) => x.ruleId === "E08");
    expect(d).toBeDefined();
    expect(source.slice(d!.offset, d!.offset + 3)).toBe("```");
    expect(d!.line).toBe(3);
    expect(d!.column).toBe(3);
  });
});
