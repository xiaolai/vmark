// @vitest-environment node
/**
 * Tests for tiptapContextHelpers
 *
 * Covers uncovered branches in detectMarksAtCursor, findMarkRange,
 * isAtLineStart, findWordAtPos, and determineContextMode.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  detectMarksAtCursor,
  findMarkRange,
  isAtLineStart,
  findWordAtPos,
  determineContextMode,
} from "./tiptapContextHelpers";
import type { CursorContext } from "@/plugins/toolbarContext/types";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block",
    },
    text: { inline: true, group: "inline" },
  },
  marks: {
    link: { attrs: { href: {} } },
    bold: {},
    italic: {},
  },
});

function createState(doc: ReturnType<typeof schema.node>) {
  return EditorState.create({ doc, schema });
}

describe("findMarkRange", () => {
  it("returns null when cursor is outside mark range (mark resets)", () => {
    // "plain " + bold("bold") + " more " + bold("bold2") + " end"
    const boldMark = schema.marks.bold.create();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("plain "),
        schema.text("bold", [boldMark]),
        schema.text(" more "),
        schema.text("bold2", [boldMark]),
        schema.text(" end"),
      ]),
    ]);
    const state = createState(doc);

    // Cursor inside "more" (between the two bold ranges) at position
    // 1 + "plain ".length + "bold".length + " mo".length = 1 + 6 + 4 + 3 = 14
    const $pos = state.doc.resolve(14);
    const result = findMarkRange($pos, schema.marks.bold);
    expect(result).toBeNull();
  });

  it("finds mark range for second bold span at end of paragraph", () => {
    const boldMark = schema.marks.bold.create();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("plain "),
        schema.text("bold", [boldMark]),
        schema.text(" gap "),
        schema.text("bold2", [boldMark]),
      ]),
    ]);
    const state = createState(doc);

    // Cursor inside second bold span: 1 + 6 + 4 + 5 + 1 = pos 17
    // "bold2" starts at 1 + 6 + 4 + 5 = 16, ends at 21
    const $pos = state.doc.resolve(17);
    const result = findMarkRange($pos, schema.marks.bold);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(16);
    expect(result!.to).toBe(21);
  });
});

describe("detectMarksAtCursor", () => {
  it("skips formatted range detection when already in a link", () => {
    // Text with both link and bold marks
    const linkMark = schema.marks.link.create({ href: "https://example.com" });
    const boldMark = schema.marks.bold.create();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("link text", [linkMark, boldMark]),
      ]),
    ]);
    const state = createState(doc);
    const $from = state.doc.resolve(3);

    const ctx: CursorContext = {
      surface: "wysiwyg",
      contextMode: "insert",
      hasSelection: false,
    };
    detectMarksAtCursor($from, ctx);

    // Should detect link but not set inFormattedRange
    expect(ctx.inLink).toBeDefined();
    expect(ctx.inFormattedRange).toBeUndefined();
  });

  it("skips formatted range when inFormattedRange already set", () => {
    const boldMark = schema.marks.bold.create();
    const italicMark = schema.marks.italic.create();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("both marks", [boldMark, italicMark]),
      ]),
    ]);
    const state = createState(doc);
    const $from = state.doc.resolve(3);

    const ctx: CursorContext = {
      surface: "wysiwyg",
      contextMode: "insert",
      hasSelection: false,
      inFormattedRange: {
        markType: "bold",
        from: 1,
        to: 11,
        contentFrom: 1,
        contentTo: 11,
      },
    };
    detectMarksAtCursor($from, ctx);

    // inFormattedRange should still be bold, not overwritten by italic
    expect(ctx.inFormattedRange?.markType).toBe("bold");
  });

  it("skips link detection when ctx.inLink is already set (line 25 false branch)", () => {
    // Two link marks in the same paragraph — first sets ctx.inLink, second is skipped
    const linkMark1 = schema.marks.link.create({ href: "https://first.com" });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("link", [linkMark1]),
        schema.text(" plain"),
      ]),
    ]);
    const state = createState(doc);
    const $from = state.doc.resolve(3); // Inside the link text

    const ctx: CursorContext = {
      surface: "wysiwyg",
      contextMode: "insert",
      hasSelection: false,
      // Pre-populate inLink to simulate it already being set
      inLink: {
        href: "https://already-set.com",
        text: "",
        from: 1,
        to: 5,
        contentFrom: 1,
        contentTo: 5,
      },
    };
    detectMarksAtCursor($from, ctx);

    // inLink should remain as the pre-set value, not be overwritten
    expect(ctx.inLink?.href).toBe("https://already-set.com");
  });

  it("uses empty string fallback when link href is falsy (line 29 false branch)", () => {
    // Create a link mark with an empty href so mark.attrs.href is falsy → falls back to ""
    const linkMark = schema.marks.link.create({ href: "" });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("link text", [linkMark]),
      ]),
    ]);
    const state = createState(doc);
    const $from = state.doc.resolve(3); // Inside the link text

    const ctx: CursorContext = {
      surface: "wysiwyg",
      contextMode: "insert",
      hasSelection: false,
    };
    detectMarksAtCursor($from, ctx);

    // inLink should be set with empty href (fallback to "")
    expect(ctx.inLink).toBeDefined();
    expect(ctx.inLink?.href).toBe("");
  });

  it("detects formatted range when cursor is in a non-link mark (lines 42-44)", () => {
    const boldMark = schema.marks.bold.create();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("bold text", [boldMark]),
        schema.text(" plain"),
      ]),
    ]);
    const state = createState(doc);
    const $from = state.doc.resolve(3); // Inside "bold text"

    const ctx: CursorContext = {
      surface: "wysiwyg",
      contextMode: "insert",
      hasSelection: false,
    };
    detectMarksAtCursor($from, ctx);

    expect(ctx.inFormattedRange).toBeDefined();
    expect(ctx.inFormattedRange?.markType).toBe("bold");
    expect(ctx.inFormattedRange?.from).toBe(1);
    expect(ctx.inFormattedRange?.to).toBe(10);
  });
});

describe("findMarkRange (found=true break path)", () => {
  it("returns range when cursor is inside mark followed by unmarked text (lines 97-98)", () => {
    const boldMark = schema.marks.bold.create();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("bold", [boldMark]),
        schema.text(" plain"),
      ]),
    ]);
    const state = createState(doc);
    // Cursor inside the bold range at pos 3 (inside "bold")
    const $pos = state.doc.resolve(3);
    const result = findMarkRange($pos, schema.marks.bold);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(1);
    expect(result!.to).toBe(5);
  });
});

describe("isAtLineStart", () => {
  it("returns false when cursor is in a heading (not paragraph)", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 1 }, [schema.text("Heading text")]),
    ]);
    const state = createState(doc);
    const $from = state.doc.resolve(1); // Start of heading
    expect(isAtLineStart($from)).toBe(false);
  });

  it("returns false for empty paragraph", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, []),
    ]);
    const state = createState(doc);
    const $from = state.doc.resolve(1);
    expect(isAtLineStart($from)).toBe(false);
  });

  it("returns true at start of non-empty paragraph", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Hello world")]),
    ]);
    const state = createState(doc);
    const $from = state.doc.resolve(1);
    expect(isAtLineStart($from)).toBe(true);
  });

  it("returns true when only whitespace before cursor", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("  hello")]),
    ]);
    const state = createState(doc);
    // Position after the whitespace: 1 + 2 = 3
    const $from = state.doc.resolve(3);
    expect(isAtLineStart($from)).toBe(true);
  });

  it("returns false when non-whitespace text before cursor", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("hello world")]),
    ]);
    const state = createState(doc);
    const $from = state.doc.resolve(4); // middle of "hello"
    expect(isAtLineStart($from)).toBe(false);
  });
});

describe("findWordAtPos", () => {
  it("returns null for empty paragraph", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, []),
    ]);
    const state = createState(doc);
    const $from = state.doc.resolve(1);
    expect(findWordAtPos($from)).toBeNull();
  });

  it("returns null when cursor is on whitespace (findWordBoundaries returns null, line 158)", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("hello   world")]),
    ]);
    const state = createState(doc);
    // Position inside the whitespace gap: 1 + 6 = 7 (first space)
    const $from = state.doc.resolve(7);
    const result = findWordAtPos($from);
    expect(result).toBeNull();
  });

  it("returns word boundaries for cursor in word", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("hello world")]),
    ]);
    const state = createState(doc);
    const $from = state.doc.resolve(3); // Inside "hello"
    const result = findWordAtPos($from);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(1);
    expect(result!.to).toBe(6);
  });
});

describe("determineContextMode", () => {
  it("returns 'insert' when selection is not empty", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("hello")]),
    ]);
    const state = createState(doc);
    const $from = state.doc.resolve(1);
    expect(determineContextMode($from, false)).toBe("insert");
  });

  it("returns 'insert-block' for empty selection at start of empty paragraph", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, []),
    ]);
    const state = createState(doc);
    const $from = state.doc.resolve(1);
    expect(determineContextMode($from, true)).toBe("insert-block");
  });

  it("returns 'insert' for empty selection in non-empty paragraph", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("hello")]),
    ]);
    const state = createState(doc);
    const $from = state.doc.resolve(3);
    expect(determineContextMode($from, true)).toBe("insert");
  });
});
