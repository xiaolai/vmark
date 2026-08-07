// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../../linter";

describe("E04 noMissingSpaceAtx", () => {
  it("flags #heading without space", () => {
    const result = lintMarkdown("#heading");
    expect(result.some((d) => d.ruleId === "E04")).toBe(true);
  });

  it("does NOT flag # heading with space", () => {
    const result = lintMarkdown("# heading");
    expect(result.some((d) => d.ruleId === "E04")).toBe(false);
  });

  it("flags ##heading without space", () => {
    const result = lintMarkdown("##heading");
    expect(result.some((d) => d.ruleId === "E04")).toBe(true);
  });

  it("does NOT flag lines inside a fenced code block", () => {
    const source = "```\n#heading\n```";
    const result = lintMarkdown(source);
    expect(result.some((d) => d.ruleId === "E04")).toBe(false);
  });

  it("does NOT flag lines with 4+ leading spaces (indented code)", () => {
    const result = lintMarkdown("    #heading");
    expect(result.some((d) => d.ruleId === "E04")).toBe(false);
  });

  it("does NOT flag bare # with nothing after (closing sequence)", () => {
    const result = lintMarkdown("# Title #");
    expect(result.some((d) => d.ruleId === "E04")).toBe(false);
  });

  it("flags ###heading without space", () => {
    const result = lintMarkdown("###heading");
    expect(result.some((d) => d.ruleId === "E04")).toBe(true);
  });

  it("does NOT flag #hashtag in running text (not at line start)", () => {
    const result = lintMarkdown("Some text #hashtag here");
    expect(result.some((d) => d.ruleId === "E04")).toBe(false);
  });

  it("sets uiHint to sourceOnly", () => {
    const result = lintMarkdown("#heading");
    const d = result.find((d) => d.ruleId === "E04");
    expect(d?.uiHint).toBe("sourceOnly");
  });

  it("reports correct line number (1-based)", () => {
    const source = "# Good heading\n\n##bad";
    const result = lintMarkdown(source);
    const d = result.find((d) => d.ruleId === "E04");
    expect(d?.line).toBe(3);
  });

  it("allows up to 3 leading spaces before # (CommonMark ATX)", () => {
    // 1-3 spaces + # without space after = should flag
    const result = lintMarkdown("   #heading");
    expect(result.some((d) => d.ruleId === "E04")).toBe(true);
  });

  it("does NOT flag line that is only hashes", () => {
    const result = lintMarkdown("######");
    expect(result.some((d) => d.ruleId === "E04")).toBe(false);
  });
});
