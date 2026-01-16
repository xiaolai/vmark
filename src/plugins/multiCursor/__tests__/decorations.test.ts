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

    it("creates decorations for secondary cursors only", () => {
      const state = createState("hello world");
      const doc = state.doc;
      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];
      // Primary is at index 0, so position 7 gets decoration
      const multiSel = new MultiSelection(ranges, 0);
      const tr = state.tr.setSelection(multiSel);
      const newState = state.apply(tr);

      const decorations = createMultiCursorDecorations(newState);

      // Should have 1 decoration (secondary cursor at position 7)
      const found = decorations.find();
      expect(found).toHaveLength(1);
      expect(found[0].from).toBe(7);
      expect(found[0].to).toBe(7);
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

      // Check decoration has correct class
      expect(found[0].spec.class).toContain("multi-cursor");
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
      // Primary is index 1 (pos 4), so 3 secondary decorations
      const multiSel = new MultiSelection(ranges, 1);
      const tr = state.tr.setSelection(multiSel);
      const newState = state.apply(tr);

      const decorations = createMultiCursorDecorations(newState);
      const found = decorations.find();

      // Should have 3 decorations (all except primary at pos 4)
      expect(found).toHaveLength(3);
      const positions = found.map((d) => d.from);
      expect(positions).toContain(1);
      expect(positions).toContain(7);
      expect(positions).toContain(10);
      expect(positions).not.toContain(4);
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

      // Should have selection highlight for secondary range
      expect(found.length).toBeGreaterThanOrEqual(1);
      const selectionDeco = found.find((d) => d.from === 7 && d.to === 12);
      expect(selectionDeco).toBeDefined();
    });
  });
});
