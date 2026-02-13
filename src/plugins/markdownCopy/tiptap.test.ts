import { describe, it, expect } from "vitest";
import { cleanMarkdownForClipboard, cleanTextForClipboard } from "./tiptap";

describe("cleanMarkdownForClipboard", () => {
  describe("backslash escape stripping", () => {
    it("strips escaped dollar signs", () => {
      expect(cleanMarkdownForClipboard("Price is \\$99.99")).toBe(
        "Price is $99.99"
      );
    });

    it("strips escaped tildes", () => {
      expect(cleanMarkdownForClipboard("\\~20% off")).toBe("~20% off");
    });

    it("strips escaped at signs", () => {
      expect(cleanMarkdownForClipboard("user\\@example.com")).toBe(
        "user@example.com"
      );
    });

    it("strips escaped brackets", () => {
      expect(cleanMarkdownForClipboard("\\[not a link]")).toBe("[not a link]");
    });

    it("strips escaped asterisks", () => {
      expect(cleanMarkdownForClipboard("5 \\* 3 = 15")).toBe("5 * 3 = 15");
    });

    it("strips escaped underscores", () => {
      expect(cleanMarkdownForClipboard("snake\\_case")).toBe("snake_case");
    });

    it("strips escaped colons", () => {
      expect(cleanMarkdownForClipboard("https\\://example.com")).toBe(
        "https://example.com"
      );
    });

    it("strips escaped ampersands", () => {
      expect(cleanMarkdownForClipboard("foo\\&bar")).toBe("foo&bar");
    });

    it("converts double backslash to single", () => {
      expect(cleanMarkdownForClipboard("C:\\\\Users\\\\foo")).toBe(
        "C:\\Users\\foo"
      );
    });

    it("does not strip backslash before newline", () => {
      expect(cleanMarkdownForClipboard("line1\\\nline2")).toBe(
        "line1\\\nline2"
      );
    });

    it("handles multiple escapes in one line", () => {
      expect(
        cleanMarkdownForClipboard("\\$99 is \\~20% off\\!")
      ).toBe("$99 is ~20% off!");
    });
  });

  describe("autolink collapsing", () => {
    it("collapses URL autolinks", () => {
      expect(
        cleanMarkdownForClipboard(
          "[https://example.com/path](https://example.com/path)"
        )
      ).toBe("https://example.com/path");
    });

    it("collapses mailto autolinks", () => {
      expect(
        cleanMarkdownForClipboard(
          "[user@example.com](mailto:user@example.com)"
        )
      ).toBe("user@example.com");
    });

    it("collapses autolinks with escaped chars in text", () => {
      // Serializer escapes @ in text but not in URL
      expect(
        cleanMarkdownForClipboard(
          "[user\\@example.com](mailto:user@example.com)"
        )
      ).toBe("user@example.com");
    });

    it("collapses URL autolinks with escaped colons", () => {
      expect(
        cleanMarkdownForClipboard(
          "[https\\://example.com](https://example.com)"
        )
      ).toBe("https://example.com");
    });

    it("preserves real links where text differs from URL", () => {
      expect(
        cleanMarkdownForClipboard("[click here](https://example.com)")
      ).toBe("[click here](https://example.com)");
    });
  });

  describe("preserves markdown syntax", () => {
    it("preserves bold", () => {
      expect(cleanMarkdownForClipboard("**bold**")).toBe("**bold**");
    });

    it("preserves italic", () => {
      expect(cleanMarkdownForClipboard("*italic*")).toBe("*italic*");
    });

    it("preserves strikethrough", () => {
      expect(cleanMarkdownForClipboard("~~deleted~~")).toBe("~~deleted~~");
    });

    it("preserves code spans", () => {
      expect(cleanMarkdownForClipboard("`code`")).toBe("`code`");
    });

    it("preserves headings", () => {
      expect(cleanMarkdownForClipboard("## Heading")).toBe("## Heading");
    });

    it("preserves fenced code blocks", () => {
      const input = "```js\nconst x = 1;\n```";
      expect(cleanMarkdownForClipboard(input)).toBe(input);
    });
  });

  describe("does not strip unknown escapes", () => {
    it("preserves backslash before letters", () => {
      expect(cleanMarkdownForClipboard("\\n \\t")).toBe("\\n \\t");
    });

    it("preserves backslash before digits", () => {
      expect(cleanMarkdownForClipboard("item \\1")).toBe("item \\1");
    });

    it("preserves backslash before space", () => {
      expect(cleanMarkdownForClipboard("foo\\ bar")).toBe("foo\\ bar");
    });
  });
});

describe("cleanTextForClipboard", () => {
  it("trims trailing whitespace from each line", () => {
    expect(cleanTextForClipboard("hello   \nworld  ")).toBe("hello\nworld");
  });

  it("trims trailing tabs from each line", () => {
    expect(cleanTextForClipboard("hello\t\t\nworld\t")).toBe("hello\nworld");
  });

  it("collapses multiple blank lines into one", () => {
    expect(cleanTextForClipboard("a\n\n\nb")).toBe("a\n\nb");
  });

  it("collapses many blank lines into one", () => {
    expect(cleanTextForClipboard("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("trims leading blank lines", () => {
    expect(cleanTextForClipboard("\n\nhello")).toBe("hello");
  });

  it("trims trailing blank lines", () => {
    expect(cleanTextForClipboard("hello\n\n")).toBe("hello");
  });

  it("trims both leading and trailing blank lines", () => {
    expect(cleanTextForClipboard("\n\nhello\n\n")).toBe("hello");
  });

  it("handles all three rules together", () => {
    const input = "\n\nline one   \n\n\n\nline two  \n\n";
    expect(cleanTextForClipboard(input)).toBe("line one\n\nline two");
  });

  it("preserves single blank line between paragraphs", () => {
    expect(cleanTextForClipboard("para one\n\npara two")).toBe(
      "para one\n\npara two"
    );
  });

  it("returns empty string for whitespace-only input", () => {
    expect(cleanTextForClipboard("   \n\n  \n  ")).toBe("");
  });
});
