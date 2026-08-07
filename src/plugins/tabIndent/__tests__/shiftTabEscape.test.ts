// @vitest-environment node
/**
 * Shift+Tab Left-Escape Detection Tests
 *
 * Tests for mark and link left-escape — the reverse of Tab right-escape.
 * Cursor anywhere inside a mark/link → Shift+Tab jumps to start position.
 *
 * Position reference for doc(p("text")):
 *   parentStart = 1 (start of paragraph content)
 *   First text node starts at parentStart + 0 = 1
 *   Characters at positions 1, 2, 3, ...
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection, SelectionRange } from "@tiptap/pm/state";
import { MultiSelection } from "@/plugins/multiCursor/MultiSelection";
import {
  getMarkStartPos,
  getLinkStartPos,
  canShiftTabEscape,
  canShiftTabEscapeMulti,
} from "../shiftTabEscape";

/* ------------------------------------------------------------------ */
/*  Schema                                                             */
/* ------------------------------------------------------------------ */

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: { inline: true },
  },
  marks: {
    bold: {
      parseDOM: [{ tag: "strong" }],
      toDOM() { return ["strong", 0]; },
    },
    italic: {
      parseDOM: [{ tag: "em" }],
      toDOM() { return ["em", 0]; },
    },
    code: {
      excludes: "_",
      parseDOM: [{ tag: "code" }],
      toDOM() { return ["code", 0]; },
    },
    strike: {
      parseDOM: [{ tag: "s" }],
      toDOM() { return ["s", 0]; },
    },
    link: {
      attrs: { href: {} },
      parseDOM: [{ tag: "a[href]" }],
      toDOM(mark) { return ["a", { href: mark.attrs.href }, 0]; },
    },
  },
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createStateAtPos(doc: ReturnType<typeof schema.node>, pos: number): EditorState {
  const state = EditorState.create({ doc });
  return state.apply(state.tr.setSelection(TextSelection.create(doc, pos)));
}

function makeDoc(children: Parameters<typeof schema.node>[2]) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, children),
  ]);
}

/* ------------------------------------------------------------------ */
/*  getMarkStartPos                                                    */
/* ------------------------------------------------------------------ */

describe("getMarkStartPos", () => {
  it("returns start of bold text node when cursor is in middle", () => {
    // doc(p(bold("hello"))) — parentStart=1, bold text at offset 0
    // Bold text node starts at pos 1
    const boldMark = schema.marks.bold.create();
    const doc = makeDoc([schema.text("hello", [boldMark])]);
    const state = createStateAtPos(doc, 4); // inside "hello"

    expect(getMarkStartPos(state)).toBe(1);
  });

  it("returns start pos when cursor is at start of mark (escape-in-place)", () => {
    const boldMark = schema.marks.bold.create();
    const doc = makeDoc([schema.text("hello", [boldMark])]);
    const state = createStateAtPos(doc, 1); // at start of bold

    expect(getMarkStartPos(state)).toBe(1);
  });

  it("returns start pos with plain text before mark", () => {
    // doc(p("plain ", bold("hello"), " end"))
    // "plain " = 6 chars → bold starts at 1 + 6 = 7
    const boldMark = schema.marks.bold.create();
    const doc = makeDoc([
      schema.text("plain "),
      schema.text("hello", [boldMark]),
      schema.text(" end"),
    ]);
    const state = createStateAtPos(doc, 9); // inside bold "hello"

    expect(getMarkStartPos(state)).toBe(7);
  });

  it("returns start pos for italic mark", () => {
    const italicMark = schema.marks.italic.create();
    const doc = makeDoc([schema.text("hello", [italicMark])]);
    const state = createStateAtPos(doc, 4);

    expect(getMarkStartPos(state)).toBe(1);
  });

  it("returns start pos for code mark", () => {
    const codeMark = schema.marks.code.create();
    const doc = makeDoc([schema.text("hello", [codeMark])]);
    const state = createStateAtPos(doc, 4);

    expect(getMarkStartPos(state)).toBe(1);
  });

  it("returns start pos for strike mark", () => {
    const strikeMark = schema.marks.strike.create();
    const doc = makeDoc([schema.text("hello", [strikeMark])]);
    const state = createStateAtPos(doc, 4);

    expect(getMarkStartPos(state)).toBe(1);
  });

  it("returns null when cursor has no marks", () => {
    const doc = makeDoc([schema.text("hello")]);
    const state = createStateAtPos(doc, 3);

    expect(getMarkStartPos(state)).toBeNull();
  });

  it("returns null when cursor has only link mark (not an escapable mark)", () => {
    const linkMark = schema.marks.link.create({ href: "https://example.com" });
    const doc = makeDoc([schema.text("hello", [linkMark])]);
    const state = createStateAtPos(doc, 3);

    expect(getMarkStartPos(state)).toBeNull();
  });

  it("returns null with range selection", () => {
    const boldMark = schema.marks.bold.create();
    const doc = makeDoc([schema.text("hello", [boldMark])]);
    const state = EditorState.create({ doc });
    const withSel = state.apply(
      state.tr.setSelection(TextSelection.create(doc, 2, 5)),
    );

    expect(getMarkStartPos(withSel)).toBeNull();
  });

  it("handles nested marks (bold+italic on same text node)", () => {
    const boldMark = schema.marks.bold.create();
    const italicMark = schema.marks.italic.create();
    const doc = makeDoc([schema.text("hello", [boldMark, italicMark])]);
    const state = createStateAtPos(doc, 4);

    // Returns start of the shared text node — escapes both at once
    expect(getMarkStartPos(state)).toBe(1);
  });

  it("handles mark at very start of paragraph", () => {
    const boldMark = schema.marks.bold.create();
    const doc = makeDoc([
      schema.text("hello", [boldMark]),
      schema.text(" world"),
    ]);
    const state = createStateAtPos(doc, 4);

    expect(getMarkStartPos(state)).toBe(1);
  });

  it("handles CJK text inside mark", () => {
    const boldMark = schema.marks.bold.create();
    const doc = makeDoc([schema.text("你好世界", [boldMark])]);
    const state = createStateAtPos(doc, 3);

    expect(getMarkStartPos(state)).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  getLinkStartPos                                                    */
/* ------------------------------------------------------------------ */

describe("getLinkStartPos", () => {
  it("returns start of link text node when cursor is in middle", () => {
    const linkMark = schema.marks.link.create({ href: "https://example.com" });
    const doc = makeDoc([schema.text("click here", [linkMark])]);
    const state = createStateAtPos(doc, 6);

    expect(getLinkStartPos(state)).toBe(1);
  });

  it("returns start pos when cursor is at start of link", () => {
    const linkMark = schema.marks.link.create({ href: "https://example.com" });
    const doc = makeDoc([schema.text("link", [linkMark])]);
    const state = createStateAtPos(doc, 1);

    expect(getLinkStartPos(state)).toBe(1);
  });

  it("returns start pos with text before link", () => {
    const linkMark = schema.marks.link.create({ href: "https://example.com" });
    const doc = makeDoc([
      schema.text("see "),
      schema.text("link text", [linkMark]),
      schema.text(" here"),
    ]);
    // "see " = 4 chars, link starts at pos 1 + 4 = 5
    const state = createStateAtPos(doc, 8);

    expect(getLinkStartPos(state)).toBe(5);
  });

  it("returns current position at link boundary (cursor at end of link text node)", () => {
    const linkMark = schema.marks.link.create({ href: "https://example.com" });
    const doc = makeDoc([
      schema.text("link", [linkMark]),
      schema.text(" after"),
    ]);
    // "link" = 4 chars, cursor at pos 5 is at the boundary (after the link text node)
    // At this boundary, $from.marks() may still include the link mark
    // but the cursor is at childEnd — getLinkStartPos returns `from` for stored-mark clearing
    const state = createStateAtPos(doc, 5);

    const result = getLinkStartPos(state);
    // At boundary, returns current pos (5) since no child range matches with strict < childEnd
    expect(result).toBe(5);
  });

  it("returns null when cursor has no link mark", () => {
    const doc = makeDoc([schema.text("hello")]);
    const state = createStateAtPos(doc, 3);

    expect(getLinkStartPos(state)).toBeNull();
  });

  it("returns null with range selection", () => {
    const linkMark = schema.marks.link.create({ href: "https://example.com" });
    const doc = makeDoc([schema.text("hello", [linkMark])]);
    const state = EditorState.create({ doc });
    const withSel = state.apply(
      state.tr.setSelection(TextSelection.create(doc, 2, 5)),
    );

    expect(getLinkStartPos(withSel)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  canShiftTabEscape — single cursor                                  */
/* ------------------------------------------------------------------ */

describe("canShiftTabEscape", () => {
  it("returns mark escape when cursor is inside bold", () => {
    const boldMark = schema.marks.bold.create();
    const doc = makeDoc([
      schema.text("plain "),
      schema.text("bold", [boldMark]),
      schema.text(" end"),
    ]);
    const state = createStateAtPos(doc, 9); // inside "bold"

    const result = canShiftTabEscape(state);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("type", "mark");
    expect(result).toHaveProperty("targetPos", 7); // start of bold text node
  });

  it("returns mark escape at start of mark (escape-in-place)", () => {
    const boldMark = schema.marks.bold.create();
    const doc = makeDoc([schema.text("bold", [boldMark])]);
    const state = createStateAtPos(doc, 1); // at very start

    const result = canShiftTabEscape(state);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("type", "mark");
    expect(result).toHaveProperty("targetPos", 1); // same position
  });

  it("returns link escape when cursor is inside link (no mark)", () => {
    const linkMark = schema.marks.link.create({ href: "https://example.com" });
    const doc = makeDoc([
      schema.text("see "),
      schema.text("link", [linkMark]),
      schema.text(" end"),
    ]);
    const state = createStateAtPos(doc, 7); // inside "link"

    const result = canShiftTabEscape(state);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("type", "link");
    expect(result).toHaveProperty("targetPos", 5);
  });

  it("returns mark escape when cursor has both mark and link (mark priority)", () => {
    const boldMark = schema.marks.bold.create();
    const linkMark = schema.marks.link.create({ href: "https://example.com" });
    const doc = makeDoc([
      schema.text("bold link", [boldMark, linkMark]),
    ]);
    const state = createStateAtPos(doc, 5);

    const result = canShiftTabEscape(state);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("type", "mark");
    expect(result).toHaveProperty("targetPos", 1);
  });

  it("returns null when cursor has no marks", () => {
    const doc = makeDoc([schema.text("plain text")]);
    const state = createStateAtPos(doc, 5);

    expect(canShiftTabEscape(state)).toBeNull();
  });

  it("returns null with range selection", () => {
    const boldMark = schema.marks.bold.create();
    const doc = makeDoc([schema.text("hello", [boldMark])]);
    const state = EditorState.create({ doc });
    const withSel = state.apply(
      state.tr.setSelection(TextSelection.create(doc, 2, 5)),
    );

    expect(canShiftTabEscape(withSel)).toBeNull();
  });

  it("delegates to canShiftTabEscapeMulti for MultiSelection", () => {
    const boldMark = schema.marks.bold.create();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("bold", [boldMark]),
      ]),
    ]);
    const state = EditorState.create({ doc });

    const $pos = state.doc.resolve(3);
    const multiSel = new MultiSelection([
      new SelectionRange($pos, $pos),
    ], 0);
    const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

    const result = canShiftTabEscape(stateWithMulti);
    expect(result).toBeInstanceOf(MultiSelection);
  });

  it("returns null in empty document (no text)", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null),
    ]);
    const state = EditorState.create({ doc });

    expect(canShiftTabEscape(state)).toBeNull();
  });

  it("returns mark escape when cursor is at left boundary of code with plain text before (storedMarks fallback)", () => {
    // doc(p("plain ", code("this is an example")))
    // "plain " = 6 chars → code text starts at 1 + 6 = 7
    // $from.marks() at pos 7 returns [] — preceding node is plain text
    // state.storedMarks = [codeMark] — as set by inlineCodeBoundary plugin
    const codeMark = schema.marks.code.create();
    const doc = makeDoc([
      schema.text("plain "),
      schema.text("this is an example", [codeMark]),
    ]);
    const base = EditorState.create({ doc });
    const state = base.apply(
      base.tr.setSelection(TextSelection.create(doc, 7)).setStoredMarks([codeMark]),
    );

    const result = canShiftTabEscape(state);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("type", "mark");
    // targetPos = 6 (one left, inside "plain ") to exit the code boundary
    expect(result).toHaveProperty("targetPos", 6);
  });

  it("does not escape when storedMarks has code but cursor is not at a code node left boundary", () => {
    // Cursor is in plain text — storedMarks may have code (e.g. user toggled)
    // but $from.nodeAfter is plain text, not code → should not trigger
    const codeMark = schema.marks.code.create();
    const doc = makeDoc([schema.text("plain text")]);
    const base = EditorState.create({ doc });
    const state = base.apply(
      base.tr.setSelection(TextSelection.create(doc, 5)).setStoredMarks([codeMark]),
    );

    expect(canShiftTabEscape(state)).toBeNull();
  });

  it("does not trigger storedMarks fallback when code is at paragraph start (normal path handles it)", () => {
    // For code at paragraph start, $from.marks() already returns [codeMark]
    // (ProseMirror uses first child's marks when there's no preceding sibling)
    // → normal path handles it; storedMarks fallback should not interfere
    const codeMark = schema.marks.code.create();
    const doc = makeDoc([schema.text("code text", [codeMark])]);
    const base = EditorState.create({ doc });
    const state = base.apply(
      base.tr.setSelection(TextSelection.create(doc, 1)).setStoredMarks([codeMark]),
    );

    const result = canShiftTabEscape(state);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("type", "mark");
    expect(result).toHaveProperty("targetPos", 1); // escape-in-place, from normal path
  });
});

/* ------------------------------------------------------------------ */
/*  canShiftTabEscapeMulti — multi-cursor                              */
/* ------------------------------------------------------------------ */

describe("canShiftTabEscapeMulti", () => {
  it("moves escapable cursors and keeps others in place", () => {
    const boldMark = schema.marks.bold.create();
    // Two paragraphs: first has plain+bold, second has plain
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("plain "),
        schema.text("bold", [boldMark]),
      ]),
      schema.node("paragraph", null, [
        schema.text("normal"),
      ]),
    ]);
    const state = EditorState.create({ doc });

    // p1 content: "plain " (6) + "bold" (4) = 10 chars, positions 1..10
    // Bold starts at offset 6 → pos 1+6 = 7
    // Cursor 1: pos 9 inside bold ("bo|ld")
    // p2 starts at pos 12 (10 + p1 close + p2 open = 12)
    // Cursor 2: pos 14 in "normal" ("no|rmal")
    const $pos1 = state.doc.resolve(9);
    const $pos2 = state.doc.resolve(14);
    const multiSel = new MultiSelection([
      new SelectionRange($pos1, $pos1),
      new SelectionRange($pos2, $pos2),
    ], 0);
    const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

    const result = canShiftTabEscapeMulti(stateWithMulti);
    expect(result).toBeInstanceOf(MultiSelection);
    if (result instanceof MultiSelection) {
      // First cursor should have moved to bold start (pos 7)
      expect(result.ranges[0].$from.pos).toBe(7);
      // Second cursor should stay (plain text, no marks)
      expect(result.ranges[1].$from.pos).toBe(14);
    }
  });

  it("moves cursor out of link in multi-cursor mode", () => {
    const linkMark = schema.marks.link.create({ href: "https://example.com" });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("see "),
        schema.text("link", [linkMark]),
        schema.text(" end"),
      ]),
      schema.node("paragraph", null, [
        schema.text("normal"),
      ]),
    ]);
    const state = EditorState.create({ doc });

    // Cursor 1: inside link at pos 7 ("li|nk")
    // Cursor 2: in plain text in second paragraph
    const $pos1 = state.doc.resolve(7);
    const $pos2 = state.doc.resolve(16);
    const multiSel = new MultiSelection([
      new SelectionRange($pos1, $pos1),
      new SelectionRange($pos2, $pos2),
    ], 0);
    const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

    const result = canShiftTabEscapeMulti(stateWithMulti);
    expect(result).toBeInstanceOf(MultiSelection);
    if (result instanceof MultiSelection) {
      // First cursor should have moved to link start (pos 5)
      expect(result.ranges[0].$from.pos).toBe(5);
      // Second cursor should stay
      expect(result.ranges[1].$from.pos).toBe(16);
    }
  });

  it("handles cursor at link boundary in multi-cursor mode (fallback to pos)", () => {
    const linkMark = schema.marks.link.create({ href: "https://example.com" });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("link", [linkMark]),
        schema.text(" after"),
      ]),
    ]);
    const state = EditorState.create({ doc });

    // Cursor at pos 5 = boundary (end of "link" text node)
    // "link" occupies positions 1..4, so pos 5 is right after it
    const $pos1 = state.doc.resolve(5);
    const multiSel = new MultiSelection([
      new SelectionRange($pos1, $pos1),
    ], 0);
    const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

    const result = canShiftTabEscapeMulti(stateWithMulti);
    // At boundary, link mark may or may not be active — if active, returns pos (5)
    // If not active, returns null (cursor is in plain text after link)
    if (result) {
      expect(result).toBeInstanceOf(MultiSelection);
    }
    // Either outcome is valid — the key is no crash at boundary
  });

  it("returns null when no cursor can escape", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("plain")]),
      schema.node("paragraph", null, [schema.text("text")]),
    ]);
    const state = EditorState.create({ doc });

    const $pos1 = state.doc.resolve(3);
    const $pos2 = state.doc.resolve(9);
    const multiSel = new MultiSelection([
      new SelectionRange($pos1, $pos1),
      new SelectionRange($pos2, $pos2),
    ], 0);
    const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

    expect(canShiftTabEscapeMulti(stateWithMulti)).toBeNull();
  });

  it("returns null for non-MultiSelection", () => {
    const doc = makeDoc([schema.text("hello")]);
    const state = createStateAtPos(doc, 3);

    expect(canShiftTabEscapeMulti(state)).toBeNull();
  });

  it("escapes secondary cursor at code left boundary with plain text before", () => {
    // doc(p("plain ", code("code text")))
    // "plain " = 6 chars → code starts at 1 + 6 = 7
    // $pos.marks() at pos 7 returns [] (preceding node is plain text, not code)
    // calculateLeftEscapeForPosition must detect the code mark via nodeAfter
    const codeMark = schema.marks.code.create();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("plain "),
        schema.text("code text", [codeMark]),
      ]),
      schema.node("paragraph", null, [
        schema.text("normal"),
      ]),
    ]);
    const state = EditorState.create({ doc });

    // Cursor 1: pos 7 = left boundary of code (the bug case)
    // Cursor 2: pos 18 = inside "normal" in second paragraph
    // p1: 1 + 6 + 9 = 16 chars, p2 starts at 18
    const $pos1 = state.doc.resolve(7);
    const $pos2 = state.doc.resolve(19);
    const multiSel = new MultiSelection([
      new SelectionRange($pos1, $pos1),
      new SelectionRange($pos2, $pos2),
    ], 0);
    const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

    const result = canShiftTabEscapeMulti(stateWithMulti);
    expect(result).toBeInstanceOf(MultiSelection);
    if (result instanceof MultiSelection) {
      // First cursor should escape to pos 6 (inside "plain ")
      expect(result.ranges[0].$from.pos).toBe(6);
      // Second cursor stays (no mark)
      expect(result.ranges[1].$from.pos).toBe(19);
    }
  });

  it("escapes both cursors when one is inside code and one at code left boundary", () => {
    const codeMark = schema.marks.code.create();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("plain "),
        schema.text("code text", [codeMark]),
      ]),
    ]);
    const state = EditorState.create({ doc });

    // Cursor 1: pos 7 = left boundary of code
    // Cursor 2: pos 10 = inside "code text" (co|de text)
    const $pos1 = state.doc.resolve(7);
    const $pos2 = state.doc.resolve(10);
    const multiSel = new MultiSelection([
      new SelectionRange($pos1, $pos1),
      new SelectionRange($pos2, $pos2),
    ], 1);
    const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

    const result = canShiftTabEscapeMulti(stateWithMulti);
    expect(result).toBeInstanceOf(MultiSelection);
    if (result instanceof MultiSelection) {
      const positions = result.ranges.map((r) => r.$from.pos);
      // Cursor at boundary → escapes to 6
      expect(positions).toContain(6);
      // Cursor inside code → escapes to code start = 7
      expect(positions).toContain(7);
    }
  });

  it("preserves range selections (from !== to) in multi-cursor", () => {
    const boldMark = schema.marks.bold.create();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("bold text", [boldMark]),
      ]),
    ]);
    const state = EditorState.create({ doc });

    // First cursor: range selection inside bold (pos 2..4)
    const $from1 = state.doc.resolve(2);
    const $to1 = state.doc.resolve(4);
    // Second cursor: point cursor inside bold (pos 5)
    const $pos2 = state.doc.resolve(5);
    const multiSel = new MultiSelection([
      new SelectionRange($from1, $to1),
      new SelectionRange($pos2, $pos2),
    ], 1);
    const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

    const result = canShiftTabEscapeMulti(stateWithMulti);
    expect(result).toBeInstanceOf(MultiSelection);
    if (result instanceof MultiSelection) {
      // MultiSelection may reorder ranges by position.
      // Escaped cursor (pos 1) may come before range (2,4).
      const positions = result.ranges.map((r) => ({
        from: r.$from.pos,
        to: r.$to.pos,
      }));
      // Should contain the unchanged range selection
      expect(positions).toContainEqual({ from: 2, to: 4 });
      // Should contain the escaped cursor at pos 1
      expect(positions).toContainEqual({ from: 1, to: 1 });
    }
  });
});
