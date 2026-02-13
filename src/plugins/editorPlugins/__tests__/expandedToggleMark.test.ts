import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, SelectionRange } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { MultiSelection } from "@/plugins/multiCursor/MultiSelection";
import { multiCursorPlugin } from "@/plugins/multiCursor/multiCursorPlugin";

// Mock the syntaxReveal marks module — we test multi-cursor branch with
// non-collapsed selections, which don't call findWordAtCursor.
vi.mock("@/plugins/syntaxReveal/marks", () => ({
  findWordAtCursor: vi.fn(() => null),
  findMarkRange: vi.fn(() => null),
  findAnyMarkRangeAtCursor: vi.fn(() => null),
}));

// Lazy import after mocks are set up
const { expandedToggleMark } = await import("../expandedToggleMark");

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+", toDOM: () => ["div", 0] },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: { inline: true },
  },
  marks: {
    bold: { toDOM: () => ["strong", 0] },
  },
});

function createView(state: EditorState): EditorView {
  const container = document.createElement("div");
  return new EditorView(container, { state });
}

function createStateWithBold(
  segments: Array<{ text: string; bold?: boolean }>
) {
  const boldMark = schema.marks.bold.create();
  const nodes = segments.map((seg) =>
    seg.bold ? schema.text(seg.text, [boldMark]) : schema.text(seg.text)
  );
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, nodes),
  ]);
  return EditorState.create({ doc, schema, plugins: [multiCursorPlugin()] });
}

function applyMultiSelection(
  state: EditorState,
  ranges: Array<{ from: number; to: number }>,
  primaryIndex = 0
) {
  const doc = state.doc;
  const selRanges = ranges.map(
    (r) => new SelectionRange(doc.resolve(r.from), doc.resolve(r.to))
  );
  const multiSel = new MultiSelection(selRanges, primaryIndex);
  return state.apply(state.tr.setSelection(multiSel));
}

describe("expandedToggleMark multi-cursor", () => {
  it("adds mark to all ranges when primary has no mark", () => {
    // "hello world" — no bold anywhere
    // Selection: "hello" (1-6), "world" (7-12), primary=0
    // Primary has no bold → should ADD bold to both ranges
    const state = createStateWithBold([{ text: "hello world" }]);
    const ms = applyMultiSelection(state, [
      { from: 1, to: 6 },
      { from: 7, to: 12 },
    ]);
    const view = createView(ms);

    const handled = expandedToggleMark(view, "bold");
    expect(handled).toBe(true);

    const result = view.state;
    expect(result.doc.rangeHasMark(1, 6, schema.marks.bold)).toBe(true);
    expect(result.doc.rangeHasMark(7, 12, schema.marks.bold)).toBe(true);

    view.destroy();
  });

  it("removes mark from all ranges when primary has the mark", () => {
    // "hello world" — everything bold
    // Primary (first range) has bold → should REMOVE from all
    const state = createStateWithBold([{ text: "hello world", bold: true }]);
    const ms = applyMultiSelection(state, [
      { from: 1, to: 6 },
      { from: 7, to: 12 },
    ]);
    const view = createView(ms);

    const handled = expandedToggleMark(view, "bold");
    expect(handled).toBe(true);

    const result = view.state;
    expect(result.doc.rangeHasMark(1, 6, schema.marks.bold)).toBe(false);
    expect(result.doc.rangeHasMark(7, 12, schema.marks.bold)).toBe(false);

    view.destroy();
  });

  it("uses primary cursor to determine direction even when ranges differ", () => {
    // "hello world" — "hello" is bold, "world" is not
    // Primary=0 selects "hello" (bold) → direction is REMOVE
    const state = createStateWithBold([
      { text: "hello", bold: true },
      { text: " world" },
    ]);
    const ms = applyMultiSelection(state, [
      { from: 1, to: 6 },   // "hello" (bold)
      { from: 7, to: 12 },  // "world" (no bold)
    ]);
    const view = createView(ms);

    const handled = expandedToggleMark(view, "bold");
    expect(handled).toBe(true);

    const result = view.state;
    // Primary was bold → remove direction → neither should have bold
    expect(result.doc.rangeHasMark(1, 6, schema.marks.bold)).toBe(false);
    expect(result.doc.rangeHasMark(7, 12, schema.marks.bold)).toBe(false);

    view.destroy();
  });

  it("adds to all when primary has no mark but secondary does", () => {
    // "hello world" — "hello" is NOT bold, "world" IS bold
    // Primary=0 selects "hello" (no bold) → direction is ADD
    const state = createStateWithBold([
      { text: "hello " },
      { text: "world", bold: true },
    ]);
    const ms = applyMultiSelection(state, [
      { from: 1, to: 6 },   // "hello" (no bold)
      { from: 7, to: 12 },  // "world" (bold)
    ]);
    const view = createView(ms);

    const handled = expandedToggleMark(view, "bold");
    expect(handled).toBe(true);

    const result = view.state;
    // Primary had no bold → add direction → both should have bold
    expect(result.doc.rangeHasMark(1, 6, schema.marks.bold)).toBe(true);
    expect(result.doc.rangeHasMark(7, 12, schema.marks.bold)).toBe(true);

    view.destroy();
  });
});
