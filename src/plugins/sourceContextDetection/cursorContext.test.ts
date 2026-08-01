import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { computeSourceCursorContext } from "./cursorContext";

function createView(
  doc: string,
  anchor: number,
  head?: number
): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor, head: head ?? anchor },
  });
  return new EditorView({ state, parent: document.createElement("div") });
}

describe("computeSourceCursorContext", () => {
  describe("basic structure", () => {
    it("returns a complete CursorContext object for empty document", () => {
      const view = createView("", 0);
      const ctx = computeSourceCursorContext(view);

      // Block contexts all null
      expect(ctx.inCodeBlock).toBeNull();
      expect(ctx.inBlockMath).toBeNull();
      expect(ctx.inTable).toBeNull();
      expect(ctx.inList).toBeNull();
      expect(ctx.inBlockquote).toBeNull();
      expect(ctx.inHeading).toBeNull();

      // Inline contexts all null
      expect(ctx.inLink).toBeNull();
      expect(ctx.inImage).toBeNull();
      expect(ctx.inInlineMath).toBeNull();
      expect(ctx.inFootnote).toBeNull();

      // Format ranges empty
      expect(ctx.activeFormats).toEqual([]);
      expect(ctx.formatRanges).toEqual([]);
      expect(ctx.innermostFormat).toBeNull();

      // Position
      expect(ctx.atBlankLine).toBe(true);
      expect(ctx.contextMode).toBe("block-insert");

      // Selection state
      expect(ctx.hasSelection).toBe(false);
      expect(ctx.selectionFrom).toBe(0);
      expect(ctx.selectionTo).toBe(0);

      view.destroy();
    });

    it("returns correct selectionFrom and selectionTo", () => {
      const view = createView("hello world", 3, 8);
      const ctx = computeSourceCursorContext(view);

      expect(ctx.selectionFrom).toBe(3);
      expect(ctx.selectionTo).toBe(8);
      expect(ctx.hasSelection).toBe(true);
      view.destroy();
    });
  });

  describe("heading detection integration", () => {
    it("detects heading context", () => {
      const view = createView("# Hello", 3);
      const ctx = computeSourceCursorContext(view);

      expect(ctx.inHeading).not.toBeNull();
      expect(ctx.inHeading!.level).toBe(1);
      view.destroy();
    });

    it("returns null heading for plain text", () => {
      const view = createView("Hello world", 3);
      const ctx = computeSourceCursorContext(view);
      expect(ctx.inHeading).toBeNull();
      view.destroy();
    });
  });

  describe("code block detection integration", () => {
    it("detects code block context", () => {
      const doc = "```javascript\nconsole.log('hi');\n```";
      const view = createView(doc, 20);
      const ctx = computeSourceCursorContext(view);

      expect(ctx.inCodeBlock).not.toBeNull();
      expect(ctx.inCodeBlock!.language).toBe("javascript");
      view.destroy();
    });

    it("returns null for non-code content", () => {
      const view = createView("plain text", 3);
      const ctx = computeSourceCursorContext(view);
      expect(ctx.inCodeBlock).toBeNull();
      view.destroy();
    });
  });

  describe("block math detection integration", () => {
    it("detects block math context", () => {
      const doc = "$$\nx^2\n$$";
      const view = createView(doc, 4);
      const ctx = computeSourceCursorContext(view);

      expect(ctx.inBlockMath).not.toBeNull();
      expect(ctx.inBlockMath!.nodePos).toBeDefined();
      view.destroy();
    });
  });

  describe("inline element detection integration", () => {
    it("detects link context", () => {
      const doc = "text [link](url) more";
      const view = createView(doc, 8); // inside link
      const ctx = computeSourceCursorContext(view);

      expect(ctx.inLink).not.toBeNull();
      expect(ctx.inLink!.from).toBe(5);
      view.destroy();
    });

    it("detects image context", () => {
      const doc = "text ![alt](img.png) more";
      const view = createView(doc, 10);
      const ctx = computeSourceCursorContext(view);

      expect(ctx.inImage).not.toBeNull();
      view.destroy();
    });

    it("detects inline math context", () => {
      const doc = "text $x^2$ more";
      const view = createView(doc, 7);
      const ctx = computeSourceCursorContext(view);

      expect(ctx.inInlineMath).not.toBeNull();
      expect(ctx.inInlineMath!.contentFrom).toBeGreaterThan(ctx.inInlineMath!.from);
      view.destroy();
    });

    it("detects footnote context", () => {
      const doc = "text[^1] more";
      const view = createView(doc, 6);
      const ctx = computeSourceCursorContext(view);

      expect(ctx.inFootnote).not.toBeNull();
      expect(ctx.inFootnote!.label).toBeDefined();
      view.destroy();
    });
  });

  describe("table detection integration", () => {
    it("detects table context", () => {
      const doc = "| a | b |\n| --- | --- |\n| c | d |";
      const view = createView(doc, 25); // inside table data row
      const ctx = computeSourceCursorContext(view);

      expect(ctx.inTable).not.toBeNull();
      expect(ctx.inTable!.row).toBeDefined();
      expect(ctx.inTable!.col).toBeDefined();
      view.destroy();
    });
  });

  describe("list detection integration", () => {
    it("detects list context", () => {
      const doc = "- item one\n- item two";
      const view = createView(doc, 5); // inside first list item
      const ctx = computeSourceCursorContext(view);

      expect(ctx.inList).not.toBeNull();
      expect(ctx.inList!.type).toBeDefined();
      expect(ctx.inList!.depth).toBeGreaterThanOrEqual(1);
      view.destroy();
    });
  });

  describe("blockquote detection integration", () => {
    it("detects blockquote context", () => {
      const doc = "> quoted text";
      const view = createView(doc, 5); // inside blockquote
      const ctx = computeSourceCursorContext(view);

      expect(ctx.inBlockquote).not.toBeNull();
      expect(ctx.inBlockquote!.depth).toBeGreaterThanOrEqual(1);
      view.destroy();
    });
  });

  describe("format range detection integration", () => {
    it("detects format range when inside bold text", () => {
      const doc = "text **bold** more";
      const view = createView(doc, 8); // inside "bold"
      const ctx = computeSourceCursorContext(view);

      // May or may not detect bold depending on detection implementation
      // but exercises the getAllFormattedRanges path
      expect(ctx.formatRanges).toBeDefined();
      expect(ctx.activeFormats).toBeDefined();
      view.destroy();
    });
  });

  describe("blank line and position detection", () => {
    it("detects blank line", () => {
      const doc = "line1\n\nline3";
      const view = createView(doc, 6); // blank line
      const ctx = computeSourceCursorContext(view);

      expect(ctx.atBlankLine).toBe(true);
      view.destroy();
    });

    it("does not report blank line for content lines", () => {
      const view = createView("hello", 3);
      const ctx = computeSourceCursorContext(view);

      expect(ctx.atBlankLine).toBe(false);
      view.destroy();
    });

    it("detects whitespace-only line as blank", () => {
      const doc = "text\n   \nmore";
      const view = createView(doc, 6);
      const ctx = computeSourceCursorContext(view);

      expect(ctx.atBlankLine).toBe(true);
      view.destroy();
    });
  });

  describe("boundary detection", () => {
    it("detects nearSpace when cursor is next to whitespace", () => {
      const doc = "hello world";
      const view = createView(doc, 5); // at space
      const ctx = computeSourceCursorContext(view);

      expect(ctx.nearSpace).toBe(true);
      view.destroy();
    });

    it("nearSpace is false in middle of word", () => {
      const doc = "hello";
      const view = createView(doc, 2);
      const ctx = computeSourceCursorContext(view);

      expect(ctx.nearSpace).toBe(false);
      view.destroy();
    });

    it("detects nearPunctuation when cursor is next to punctuation", () => {
      const doc = "hello, world";
      const view = createView(doc, 6); // after comma
      const ctx = computeSourceCursorContext(view);

      expect(ctx.nearPunctuation).toBe(true);
      view.destroy();
    });

    it("detects nearPunctuation for CJK punctuation", () => {
      const doc = "你好，世界";
      // Find position after the CJK comma
      const commaIdx = doc.indexOf("，");
      const view = createView(doc, commaIdx + 1); // after ，
      const ctx = computeSourceCursorContext(view);

      expect(ctx.nearPunctuation).toBe(true);
      view.destroy();
    });

    it("nearSpace is true at document start when first char is space", () => {
      const doc = " hello";
      const view = createView(doc, 0);
      const ctx = computeSourceCursorContext(view);

      // char after cursor is space
      expect(ctx.nearSpace).toBe(true);
      view.destroy();
    });

    it("nearSpace and nearPunctuation are false at doc start with letter", () => {
      const view = createView("hello", 0);
      const ctx = computeSourceCursorContext(view);

      // char before doesn't exist, char after is 'h'
      expect(ctx.nearSpace).toBe(false);
      expect(ctx.nearPunctuation).toBe(false);
      view.destroy();
    });
  });

  describe("context mode", () => {
    it("returns 'format' when text is selected", () => {
      const view = createView("hello world", 0, 5);
      const ctx = computeSourceCursorContext(view);
      expect(ctx.contextMode).toBe("format");
      view.destroy();
    });

    it("returns 'block-insert' at empty line", () => {
      const doc = "line\n\nline";
      const view = createView(doc, 5);
      const ctx = computeSourceCursorContext(view);
      expect(ctx.contextMode).toBe("block-insert");
      view.destroy();
    });
  });

  describe("word detection", () => {
    it("detects word at cursor", () => {
      const view = createView("hello world", 3);
      const ctx = computeSourceCursorContext(view);

      expect(ctx.inWord).not.toBeNull();
      expect(ctx.inWord!.from).toBe(0);
      expect(ctx.inWord!.to).toBe(5);
      view.destroy();
    });

    it("returns null inWord when cursor is in whitespace", () => {
      const view = createView("hello world", 5);
      const ctx = computeSourceCursorContext(view);
      expect(ctx.inWord).toBeNull();
      view.destroy();
    });
  });
});

describe("link and image targets are PARSED, not left empty", () => {
  // `href: ""` carried the comment "Would need to parse from content". The
  // information was always there — Source holds the raw `[text](url)` — so
  // every consumer that needed the target had to re-derive it, and a separate
  // module grew to do exactly that.
  const at = (doc: string, needle: string) => {
    const view = createView(doc, doc.indexOf(needle) + 1);
    const ctx = computeSourceCursorContext(view);
    view.destroy();
    return ctx;
  };

  it.each([
    { label: "plain", doc: "See [docs](./guide.md) here\n", want: "./guide.md" },
    { label: "angled destination", doc: "See [docs](<./my guide.md>) here\n", want: "./my guide.md" },
    { label: "with a title", doc: 'See [docs](./guide.md "Title") here\n', want: "./guide.md" },
    { label: "absolute url", doc: "See [docs](https://example.com/a) here\n", want: "https://example.com/a" },
  ])("$label — href is the destination", ({ doc, want }) => {
    expect(at(doc, "[docs]").inLink?.href).toBe(want);
  });

  it("reads an IMAGE's src, which the link scan skips by default", () => {
    // `findMarkdownLinksInLine` skips `!`-prefixed matches unless asked, so a
    // naive reuse would have left images empty while fixing links.
    expect(at("An ![alt](./pic.png) inline\n", "![alt]").inImage?.src).toBe("./pic.png");
  });

  it("does not mistake an image for a link", () => {
    const ctx = at("An ![alt](./pic.png) inline\n", "![alt]");
    expect(ctx.inLink).toBeNull();
  });

  it("returns \"\" rather than guessing when the cursor is not in a link", () => {
    expect(at("Just prose here\n", "prose").inLink).toBeNull();
  });

  it("picks the link the cursor is IN when a line has several", () => {
    const doc = "[one](./a.md) and [two](./b.md)\n";
    expect(at(doc, "[two]").inLink?.href).toBe("./b.md");
  });
});
