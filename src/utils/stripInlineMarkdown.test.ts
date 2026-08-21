// @vitest-environment node
import { describe, it, expect } from "vitest";
import { stripInlineMarkdown } from "./stripInlineMarkdown";

describe("stripInlineMarkdown", () => {
  it.each([
    ["plain text is untouched", "Getting Started", "Getting Started"],
    ["bold", "The **bold** one", "The bold one"],
    ["bold, underscore form", "The __bold__ one", "The bold one"],
    ["italic", "The *soft* one", "The soft one"],
    ["italic, underscore form", "The _soft_ one", "The soft one"],
    ["bold italic", "The ***loud*** one", "The loud one"],
    ["code span", "Use `invoke()` here", "Use invoke() here"],
    ["strikethrough", "The ~~old~~ way", "The old way"],
    ["highlight", "The ==key== bit", "The key bit"],
    ["inline link", "See [the docs](https://x.dev)", "See the docs"],
    ["reference link", "See [the docs][ref]", "See the docs"],
    ["image", "Logo ![the mark](a.png)", "Logo the mark"],
    ["wiki link", "See [[Some Page]]", "See Some Page"],
    ["wiki link with label", "See [[some-page|Some Page]]", "See Some Page"],
    ["several at once", "**A** and `b` and [c](u)", "A and b and c"],
    ["nested", "**bold with `code`**", "bold with code"],
  ])("%s", (_name, input, expected) => {
    expect(stripInlineMarkdown(input)).toBe(expected);
  });

  describe("things it must NOT eat", () => {
    it("leaves an unmatched marker alone, as CommonMark does", () => {
      expect(stripInlineMarkdown("2 ** 3 is not bold")).toBe("2 ** 3 is not bold");
      expect(stripInlineMarkdown("The **dangling")).toBe("The **dangling");
    });

    it("leaves intraword underscores alone — snake_case is not emphasis", () => {
      expect(stripInlineMarkdown("The snake_case_name rule")).toBe("The snake_case_name rule");
    });

    it("keeps markdown that is INSIDE a code span", () => {
      // `## The \`**\` operator` must not lose the operator it is documenting.
      expect(stripInlineMarkdown("The `**` operator")).toBe("The ** operator");
      expect(stripInlineMarkdown("Use `[a](b)` for links")).toBe("Use [a](b) for links");
    });

    it("unescapes a backslash-escaped marker instead of stripping it", () => {
      expect(stripInlineMarkdown("A literal \\*star\\*")).toBe("A literal *star*");
      expect(stripInlineMarkdown("A literal \\_underscore\\_")).toBe("A literal _underscore_");
    });

    it("leaves math alone — it is not inline emphasis", () => {
      expect(stripInlineMarkdown("Prove $a^2 + b^2$")).toBe("Prove $a^2 + b^2$");
    });

    it("leaves HTML alone — a heading may be ABOUT a tag", () => {
      expect(stripInlineMarkdown("Use <div> for this")).toBe("Use <div> for this");
    });
  });

  describe("edge cases", () => {
    it.each([
      ["empty", "", ""],
      ["whitespace only", "   ", "   "],
      ["markers only", "**", "**"],
      ["empty emphasis", "****", "****"],
      ["empty link text", "[](u)", ""],
      ["unclosed code span", "The `open one", "The `open one"],
      ["CJK", "**粗体**标题", "粗体标题"],
      ["CJK in a link", "见[文档](u)", "见文档"],
      ["RTL", "**عنوان** here", "عنوان here"],
      ["emoji", "**🎉 Party**", "🎉 Party"],
    ])("%s", (_name, input, expected) => {
      expect(stripInlineMarkdown(input)).toBe(expected);
    });

    it("does not hang on a long run of markers", () => {
      const input = "*".repeat(200);
      expect(stripInlineMarkdown(input)).toBe(input);
    });
  });
});
