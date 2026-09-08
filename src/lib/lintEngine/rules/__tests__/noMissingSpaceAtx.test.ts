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

// Audit 20260907 round 3 (#823/#824). The rule tracked fences itself, so it
// only saw the ones that start their own line, and it matched at the physical
// line start, so a heading inside a container was invisible.
describe("E04 — blocks the parser does not read as prose", () => {
  const flagged = (input: string) => lintMarkdown(input).some((d) => d.ruleId === "E04");

  it.each([
    { name: "YAML front matter (#823)", input: "---\n#comment: yes\n---\n\ntext\n" },
    { name: "a raw HTML block (#823)", input: "<div>\n#notaheading\n</div>\n" },
    { name: "a fence a blockquote prefixes (#823)", input: "> ```\n> #code\n> ```\n" },
    { name: "an indented code block", input: "text\n\n    #code\n" },
  ])("$name is not a heading", ({ input }) => {
    expect(flagged(input)).toBe(false);
  });

  it.each([
    { name: "a blockquote (#824)", input: "> #heading\n" },
    { name: "a nested blockquote (#824)", input: "> > #heading\n" },
    { name: "a list item (#824)", input: "- #heading\n" },
    { name: "an ordered list item (#824)", input: "1. #heading\n" },
  ])("a malformed heading inside $name is still one", ({ input }) => {
    expect(flagged(input)).toBe(true);
  });

  it("reports the ABSOLUTE column of the hash inside a container", () => {
    const d = lintMarkdown("> #heading\n").find((x) => x.ruleId === "E04");
    expect(d).toBeDefined();
    expect(d!.column).toBe(3);
    expect("> #heading".charAt(d!.offset)).toBe("#");
  });

  it("uses the engine's line index, so offsets survive a CRLF document", () => {
    const source = "a\r\nb\r\n#bad\r\n";
    const d = lintMarkdown(source).find((x) => x.ruleId === "E04");
    expect(d).toBeDefined();
    expect(source.charAt(d!.offset)).toBe("#");
  });
});
