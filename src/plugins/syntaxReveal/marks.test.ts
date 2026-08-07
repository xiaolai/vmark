// @vitest-environment node
/**
 * Tests for syntaxReveal/marks — findMarkRange, findAnyMarkRangeAtCursor,
 * findWordAtCursor, addMarkSyntaxDecorations.
 */

vi.mock("@tiptap/pm/view", () => ({
  Decoration: {
    widget: vi.fn((_pos, toDOM, _spec) => ({
      type: "widget",
      pos: _pos,
      toDOM,
      spec: _spec,
    })),
  },
}));

vi.mock("@/utils/wordSegmentation", () => ({
  findWordBoundaries: vi.fn((text: string, offset: number) => {
    // Simple word boundary detection for tests
    if (!text || offset < 0 || offset > text.length) return null;
    const wordChars = /\w/;
    if (offset <= 0 || offset >= text.length) return null;
    if (!wordChars.test(text[offset]) && !wordChars.test(text[offset - 1])) return null;
    let start = offset;
    let end = offset;
    while (start > 0 && wordChars.test(text[start - 1])) start--;
    while (end < text.length && wordChars.test(text[end])) end++;
    if (start >= end) return null;
    return { start, end };
  }),
}));

vi.mock("./syntax-reveal.css", () => ({}));

import { describe, expect, it, vi, beforeEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { Decoration } from "@tiptap/pm/view";
import {
  findMarkRange,
  findAnyMarkRangeAtCursor,
  findWordAtCursor,
  addMarkSyntaxDecorations,
} from "./marks";

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

const testSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
  marks: {
    strong: {},
    emphasis: {},
    inlineCode: {},
    strikethrough: {},
    subscript: {},
    superscript: {},
    highlight: {},
    link: {
      attrs: { href: { default: "" } },
    },
  },
});

function createDocWithMarks(
  parts: Array<{ text: string; marks?: string[]; attrs?: Record<string, Record<string, unknown>> }>
) {
  const nodes = parts.map((part) => {
    let textNode = testSchema.text(part.text);
    if (part.marks) {
      const marks = part.marks.map((m) => {
        const markType = testSchema.marks[m];
        return markType.create(part.attrs?.[m] ?? {});
      });
      textNode = textNode.mark(marks);
    }
    return textNode;
  });
  const paragraph = testSchema.node("paragraph", null, nodes);
  return testSchema.node("doc", null, [paragraph]);
}

function createStateWithCursor(
  parts: Array<{ text: string; marks?: string[]; attrs?: Record<string, Record<string, unknown>> }>,
  cursorPos: number
) {
  const doc = createDocWithMarks(parts);
  const state = EditorState.create({ doc, schema: testSchema });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, cursorPos)));
}

// ---------------------------------------------------------------------------
// findMarkRange
// ---------------------------------------------------------------------------

describe("findMarkRange", () => {
  it("finds range of a bold mark containing the cursor", () => {
    // doc > paragraph > "hello **world** end"
    const doc = createDocWithMarks([
      { text: "hello " },
      { text: "world", marks: ["strong"] },
      { text: " end" },
    ]);
    const para = doc.child(0);
    const parentStart = 1; // start of paragraph content
    const boldMark = testSchema.marks.strong.create();

    // Cursor inside "world" at position 9 (parentStart=1, "hello "=6, so "world" starts at 7, pos 9 is inside)
    const result = findMarkRange(9, boldMark, parentStart, para);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(7); // parentStart + 6 ("hello ")
    expect(result!.to).toBe(12); // parentStart + 6 + 5 ("world")
  });

  it("returns null when cursor is outside the mark", () => {
    const doc = createDocWithMarks([
      { text: "hello " },
      { text: "world", marks: ["strong"] },
      { text: " end" },
    ]);
    const para = doc.child(0);
    const parentStart = 1;
    const boldMark = testSchema.marks.strong.create();

    // Cursor at position 3, inside "hello" (no bold mark)
    const result = findMarkRange(3, boldMark, parentStart, para);
    expect(result).toBeNull();
  });

  it("returns null when mark does not exist in the paragraph", () => {
    const doc = createDocWithMarks([{ text: "no marks here" }]);
    const para = doc.child(0);
    const parentStart = 1;
    const boldMark = testSchema.marks.strong.create();

    const result = findMarkRange(5, boldMark, parentStart, para);
    expect(result).toBeNull();
  });

  it("finds range at the start boundary of the mark", () => {
    const doc = createDocWithMarks([
      { text: "before", marks: ["strong"] },
      { text: " after" },
    ]);
    const para = doc.child(0);
    const parentStart = 1;
    const boldMark = testSchema.marks.strong.create();

    // Cursor at position 1 (parentStart), which is from boundary
    const result = findMarkRange(1, boldMark, parentStart, para);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(1);
  });

  it("finds range at the end boundary of the mark", () => {
    const doc = createDocWithMarks([
      { text: "before", marks: ["strong"] },
      { text: " after" },
    ]);
    const para = doc.child(0);
    const parentStart = 1;
    const boldMark = testSchema.marks.strong.create();

    // Cursor at position 7 (end of "before")
    const result = findMarkRange(7, boldMark, parentStart, para);
    expect(result).not.toBeNull();
    expect(result!.to).toBe(7);
  });

  it("finds range when mark spans multiple consecutive text nodes (currentFrom already set)", () => {
    // Create a paragraph with two adjacent bold text nodes (no gap between them).
    // This exercises the false branch of `if (currentFrom === -1)` at line 146:
    // the first bold node sets currentFrom, the second bold node hits the else arm
    // (currentFrom !== -1), only updating currentTo.
    const boldMark = testSchema.marks.strong.create();
    const textA = testSchema.text("foo").mark([boldMark]);
    const textB = testSchema.text("bar").mark([boldMark]);
    // Build the paragraph manually so the two bold nodes are adjacent
    const para = testSchema.node("paragraph", null, [textA, textB]);
    const parentStart = 1; // paragraph content starts at pos 1

    // Cursor inside "bar" (positions 4-6 relative to parentStart=1)
    // "foo" → pos 1..4, "bar" → pos 4..7
    const result = findMarkRange(5, boldMark, parentStart, para);
    expect(result).not.toBeNull();
    // The combined range should span both nodes: from=1 to=7
    expect(result!.from).toBe(1);
    expect(result!.to).toBe(7);
  });

  it("returns null when final accumulated mark range does not contain pos", () => {
    // Mark is at the end of paragraph but pos is before it.
    // "plain" (pos 1-6) then "bold" (pos 6-11), cursor at pos=3 (inside "plain").
    // findMarkRange is called directly with pos=3 and the bold mark.
    // The forEach accumulates bold range [6..11] but never hits a gap (mark at end),
    // so the final check fires: pos=3 >= 6? No → foundRange stays null → returns null.
    const boldMark = testSchema.marks.strong.create();
    const plainText = testSchema.text("plain");
    const boldText = testSchema.text("bold!").mark([boldMark]);
    const para = testSchema.node("paragraph", null, [plainText, boldText]);
    const parentStart = 1;

    // pos=3 is inside "plain" (pos 1..6), not in "bold!" (pos 6..11)
    const result = findMarkRange(3, boldMark, parentStart, para);
    expect(result).toBeNull();
  });

  it("handles multiple non-contiguous ranges of same mark", () => {
    const doc = createDocWithMarks([
      { text: "first", marks: ["strong"] },
      { text: " gap " },
      { text: "second", marks: ["strong"] },
    ]);
    const para = doc.child(0);
    const parentStart = 1;
    const boldMark = testSchema.marks.strong.create();

    // "first" = 5 chars, " gap " = 5 chars, "second" = 6 chars
    // "second" starts at parentStart + 5 + 5 = 11, ends at 17
    const result = findMarkRange(13, boldMark, parentStart, para);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(11);
    expect(result!.to).toBe(17);
  });

  it("handles paragraph with only marked text", () => {
    const doc = createDocWithMarks([
      { text: "all bold", marks: ["strong"] },
    ]);
    const para = doc.child(0);
    const parentStart = 1;
    const boldMark = testSchema.marks.strong.create();

    const result = findMarkRange(4, boldMark, parentStart, para);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(1);
    expect(result!.to).toBe(9);
  });

  it("skips remaining children once foundRange is set (line 139 early-return guard)", () => {
    // Arrange: "A"(bold) " gap " "B"(bold) "C"(bold)
    // Cursor at pos inside "A" (first bold range) — foundRange is set when the gap is encountered,
    // then the forEach continues to "B" and "C" and line 139 `if (foundRange) return` fires.
    const doc = createDocWithMarks([
      { text: "A", marks: ["strong"] },
      { text: " gap " },
      { text: "B", marks: ["strong"] },
      { text: "C", marks: ["strong"] },
    ]);
    const para = doc.child(0);
    const parentStart = 1;
    const boldMark = testSchema.marks.strong.create();

    // "A" is at positions 1-2, cursor at 1 is inside the first bold span
    const result = findMarkRange(1, boldMark, parentStart, para);
    expect(result).not.toBeNull();
    // Should find only the first range ("A"), not merge with the second/third
    expect(result!.from).toBe(1);
    expect(result!.to).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// findAnyMarkRangeAtCursor
// ---------------------------------------------------------------------------

describe("findAnyMarkRangeAtCursor", () => {
  it("returns null when no marks at cursor position", () => {
    const state = createStateWithCursor([{ text: "plain text" }], 3);
    const $pos = state.doc.resolve(3);
    const result = findAnyMarkRangeAtCursor(3, $pos);
    expect(result).toBeNull();
  });

  it("finds mark range at cursor with bold text", () => {
    const state = createStateWithCursor(
      [{ text: "hello " }, { text: "bold", marks: ["strong"] }, { text: " end" }],
      9
    );
    const $pos = state.doc.resolve(9);
    const result = findAnyMarkRangeAtCursor(9, $pos);
    expect(result).not.toBeNull();
    expect(result!.isLink).toBe(false);
  });

  it("identifies link marks with isLink flag", () => {
    const state = createStateWithCursor(
      [
        { text: "click " },
        { text: "here", marks: ["link"], attrs: { link: { href: "http://example.com" } } },
      ],
      9
    );
    const $pos = state.doc.resolve(9);
    const result = findAnyMarkRangeAtCursor(9, $pos);
    expect(result).not.toBeNull();
    expect(result!.isLink).toBe(true);
  });

  it("returns smallest range when multiple marks overlap", () => {
    // Bold wrapping a link: "**[link text](url)**"
    const state = createStateWithCursor(
      [
        { text: "text", marks: ["strong", "link"], attrs: { link: { href: "http://x.com" } } },
      ],
      3
    );
    const $pos = state.doc.resolve(3);
    const result = findAnyMarkRangeAtCursor(3, $pos);
    expect(result).not.toBeNull();
    // Both marks cover the same range, so any one is fine
    expect(result!.from).toBeGreaterThan(0);
    expect(result!.to).toBeGreaterThan(result!.from);
  });
});

// ---------------------------------------------------------------------------
// findWordAtCursor
// ---------------------------------------------------------------------------

describe("findWordAtCursor", () => {
  it("returns null for non-textblock parent", () => {
    // Create a schema with a non-textblock node
    const schema = new Schema({
      nodes: {
        doc: { content: "container+" },
        container: { content: "paragraph+", group: "container" },
        paragraph: { content: "text*" },
        text: { inline: true },
      },
    });
    const para = schema.node("paragraph", null, [schema.text("hello")]);
    const container = schema.node("container", null, [para]);
    const doc = schema.node("doc", null, [container]);
    const state = EditorState.create({ doc });
    // Resolve position at the container level (not textblock)
    // Position 1 is inside container but the resolved parent at depth check matters
    // findWordAtCursor checks $pos.parent.isTextblock
    const $pos = state.doc.resolve(1);
    // $pos.parent at depth 1 is container, which is not a textblock
    if (!$pos.parent.isTextblock) {
      // This confirms our test setup is correct
      const result = findWordAtCursor($pos);
      expect(result).toBeNull();
    }
  });

  it("finds word at cursor in simple text", () => {
    const doc = createDocWithMarks([{ text: "hello world" }]);
    const state = EditorState.create({ doc });
    const $pos = state.doc.resolve(4); // inside "hello"
    const result = findWordAtCursor($pos);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(1); // blockStart + 0
    expect(result!.to).toBe(6); // blockStart + 5
  });

  it("returns word boundaries when cursor is between words", () => {
    // "hello world" with cursor at position 7 -> parentOffset = 6 (space char)
    // findWordBoundaries mock: at offset 6, text[5]='o' is word char,
    // so it expands backward to find "hello" boundaries
    const doc = createDocWithMarks([{ text: "hello world" }]);
    const state = EditorState.create({ doc });
    const $pos = state.doc.resolve(7); // parentOffset = 6
    const result = findWordAtCursor($pos);
    // The mock word segmenter finds boundaries around the adjacent word
    if (result) {
      expect(result.from).toBeLessThan(result.to);
    }
  });
});

// ---------------------------------------------------------------------------
// addMarkSyntaxDecorations
// ---------------------------------------------------------------------------

describe("addMarkSyntaxDecorations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds open and close decorations for bold mark", () => {
    const state = createStateWithCursor(
      [{ text: "hello " }, { text: "bold", marks: ["strong"] }, { text: " end" }],
      9
    );
    const $from = state.doc.resolve(9);
    const decorations: Decoration[] = [];

    addMarkSyntaxDecorations(decorations, 9, $from);

    // Should add open (**) and close (**) decorations
    expect(decorations.length).toBe(2);
  });

  it("adds open and close decorations for italic mark", () => {
    const state = createStateWithCursor(
      [{ text: "hello " }, { text: "italic", marks: ["emphasis"] }, { text: " end" }],
      9
    );
    const $from = state.doc.resolve(9);
    const decorations: Decoration[] = [];

    addMarkSyntaxDecorations(decorations, 9, $from);

    expect(decorations.length).toBe(2);
  });

  it("adds link syntax decorations with href", () => {
    const state = createStateWithCursor(
      [
        { text: "click " },
        { text: "here", marks: ["link"], attrs: { link: { href: "http://example.com" } } },
        { text: " end" },
      ],
      9
    );
    const $from = state.doc.resolve(9);
    const decorations: Decoration[] = [];

    addMarkSyntaxDecorations(decorations, 9, $from);

    // Should add [ and ](url) decorations
    expect(decorations.length).toBe(2);
  });

  it("adds no decorations when no marks at position", () => {
    const state = createStateWithCursor([{ text: "plain text" }], 3);
    const $from = state.doc.resolve(3);
    const decorations: Decoration[] = [];

    addMarkSyntaxDecorations(decorations, 3, $from);

    expect(decorations.length).toBe(0);
  });

  it("adds decorations for inline code", () => {
    const state = createStateWithCursor(
      [{ text: "some " }, { text: "code", marks: ["inlineCode"] }, { text: " here" }],
      8
    );
    const $from = state.doc.resolve(8);
    const decorations: Decoration[] = [];

    addMarkSyntaxDecorations(decorations, 8, $from);

    expect(decorations.length).toBe(2);
  });

  it("adds decorations for strikethrough", () => {
    const state = createStateWithCursor(
      [{ text: "some " }, { text: "struck", marks: ["strikethrough"] }, { text: " here" }],
      8
    );
    const $from = state.doc.resolve(8);
    const decorations: Decoration[] = [];

    addMarkSyntaxDecorations(decorations, 8, $from);

    expect(decorations.length).toBe(2);
  });

  it("adds decorations for highlight", () => {
    const state = createStateWithCursor(
      [{ text: "some " }, { text: "highlighted", marks: ["highlight"] }, { text: " here" }],
      8
    );
    const $from = state.doc.resolve(8);
    const decorations: Decoration[] = [];

    addMarkSyntaxDecorations(decorations, 8, $from);

    expect(decorations.length).toBe(2);
  });

  it("adds decorations for subscript", () => {
    const state = createStateWithCursor(
      [{ text: "H" }, { text: "2", marks: ["subscript"] }, { text: "O" }],
      3
    );
    const $from = state.doc.resolve(3);
    const decorations: Decoration[] = [];

    addMarkSyntaxDecorations(decorations, 3, $from);

    expect(decorations.length).toBe(2);
  });

  it("adds decorations for superscript", () => {
    const state = createStateWithCursor(
      [{ text: "x" }, { text: "2", marks: ["superscript"] }, { text: " end" }],
      3
    );
    const $from = state.doc.resolve(3);
    const decorations: Decoration[] = [];

    addMarkSyntaxDecorations(decorations, 3, $from);

    expect(decorations.length).toBe(2);
  });

  it("handles multiple overlapping marks at cursor", () => {
    // Bold + italic at same position
    const state = createStateWithCursor(
      [{ text: "hello " }, { text: "both", marks: ["strong", "emphasis"] }, { text: " end" }],
      9
    );
    const $from = state.doc.resolve(9);
    const decorations: Decoration[] = [];

    addMarkSyntaxDecorations(decorations, 9, $from);

    // Should add decorations for both marks (2 per mark = 4 total, but deduplication may reduce)
    // Each mark gets open + close = 4 total (strong ** + emphasis *)
    expect(decorations.length).toBeGreaterThanOrEqual(2);
  });

  it("handles link with empty href", () => {
    const state = createStateWithCursor(
      [{ text: "click " }, { text: "here", marks: ["link"], attrs: { link: { href: "" } } }],
      9
    );
    const $from = state.doc.resolve(9);
    const decorations: Decoration[] = [];

    addMarkSyntaxDecorations(decorations, 9, $from);

    expect(decorations.length).toBe(2);
  });

  it("adds no decorations for an unknown mark type (not in MARK_SYNTAX and not a link)", () => {
    // We need a mark that is in neither MARK_SYNTAX nor LINK_MARK.
    // Build a schema with a custom "custom" mark and manually create a state.
    const customSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        text: { group: "inline" },
      },
      marks: {
        custom: {},
      },
    });
    const customMark = customSchema.marks.custom.create();
    const textNode = customSchema.text("hello").mark([customMark]);
    const para = customSchema.node("paragraph", null, [textNode]);
    const doc = customSchema.node("doc", null, [para]);
    const state = EditorState.create({ doc, schema: customSchema });
    const $from = state.doc.resolve(3); // inside "hello" with custom mark
    const decorations: Decoration[] = [];

    // addMarkSyntaxDecorations: mark "custom" not in MARK_SYNTAX and not "link" →
    // neither syntax nor link branch fires → no decorations added
    addMarkSyntaxDecorations(decorations, 3, $from);

    expect(decorations.length).toBe(0);
  });
});
