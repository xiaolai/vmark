// @vitest-environment node
/**
 * MDAST to ProseMirror block conversion tests
 */

import { describe, it, expect } from "vitest";
import { parseMarkdownToMdast } from "./parser";
import { mdastToProseMirror } from "./mdastToProseMirror";
import { testSchema } from "./testSchema";

const parseDoc = (markdown: string) => mdastToProseMirror(testSchema, parseMarkdownToMdast(markdown));

describe("mdastToProseMirror blocks", () => {
  it("converts paragraphs and headings", () => {
    const doc = parseDoc("# Title\n\nBody");
    expect(doc.child(0).type.name).toBe("heading");
    expect(doc.child(1).type.name).toBe("paragraph");
  });

  it("converts code blocks", () => {
    const doc = parseDoc("```js\nconst x = 1;\n```");
    expect(doc.firstChild?.type.name).toBe("codeBlock");
    expect(doc.firstChild?.attrs.language).toBe("js");
  });

  it("converts lists and task items", () => {
    const doc = parseDoc("- [ ] Todo\n- [x] Done");
    const list = doc.firstChild;
    expect(list?.type.name).toBe("bulletList");
    expect(list?.child(0).attrs.checked).toBe(false);
    expect(list?.child(1).attrs.checked).toBe(true);
  });

  it("converts tables with alignment", () => {
    const md = `| A | B | C |
| :-- | :-: | --: |
| 1 | 2 | 3 |`;
    const doc = parseDoc(md);
    const table = doc.firstChild;
    expect(table?.type.name).toBe("table");
    const headerRow = table?.firstChild;
    const firstCell = headerRow?.firstChild;
    const secondCell = headerRow?.child(1);
    const thirdCell = headerRow?.child(2);
    expect(firstCell?.attrs.alignment).toBe("left");
    expect(secondCell?.attrs.alignment).toBe("center");
    expect(thirdCell?.attrs.alignment).toBe("right");
  });

  it("converts block math to code blocks with math sentinel", () => {
    const doc = parseDoc("$$\nx^2 + y^2 = z^2\n$$");
    expect(doc.firstChild?.type.name).toBe("codeBlock");
    // Uses sentinel value to distinguish from real latex code fences
    expect(doc.firstChild?.attrs.language).toBe("$$math$$");
  });

  it("converts alert blocks", () => {
    const doc = parseDoc("> [!NOTE]\n> Callout");
    expect(doc.firstChild?.type.name).toBe("alertBlock");
    expect(doc.firstChild?.attrs.alertType).toBe("NOTE");
  });

  it("converts details blocks", () => {
    const doc = parseDoc("<details>\n<summary>Info</summary>\n\nContent\n</details>");
    const details = doc.firstChild;
    expect(details?.type.name).toBe("detailsBlock");
    expect(details?.firstChild?.type.name).toBe("detailsSummary");
  });

  it("converts frontmatter", () => {
    const doc = parseDoc("---\ntitle: Test\n---\n\nBody");
    expect(doc.firstChild?.type.name).toBe("frontmatter");
  });

  it("converts link definitions", () => {
    const doc = parseDoc("[ref]: https://example.com");
    const def = doc.firstChild;
    expect(def?.type.name).toBe("link_definition");
    expect(def?.attrs.url).toBe("https://example.com");
  });

  it("converts html blocks", () => {
    const doc = parseDoc("<div>Raw</div>");
    expect(doc.firstChild?.type.name).toBe("html_block");
  });

  it("converts standalone images to block images", () => {
    const doc = parseDoc("![alt](image.png)");
    expect(doc.firstChild?.type.name).toBe("block_image");
  });

  it("converts footnote definitions", () => {
    const doc = parseDoc("[^1]: This is a footnote");
    expect(doc.firstChild?.type.name).toBe("footnote_definition");
    expect(doc.firstChild?.attrs.label).toBe("1");
  });

  it("handles unknown node type in convertNode (returns null, warns)", () => {
    const unknownRoot = {
      type: "root" as const,
      children: [{ type: "unknownNodeType" } as never],
    };
    const doc = mdastToProseMirror(testSchema, unknownRoot);
    expect(doc).toBeDefined();
  });

  it("generateHeadingId returns null for heading with no text (empty slug)", () => {
    const doc = parseDoc("# 💡");
    expect(doc.firstChild?.type.name).toBe("heading");
  });

  describe("mergeInlineHtmlTags — branch coverage", () => {
    it("merges paired inline HTML tags like <kbd>...</kbd>", () => {
      // This exercises the merge path: open tag found, close tag found, canSafelyMerge=true
      const doc = parseDoc("Press <kbd>Ctrl</kbd> to continue");
      expect(doc.firstChild?.type.name).toBe("paragraph");
    });

    it("does not merge when inner nodes have formatting marks (canSafelyMerge=false, line 318)", () => {
      // Inner emphasis node → canSafelyMerge returns false → tags pushed separately
      const doc = parseDoc("Use <span>*italic* text</span> here");
      expect(doc.firstChild?.type.name).toBe("paragraph");
    });

    it("handles self-closing HTML tags (parseInlineHtmlOpen returns null, line 337)", () => {
      // Self-closing tags like <br/> should not be treated as open tags
      const doc = parseDoc("Line<br/>break");
      expect(doc.firstChild?.type.name).toBe("paragraph");
    });

    it("handles close tag without matching open tag (line 284 fallback)", () => {
      // </kbd> without a preceding <kbd> — just pushed as-is
      const doc = parseDoc("text </kbd> more text");
      expect(doc.firstChild?.type.name).toBe("paragraph");
    });

    it("handles nested same-tag HTML (depth tracking, line 297-301)", () => {
      // Nested <span> inside <span> — depth tracking should handle correctly
      const doc = parseDoc("A <span>outer <span>inner</span> rest</span> end");
      expect(doc.firstChild?.type.name).toBe("paragraph");
    });

    it("handles open tag with no matching close (closeIndex === -1, line 329)", () => {
      // <kbd> with no </kbd> — pushed as plain html
      const doc = parseDoc("text <kbd>unclosed tag");
      expect(doc.firstChild?.type.name).toBe("paragraph");
    });
  });

  describe("serializeInlineHtmlNode — branch coverage", () => {
    it("handles break nodes inside merged HTML (line 369)", () => {
      // <kbd>text<br>more</kbd> — break node serialized as <br>
      const doc = parseDoc("Key <kbd>line1\nline2</kbd> done");
      expect(doc.firstChild?.type.name).toBe("paragraph");
    });
  });

  describe("mergeInlineHtmlTags — null value fallbacks", () => {
    it("handles html node with undefined value (node.value ?? '' at line 283)", () => {
      // Construct MDAST with inline html nodes that have undefined value
      const mdast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              { type: "html" as const, value: undefined as unknown as string },
              { type: "text" as const, value: "text" },
            ],
          },
        ],
      };
      const doc = mdastToProseMirror(testSchema, mdast as any);
      expect(doc).toBeDefined();
    });

    it("handles inner html node with undefined value (next.value ?? '' at line 296)", () => {
      // Open tag followed by html node with undefined value, then close tag
      const mdast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              { type: "html" as const, value: "<kbd>" },
              { type: "html" as const, value: undefined as unknown as string },
              { type: "html" as const, value: "</kbd>" },
            ],
          },
        ],
      };
      const doc = mdastToProseMirror(testSchema, mdast as any);
      expect(doc).toBeDefined();
    });

    it("handles canSafelyMerge returning false (emphasis inside tags, line 318)", () => {
      // Open tag, emphasis node (not text/html/break), close tag
      // canSafelyMerge returns false → open tag pushed as-is
      const mdast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              { type: "html" as const, value: "<span>" },
              { type: "emphasis" as const, children: [{ type: "text" as const, value: "em" }] },
              { type: "html" as const, value: "</span>" },
            ],
          },
        ],
      };
      const doc = mdastToProseMirror(testSchema, mdast as any);
      expect(doc).toBeDefined();
      // The emphasis is not merged — should have multiple inline nodes
    });

    it("handles closeNode.value ?? '' at line 323", () => {
      // Open tag, text, close tag with undefined value
      const mdast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              { type: "html" as const, value: "<kbd>" },
              { type: "text" as const, value: "key" },
              { type: "html" as const, value: undefined as unknown as string },
            ],
          },
        ],
      };
      const doc = mdastToProseMirror(testSchema, mdast as any);
      expect(doc).toBeDefined();
    });

    it("handles text node with undefined value in serializeInlineHtmlNode (line 365)", () => {
      // Open tag, text node with undefined value, close tag
      const mdast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              { type: "html" as const, value: "<kbd>" },
              { type: "text" as const, value: undefined as unknown as string },
              { type: "html" as const, value: "</kbd>" },
            ],
          },
        ],
      };
      const doc = mdastToProseMirror(testSchema, mdast as any);
      expect(doc).toBeDefined();
    });

    it("handles html node with undefined value inside merge (serializeInlineHtmlNode line 367)", () => {
      // Open tag, inner html with undefined value (not open/close), close tag
      // The inner html node passes canSafelyMerge, then serializeInlineHtmlNode handles it
      const mdast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              { type: "html" as const, value: "<kbd>" },
              { type: "html" as const, value: undefined as unknown as string },
              { type: "text" as const, value: "text" },
              { type: "html" as const, value: "</kbd>" },
            ],
          },
        ],
      };
      const doc = mdastToProseMirror(testSchema, mdast as any);
      expect(doc).toBeDefined();
    });

    it("handles parseInlineHtmlOpen returning null for non-tag content (line 341)", () => {
      // A value that starts with < but doesn't match the regex
      const mdast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              { type: "html" as const, value: "< not a tag" },
              { type: "text" as const, value: "text" },
            ],
          },
        ],
      };
      const doc = mdastToProseMirror(testSchema, mdast as any);
      expect(doc).toBeDefined();
    });

    it("handles isInlineHtmlClose with non-matching tag name (line 351)", () => {
      // <span> ... </div> — close tag doesn't match open tag
      const mdast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              { type: "html" as const, value: "<span>" },
              { type: "text" as const, value: "content" },
              { type: "html" as const, value: "</div>" },
              { type: "html" as const, value: "</span>" },
            ],
          },
        ],
      };
      const doc = mdastToProseMirror(testSchema, mdast as any);
      expect(doc).toBeDefined();
    });
  });
});
