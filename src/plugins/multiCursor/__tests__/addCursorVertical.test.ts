import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection, SelectionRange } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { MultiSelection } from "../MultiSelection";
import { multiCursorPlugin } from "../multiCursorPlugin";
import { addCursorAbove, addCursorBelow } from "../commands";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+", toDOM: () => ["div", 0] as const },
    paragraph: { content: "text*", toDOM: () => ["p", 0] as const },
    text: { inline: true },
  },
});

/**
 * Create a multi-paragraph doc: each string becomes a paragraph.
 */
function createMultiParagraphDoc(lines: string[]) {
  const paragraphs = lines.map((text) =>
    schema.node("paragraph", null, text ? [schema.text(text)] : [])
  );
  return schema.node("doc", null, paragraphs);
}

function createView(state: EditorState): EditorView {
  const container = document.createElement("div");
  return new EditorView(container, { state });
}

/**
 * Mock coordsAtPos and posAtCoords on the view to simulate vertical layout.
 * We use a simple model: each character is 8px wide, each line is 20px tall.
 * Paragraph positions are tracked manually.
 */
function mockViewCoords(
  view: EditorView,
  lineStarts: number[],
  lineHeight = 20,
  charWidth = 8,
) {
  const coordsAtPos = vi.fn((pos: number) => {
    // Find which line this pos is on
    let lineIdx = 0;
    for (let i = lineStarts.length - 1; i >= 0; i--) {
      if (pos >= lineStarts[i]) {
        lineIdx = i;
        break;
      }
    }
    const col = pos - lineStarts[lineIdx];
    return {
      left: col * charWidth,
      right: (col + 1) * charWidth,
      top: lineIdx * lineHeight,
      bottom: (lineIdx + 1) * lineHeight,
    };
  });

  const posAtCoords = vi.fn((coords: { left: number; top: number }) => {
    const lineIdx = Math.floor(coords.top / lineHeight);
    if (lineIdx < 0 || lineIdx >= lineStarts.length) return null;
    const col = Math.round(coords.left / charWidth);
    const lineStart = lineStarts[lineIdx];
    // Find line end (next line start - 1, or doc end)
    const lineEnd =
      lineIdx < lineStarts.length - 1
        ? lineStarts[lineIdx + 1] - 2 // -2 for paragraph boundary
        : view.state.doc.content.size - 1;
    const pos = Math.min(lineStart + col, lineEnd);
    return { pos, inside: -1 };
  });

  // Patch the view methods
  Object.defineProperty(view, "coordsAtPos", { value: coordsAtPos });
  Object.defineProperty(view, "posAtCoords", { value: posAtCoords });

  return { coordsAtPos, posAtCoords };
}

describe("addCursorAbove", () => {
  it("adds a cursor one line above in a multi-line doc", () => {
    // Doc: line1="hello", line2="world"
    // Positions: <doc>0 <p>1 "hello" 6 </p>7 <p>8 "world" 13 </p>14
    const doc = createMultiParagraphDoc(["hello", "world"]);
    const state = EditorState.create({
      doc,
      schema,
      plugins: [multiCursorPlugin()],
      selection: TextSelection.create(doc, 10), // cursor in "world" at col 2
    });
    const view = createView(state);
    // Line starts: paragraph content starts at pos 1 and 8
    mockViewCoords(view, [1, 8]);

    const tr = addCursorAbove(state, view);
    expect(tr).not.toBeNull();
    if (tr) {
      const newState = state.apply(tr);
      const sel = newState.selection as MultiSelection;
      expect(sel.ranges).toHaveLength(2);
      // Original cursor at pos 10, new cursor somewhere in line 1
      const positions = sel.ranges.map((r) => r.$from.pos).sort((a, b) => a - b);
      expect(positions[0]).toBeLessThan(8); // in first paragraph
      expect(positions[1]).toBeGreaterThanOrEqual(8); // in second paragraph
    }
  });

  it("returns null when at the first line", () => {
    const doc = createMultiParagraphDoc(["hello", "world"]);
    const state = EditorState.create({
      doc,
      schema,
      plugins: [multiCursorPlugin()],
      selection: TextSelection.create(doc, 3), // cursor in "hello"
    });
    const view = createView(state);
    mockViewCoords(view, [1, 8]);

    const tr = addCursorAbove(state, view);
    expect(tr).toBeNull();
  });

  it("stacks cursors on multiple invocations", () => {
    // 3 lines: "aaa", "bbb", "ccc"
    // Positions: <p>1 "aaa" 4 </p>5 <p>6 "bbb" 9 </p>10 <p>11 "ccc" 14 </p>15
    const doc = createMultiParagraphDoc(["aaa", "bbb", "ccc"]);
    const state0 = EditorState.create({
      doc,
      schema,
      plugins: [multiCursorPlugin()],
      selection: TextSelection.create(doc, 12), // cursor in "ccc" at col 1
    });
    const view = createView(state0);
    mockViewCoords(view, [1, 6, 11]);

    // First addCursorAbove: cursor in line 3 + line 2
    const tr1 = addCursorAbove(state0, view);
    expect(tr1).not.toBeNull();
    const state1 = state0.apply(tr1!);
    const sel1 = state1.selection as MultiSelection;
    expect(sel1.ranges).toHaveLength(2);

    // Update view state for second invocation
    view.updateState(state1);
    // Second addCursorAbove: cursor in all 3 lines
    const tr2 = addCursorAbove(state1, view);
    expect(tr2).not.toBeNull();
    const state2 = state1.apply(tr2!);
    const sel2 = state2.selection as MultiSelection;
    expect(sel2.ranges).toHaveLength(3);
  });
});

describe("addCursorBelow", () => {
  it("adds a cursor one line below in a multi-line doc", () => {
    const doc = createMultiParagraphDoc(["hello", "world"]);
    const state = EditorState.create({
      doc,
      schema,
      plugins: [multiCursorPlugin()],
      selection: TextSelection.create(doc, 3), // cursor in "hello" at col 2
    });
    const view = createView(state);
    mockViewCoords(view, [1, 8]);

    const tr = addCursorBelow(state, view);
    expect(tr).not.toBeNull();
    if (tr) {
      const newState = state.apply(tr);
      const sel = newState.selection as MultiSelection;
      expect(sel.ranges).toHaveLength(2);
      const positions = sel.ranges.map((r) => r.$from.pos).sort((a, b) => a - b);
      expect(positions[0]).toBeLessThan(8); // in first paragraph
      expect(positions[1]).toBeGreaterThanOrEqual(8); // in second paragraph
    }
  });

  it("returns null when at the last line", () => {
    const doc = createMultiParagraphDoc(["hello", "world"]);
    const state = EditorState.create({
      doc,
      schema,
      plugins: [multiCursorPlugin()],
      selection: TextSelection.create(doc, 10), // cursor in "world"
    });
    const view = createView(state);
    mockViewCoords(view, [1, 8]);

    const tr = addCursorBelow(state, view);
    expect(tr).toBeNull();
  });

  it("stacks cursors on multiple invocations", () => {
    const doc = createMultiParagraphDoc(["aaa", "bbb", "ccc"]);
    const state0 = EditorState.create({
      doc,
      schema,
      plugins: [multiCursorPlugin()],
      selection: TextSelection.create(doc, 2), // cursor in "aaa" at col 1
    });
    const view = createView(state0);
    mockViewCoords(view, [1, 6, 11]);

    const tr1 = addCursorBelow(state0, view);
    expect(tr1).not.toBeNull();
    const state1 = state0.apply(tr1!);
    const sel1 = state1.selection as MultiSelection;
    expect(sel1.ranges).toHaveLength(2);

    view.updateState(state1);
    const tr2 = addCursorBelow(state1, view);
    expect(tr2).not.toBeNull();
    const state2 = state1.apply(tr2!);
    const sel2 = state2.selection as MultiSelection;
    expect(sel2.ranges).toHaveLength(3);
  });

  it("returns null when posAtCoords resolves to a position already occupied by an existing cursor", () => {
    // Build a MultiSelection with two cursors: pos=2 (lower) and pos=7 (higher).
    // For addCursorBelow: the bottommost cursor is pos=7.
    // Mock posAtCoords to return pos=2 (already occupied by the first cursor).
    // newPos (2) !== pos (7), but rangeExists(existingRanges, 2, 2) → true → return null.
    const doc = createMultiParagraphDoc(["aaa", "bbb"]);
    const baseState = EditorState.create({
      doc,
      schema,
      plugins: [multiCursorPlugin()],
      selection: TextSelection.create(doc, 7),
    });
    const $p2 = doc.resolve(2);
    const $p7 = doc.resolve(7);
    // normalizeRangesWithPrimary sorts ascending, so ranges end up [pos2, pos7]
    const multiSel = new MultiSelection(
      [new SelectionRange($p2, $p2), new SelectionRange($p7, $p7)],
      1 // primary is pos=7
    );
    const stateWithMulti = baseState.apply(baseState.tr.setSelection(multiSel));
    const view = createView(stateWithMulti);

    // Mock: coordsAtPos(7) returns top=20, bottom=40; posAtCoords returns pos=2 (duplicate)
    Object.defineProperty(view, "coordsAtPos", {
      value: vi.fn(() => ({ left: 8, right: 16, top: 20, bottom: 40 })),
      configurable: true,
    });
    Object.defineProperty(view, "posAtCoords", {
      value: vi.fn(() => ({ pos: 2, inside: -1 })),
      configurable: true,
    });

    const tr = addCursorBelow(stateWithMulti, view);
    // newPos=2 !== pos=7, but pos=2 already exists in existingRanges → returns null
    expect(tr).toBeNull();
    view.destroy();
  });

  it("returns null when posAtCoords resolves inside an existing non-empty selection range", () => {
    // Ranges: collapsed cursor at pos=2 (line 1) and selection [8,13] ("world", line 2).
    // addCursorBelow starts from the bottommost range ($from=8); mock posAtCoords
    // to land at pos=10, which is strictly inside the existing [8,13] selection.
    // A collapsed cursor must never be added inside a selected range.
    const doc = createMultiParagraphDoc(["hello", "world"]);
    const baseState = EditorState.create({
      doc,
      schema,
      plugins: [multiCursorPlugin()],
      selection: TextSelection.create(doc, 2),
    });
    const $p2 = doc.resolve(2);
    const $selFrom = doc.resolve(8);
    const $selTo = doc.resolve(13);
    const multiSel = new MultiSelection(
      [new SelectionRange($p2, $p2), new SelectionRange($selFrom, $selTo)],
      1 // primary is the [8,13] selection
    );
    const stateWithMulti = baseState.apply(baseState.tr.setSelection(multiSel));
    const view = createView(stateWithMulti);

    Object.defineProperty(view, "coordsAtPos", {
      value: vi.fn(() => ({ left: 0, right: 8, top: 20, bottom: 40 })),
      configurable: true,
    });
    Object.defineProperty(view, "posAtCoords", {
      value: vi.fn(() => ({ pos: 10, inside: -1 })),
      configurable: true,
    });

    const tr = addCursorBelow(stateWithMulti, view);
    expect(tr).toBeNull();
    view.destroy();
  });
});
