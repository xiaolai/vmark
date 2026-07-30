import { describe, it, expect } from "vitest";
import { stripBlockMarkup } from "./lineContent";

describe("stripBlockMarkup", () => {
  it.each([
    { line: "The quick brown fox", quote: "", indent: "", content: "The quick brown fox" },
    { line: "### The quick brown fox", quote: "", indent: "", content: "The quick brown fox" },
    { line: "###### deep", quote: "", indent: "", content: "deep" },
    { line: "- The quick brown fox", quote: "", indent: "", content: "The quick brown fox" },
    { line: "1. numbered", quote: "", indent: "", content: "numbered" },
    { line: "1) paren", quote: "", indent: "", content: "paren" },
    { line: "- [ ] todo", quote: "", indent: "", content: "todo" },
    { line: "- [x] done", quote: "", indent: "", content: "done" },
    { line: "> quoted", quote: "> ", indent: "", content: "quoted" },
    { line: "> > deep quote", quote: "> > ", indent: "", content: "deep quote" },
    { line: "> - quoted item", quote: "> ", indent: "", content: "quoted item" },
    { line: "> ### quoted heading", quote: "> ", indent: "", content: "quoted heading" },
  ])("$line", ({ line, quote, indent, content }) => {
    expect(stripBlockMarkup(line)).toEqual({ quote, indent, content });
  });

  // Indentation is CONTENT for a code block: it is what shows the nesting once
  // the markers are gone. `splitLine` in headingDetection discards it, which is
  // right for a heading conversion and wrong here.
  it("keeps a nested item's indentation", () => {
    expect(stripBlockMarkup("  - inner brown")).toEqual({
      quote: "",
      indent: "  ",
      content: "inner brown",
    });
  });

  it("keeps indentation on a plain indented line", () => {
    expect(stripBlockMarkup("    code-ish")).toEqual({
      quote: "",
      indent: "    ",
      content: "code-ish",
    });
  });

  it("leaves a blank line blank", () => {
    expect(stripBlockMarkup("")).toEqual({ quote: "", indent: "", content: "" });
  });

  it("does not mistake a thematic break for a list marker", () => {
    expect(stripBlockMarkup("---")).toEqual({ quote: "", indent: "", content: "---" });
  });

  it("does not strip an emphasis marker", () => {
    expect(stripBlockMarkup("*emphasis* here")).toEqual({
      quote: "",
      indent: "",
      content: "*emphasis* here",
    });
  });

  it("reports indentation found INSIDE a quote wrapper", () => {
    // The quote is the wrapper; the whitespace after it is the content's own
    // nesting, which a quoted nested list depends on.
    expect(stripBlockMarkup(">   deep inside")).toEqual({
      quote: "> ",
      indent: "  ",
      content: "deep inside",
    });
  });

  it("treats an underline-length rule inside a quote as content", () => {
    expect(stripBlockMarkup("> ---")).toEqual({ quote: "> ", indent: "", content: "---" });
  });

  it("handles CJK content", () => {
    expect(stripBlockMarkup("- 中文内容")).toEqual({ quote: "", indent: "", content: "中文内容" });
  });

  it("strips only ONE list marker, so a doubled one stays visible", () => {
    expect(stripBlockMarkup("- - two").content).toBe("- two");
  });
});
