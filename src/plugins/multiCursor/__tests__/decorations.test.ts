import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, SelectionRange } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { multiCursorPlugin } from "../multiCursorPlugin";
import { MultiSelection } from "../MultiSelection";
import { createMultiCursorDecorations } from "../decorations";

// Simple schema for testing
const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

function createDoc(text: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
}

function createState(text: string) {
  return EditorState.create({
    doc: createDoc(text),
    schema,
    plugins: [multiCursorPlugin()],
  });
}

describe("decorations", () => {
  describe("createMultiCursorDecorations", () => {
    it("returns empty DecorationSet for non-MultiSelection", () => {
      const state = createState("hello world");
      const decorations = createMultiCursorDecorations(state);
      expect(decorations).toBe(DecorationSet.empty);
    });

    it("creates decorations for all cursors", () => {
      const state = createState("hello world");
      const doc = state.doc;
      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];
      // Primary is at index 0, both cursors get decorations
      const multiSel = new MultiSelection(ranges, 0);
      const tr = state.tr.setSelection(multiSel);
      const newState = state.apply(tr);

      const decorations = createMultiCursorDecorations(newState);

      // Should have 2 decorations (primary + secondary cursors)
      const found = decorations.find();
      expect(found).toHaveLength(2);
      const positions = found.map((d) => d.from);
      expect(positions).toContain(1);
      expect(positions).toContain(7);
    });

    it("creates cursor decoration with correct CSS class", () => {
      const state = createState("hello world");
      const doc = state.doc;
      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];
      const multiSel = new MultiSelection(ranges, 0);
      const tr = state.tr.setSelection(multiSel);
      const newState = state.apply(tr);

      const decorations = createMultiCursorDecorations(newState);
      const found = decorations.find();

      // Check decorations have correct class
      const classes = found.map((d) => d.spec.class);
      expect(classes.some((cls) => String(cls).includes("multi-cursor"))).toBe(true);
    });

    it("creates decorations for all secondary cursors", () => {
      const state = createState("hello world");
      const doc = state.doc;
      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(4);
      const $pos3 = doc.resolve(7);
      const $pos4 = doc.resolve(10);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
        new SelectionRange($pos3, $pos3),
        new SelectionRange($pos4, $pos4),
      ];
      // Primary is index 1 (pos 4), all cursors get decorations
      const multiSel = new MultiSelection(ranges, 1);
      const tr = state.tr.setSelection(multiSel);
      const newState = state.apply(tr);

      const decorations = createMultiCursorDecorations(newState);
      const found = decorations.find();

      // Should have 4 decorations (all cursors)
      expect(found).toHaveLength(4);
      const positions = found.map((d) => d.from);
      expect(positions).toContain(1);
      expect(positions).toContain(4);
      expect(positions).toContain(7);
      expect(positions).toContain(10);
    });

    it("creates selection highlight decorations for non-empty ranges", () => {
      const state = createState("hello world");
      const doc = state.doc;
      const $from = doc.resolve(1);
      const $to = doc.resolve(6); // "hello"

      const ranges = [new SelectionRange($from, $to)];
      const multiSel = new MultiSelection(ranges, 0);
      const tr = state.tr.setSelection(multiSel);
      const newState = state.apply(tr);

      const decorations = createMultiCursorDecorations(newState);
      const found = decorations.find();

      // Primary selection doesn't need decoration (browser handles it)
      expect(found).toHaveLength(0);
    });

    it("creates selection highlight for secondary non-empty ranges", () => {
      const state = createState("hello world");
      const doc = state.doc;
      const $pos1 = doc.resolve(1);
      const $from2 = doc.resolve(7);
      const $to2 = doc.resolve(12); // "world"

      const ranges = [
        new SelectionRange($pos1, $pos1), // cursor
        new SelectionRange($from2, $to2), // selection
      ];
      const multiSel = new MultiSelection(ranges, 0);
      const tr = state.tr.setSelection(multiSel);
      const newState = state.apply(tr);

      const decorations = createMultiCursorDecorations(newState);
      const found = decorations.find();

      // Should have selection highlight for secondary range and primary caret
      expect(found.length).toBeGreaterThanOrEqual(2);
      const selectionDeco = found.find((d) => d.from === 7 && d.to === 12);
      expect(selectionDeco).toBeDefined();
    });

    it("creates no selection decoration for primary non-empty range", () => {
      const state = createState("hello world");
      const doc = state.doc;
      // Single non-empty range as primary
      const $from = doc.resolve(1);
      const $to = doc.resolve(6);
      const $from2 = doc.resolve(7);
      const $to2 = doc.resolve(12);

      const ranges = [
        new SelectionRange($from, $to),   // primary: "hello" (non-empty)
        new SelectionRange($from2, $to2),  // secondary: "world" (non-empty)
      ];
      const multiSel = new MultiSelection(ranges, 0);
      const tr = state.tr.setSelection(multiSel);
      const newState = state.apply(tr);

      const decorations = createMultiCursorDecorations(newState);
      const found = decorations.find();

      // Primary non-empty range gets no decoration, secondary gets highlight
      // So there should be exactly 1 decoration (the secondary selection)
      expect(found).toHaveLength(1);
      expect(found[0].from).toBe(7);
      expect(found[0].to).toBe(12);
    });
  });

});
