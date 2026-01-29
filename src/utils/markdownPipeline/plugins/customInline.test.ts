/**
 * Custom inline syntax plugin tests
 *
 * Tests for ~subscript~, ^superscript^, ==highlight==, ++underline++ parsing.
 * TDD: Write tests first, then implement.
 */

import { describe, it, expect } from "vitest";
import { parseMarkdownToMdast } from "../parser";
import { serializeMdastToMarkdown } from "../serializer";

describe("customInline remark plugin", () => {
  describe("subscript ~text~", () => {
    it("parses subscript syntax", () => {
      const mdast = parseMarkdownToMdast("H~2~O is water");

      const para = mdast.children[0];
      expect(para?.type).toBe("paragraph");

      // Check that subscript node exists
      const children = (para as { children?: unknown[] })?.children ?? [];
      const subNode = children.find(
        (c) => (c as { type?: string }).type === "subscript"
      );
      expect(subNode).toBeDefined();
    });

    it("serializes subscript back to ~text~", () => {
      const mdast = parseMarkdownToMdast("H~2~O");
      const md = serializeMdastToMarkdown(mdast);

      expect(md.trim()).toBe("H~2~O");
    });

    it("ignores ~~ strikethrough", () => {
      // ~~ is strikethrough, not double subscript
      const mdast = parseMarkdownToMdast("~~strikethrough~~");

      const para = mdast.children[0];
      const children = (para as { children?: unknown[] })?.children ?? [];
      const subNode = children.find(
        (c) => (c as { type?: string }).type === "subscript"
      );
      expect(subNode).toBeUndefined();
    });
  });

  describe("superscript ^text^", () => {
    it("parses superscript syntax", () => {
      const mdast = parseMarkdownToMdast("E=mc^2^");

      const para = mdast.children[0];
      expect(para?.type).toBe("paragraph");

      const children = (para as { children?: unknown[] })?.children ?? [];
      const supNode = children.find(
        (c) => (c as { type?: string }).type === "superscript"
      );
      expect(supNode).toBeDefined();
    });

    it("serializes superscript back to ^text^", () => {
      const mdast = parseMarkdownToMdast("x^2^");
      const md = serializeMdastToMarkdown(mdast);

      expect(md.trim()).toBe("x^2^");
    });
  });

  describe("highlight ==text==", () => {
    it("parses highlight syntax", () => {
      const mdast = parseMarkdownToMdast("This is ==important== text");

      const para = mdast.children[0];
      expect(para?.type).toBe("paragraph");

      const children = (para as { children?: unknown[] })?.children ?? [];
      const highlightNode = children.find(
        (c) => (c as { type?: string }).type === "highlight"
      );
      expect(highlightNode).toBeDefined();
    });

    it("serializes highlight back to ==text==", () => {
      const mdast = parseMarkdownToMdast("==important==");
      const md = serializeMdastToMarkdown(mdast);

      expect(md.trim()).toBe("==important==");
    });
  });

  describe("underline ++text++", () => {
    it("parses underline syntax", () => {
      const mdast = parseMarkdownToMdast("This is ++underlined++ text");

      const para = mdast.children[0];
      expect(para?.type).toBe("paragraph");

      const children = (para as { children?: unknown[] })?.children ?? [];
      const underlineNode = children.find(
        (c) => (c as { type?: string }).type === "underline"
      );
      expect(underlineNode).toBeDefined();
    });

    it("serializes underline back to ++text++", () => {
      const mdast = parseMarkdownToMdast("++underlined++");
      const md = serializeMdastToMarkdown(mdast);

      expect(md.trim()).toBe("++underlined++");
    });
  });

  describe("nested marks", () => {
    it("handles nested subscript in bold", () => {
      const mdast = parseMarkdownToMdast("**H~2~O**");
      const md = serializeMdastToMarkdown(mdast);

      // Should preserve both marks
      expect(md).toContain("**");
      expect(md).toContain("~");
    });

    it("handles subscript alone", () => {
      const mdast = parseMarkdownToMdast("H~2~O");
      const md = serializeMdastToMarkdown(mdast);
      expect(md.trim()).toBe("H~2~O");
    });

    it("handles subscript with trailing text", () => {
      const mdast = parseMarkdownToMdast("H~2~O and water");
      const md = serializeMdastToMarkdown(mdast);
      expect(md.trim()).toBe("H~2~O and water");
    });

    it("handles superscript then subscript", () => {
      const mdast = parseMarkdownToMdast("x^2^ and H~2~O");
      const md = serializeMdastToMarkdown(mdast);
      expect(md.trim()).toBe("x^2^ and H~2~O");
    });

    it("handles subscript then superscript", () => {
      const mdast = parseMarkdownToMdast("H~2~O and x^2^");
      const md = serializeMdastToMarkdown(mdast);
      expect(md.trim()).toBe("H~2~O and x^2^");
    });

    it("handles multiple marks in one paragraph", () => {
      const mdast = parseMarkdownToMdast("H~2~O and x^2^ and ==highlight==");
      const md = serializeMdastToMarkdown(mdast);

      expect(md.trim()).toBe("H~2~O and x^2^ and ==highlight==");
    });
  });

  describe("skip protected nodes", () => {
    it("ignores markers inside inline code", () => {
      const mdast = parseMarkdownToMdast("`H~2~O`");
      const para = mdast.children[0];
      const children = (para as { children?: unknown[] })?.children ?? [];
      const subNode = children.find((c) => (c as { type?: string }).type === "subscript");
      expect(subNode).toBeUndefined();
    });

    it("ignores markers inside inline math", () => {
      const mdast = parseMarkdownToMdast("$H~2~O$");
      const para = mdast.children[0];
      const children = (para as { children?: unknown[] })?.children ?? [];
      const subNode = children.find((c) => (c as { type?: string }).type === "subscript");
      expect(subNode).toBeUndefined();
    });
  });

  describe("escaped markers", () => {
    it("does not parse escaped highlight \\==text==", () => {
      const mdast = parseMarkdownToMdast("\\==text==");
      const para = mdast.children[0];
      const children = (para as { children?: unknown[] })?.children ?? [];

      // Should be plain text, not highlight
      const highlightNode = children.find((c) => (c as { type?: string }).type === "highlight");
      expect(highlightNode).toBeUndefined();

      // Should contain literal ==
      const textNode = children.find((c) => (c as { type?: string }).type === "text");
      expect((textNode as { value?: string })?.value).toContain("==");
    });

    it("does not parse escaped underline \\++text++", () => {
      const mdast = parseMarkdownToMdast("\\++text++");
      const para = mdast.children[0];
      const children = (para as { children?: unknown[] })?.children ?? [];

      const underlineNode = children.find((c) => (c as { type?: string }).type === "underline");
      expect(underlineNode).toBeUndefined();

      const textNode = children.find((c) => (c as { type?: string }).type === "text");
      expect((textNode as { value?: string })?.value).toContain("++");
    });

    it("does not parse escaped superscript \\^text^", () => {
      const mdast = parseMarkdownToMdast("\\^text^");
      const para = mdast.children[0];
      const children = (para as { children?: unknown[] })?.children ?? [];

      const supNode = children.find((c) => (c as { type?: string }).type === "superscript");
      expect(supNode).toBeUndefined();

      const textNode = children.find((c) => (c as { type?: string }).type === "text");
      expect((textNode as { value?: string })?.value).toContain("^");
    });

    it("does not parse escaped subscript \\~text~", () => {
      const mdast = parseMarkdownToMdast("\\~text~");
      const para = mdast.children[0];
      const children = (para as { children?: unknown[] })?.children ?? [];

      const subNode = children.find((c) => (c as { type?: string }).type === "subscript");
      expect(subNode).toBeUndefined();

      const textNode = children.find((c) => (c as { type?: string }).type === "text");
      expect((textNode as { value?: string })?.value).toContain("~");
    });

    it("handles escaped opening but normal closing", () => {
      // \==text== should show ==text== as literal text
      const mdast = parseMarkdownToMdast("\\==highlighted text==");
      const para = mdast.children[0];
      const children = (para as { children?: unknown[] })?.children ?? [];

      // Should not be highlighted
      const highlightNode = children.find((c) => (c as { type?: string }).type === "highlight");
      expect(highlightNode).toBeUndefined();
    });

    it("parses non-escaped markers normally", () => {
      // Regular ==text== should still highlight
      const mdast = parseMarkdownToMdast("==highlighted==");
      const para = mdast.children[0];
      const children = (para as { children?: unknown[] })?.children ?? [];

      const highlightNode = children.find((c) => (c as { type?: string }).type === "highlight");
      expect(highlightNode).toBeDefined();
    });

    it("does not corrupt escaped markers inside inline code", () => {
      const mdast = parseMarkdownToMdast("`\\==not highlight==`");
      const para = mdast.children[0];
      const children = (para as { children?: unknown[] })?.children ?? [];

      const inlineCode = children.find((c) => (c as { type?: string }).type === "inlineCode");
      expect(inlineCode).toBeDefined();
      expect((inlineCode as { value?: string })?.value).toBe("\\==not highlight==");

      const md = serializeMdastToMarkdown(mdast);
      expect(md.trim()).toBe("`\\==not highlight==`");
    });

    it("does not corrupt escaped markers inside fenced code blocks", () => {
      const mdast = parseMarkdownToMdast(["```", "\\==not highlight==", "```", ""].join("\n"));

      const code = mdast.children.find((c) => (c as { type?: string }).type === "code");
      expect(code).toBeDefined();
      expect((code as { value?: string })?.value).toBe("\\==not highlight==");

      const md = serializeMdastToMarkdown(mdast);
      expect(md).toContain("\\==not highlight==");
      expect(md).toContain("```");
    });
  });
});
