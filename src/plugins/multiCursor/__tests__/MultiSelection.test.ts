import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Selection, SelectionRange } from "@tiptap/pm/state";
import { MultiSelection } from "../MultiSelection";

// Simple schema for testing
const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

function createDoc(text: string) {
  return schema.node("doc", null, [schema.node("paragraph", null, text ? [schema.text(text)] : [])]);
}

function createState(text: string) {
  return EditorState.create({ doc: createDoc(text), schema });
}

describe("MultiSelection", () => {
  describe("constructor", () => {
    it("creates selection with multiple ranges", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];

      const multiSel = new MultiSelection(ranges, 0);

      expect(multiSel.ranges).toHaveLength(2);
      expect(multiSel.primaryIndex).toBe(0);
    });

    it("sets primary range as anchor/head for compatibility", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];

      const multiSel = new MultiSelection(ranges, 1);

      // Primary is at index 1 ($pos2)
      expect(multiSel.$anchor.pos).toBe(7);
      expect(multiSel.$head.pos).toBe(7);
    });

    it("handles selection ranges (not just cursors)", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $from = doc.resolve(1);
      const $to = doc.resolve(6); // "hello"

      const ranges = [new SelectionRange($from, $to)];
      const multiSel = new MultiSelection(ranges, 0);

      expect(multiSel.from).toBe(1);
      expect(multiSel.to).toBe(6);
    });
  });

  describe("eq", () => {
    it("returns true for equal selections", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];

      const sel1 = new MultiSelection(ranges, 0);
      const sel2 = new MultiSelection(ranges, 0);

      expect(sel1.eq(sel2)).toBe(true);
    });

    it("returns false for different number of ranges", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const sel1 = new MultiSelection([new SelectionRange($pos1, $pos1)], 0);
      const sel2 = new MultiSelection([
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ], 0);

      expect(sel1.eq(sel2)).toBe(false);
    });

    it("returns false for different positions", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(2);

      const sel1 = new MultiSelection([new SelectionRange($pos1, $pos1)], 0);
      const sel2 = new MultiSelection([new SelectionRange($pos2, $pos2)], 0);

      expect(sel1.eq(sel2)).toBe(false);
    });

    it("returns false for non-MultiSelection", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $pos = doc.resolve(1);
      const multiSel = new MultiSelection([new SelectionRange($pos, $pos)], 0);

      expect(multiSel.eq(Selection.near(doc.resolve(1)))).toBe(false);
    });
  });

  describe("map", () => {
    it("maps positions through insertions before ranges", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $pos1 = doc.resolve(7); // "w" in "world"
      const ranges = [new SelectionRange($pos1, $pos1)];
      const multiSel = new MultiSelection(ranges, 0);

      // Insert "XX" at position 1 (before cursor)
      const tr = state.tr.insertText("XX", 1, 1);
      const mapped = multiSel.map(tr.doc, tr.mapping);

      expect(mapped).toBeInstanceOf(MultiSelection);
      // Position should shift by 2 (length of "XX")
      expect((mapped as MultiSelection).ranges[0].$to.pos).toBe(9);
    });

    it("maps multiple ranges correctly", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];
      const multiSel = new MultiSelection(ranges, 0);

      // Insert at position 4
      const tr = state.tr.insertText("XX", 4, 4);
      const mapped = multiSel.map(tr.doc, tr.mapping) as MultiSelection;

      // First cursor (pos 1) should stay at 1
      expect(mapped.ranges[0].$to.pos).toBe(1);
      // Second cursor (pos 7) should shift to 9
      expect(mapped.ranges[1].$to.pos).toBe(9);
    });

    it("preserves primaryIndex through mapping", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];
      const multiSel = new MultiSelection(ranges, 1);

      const tr = state.tr.insertText("XX", 4, 4);
      const mapped = multiSel.map(tr.doc, tr.mapping) as MultiSelection;

      expect(mapped.primaryIndex).toBe(1);
    });
  });

  describe("toJSON / fromJSON", () => {
    it("serializes and deserializes correctly", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];
      const original = new MultiSelection(ranges, 1);

      const json = original.toJSON();
      const restored = MultiSelection.fromJSON(doc, json);

      expect(restored.eq(original)).toBe(true);
      expect(restored.primaryIndex).toBe(1);
    });

    it("handles selection ranges in serialization", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $from = doc.resolve(1);
      const $to = doc.resolve(6);

      const ranges = [new SelectionRange($from, $to)];
      const original = new MultiSelection(ranges, 0);

      const json = original.toJSON();
      const restored = MultiSelection.fromJSON(doc, json);

      expect(restored.ranges[0].$from.pos).toBe(1);
      expect(restored.ranges[0].$to.pos).toBe(6);
    });
  });

  describe("allRanges", () => {
    it("returns all ranges for iteration", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);
      const $pos3 = doc.resolve(10);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
        new SelectionRange($pos3, $pos3),
      ];
      const multiSel = new MultiSelection(ranges, 0);

      expect(multiSel.allRanges).toHaveLength(3);
      expect(multiSel.allRanges).toBe(multiSel.ranges);
    });
  });

  describe("edge cases", () => {
    it("handles single range (degenerates to regular selection behavior)", () => {
      const state = createState("hello");
      const doc = state.doc;

      const $pos = doc.resolve(3);
      const ranges = [new SelectionRange($pos, $pos)];
      const multiSel = new MultiSelection(ranges, 0);

      expect(multiSel.ranges).toHaveLength(1);
      expect(multiSel.$anchor.pos).toBe(3);
      expect(multiSel.$head.pos).toBe(3);
    });

    it("handles empty document positions", () => {
      const state = createState("");
      const doc = state.doc;

      const $pos = doc.resolve(1); // Position after opening paragraph tag
      const ranges = [new SelectionRange($pos, $pos)];
      const multiSel = new MultiSelection(ranges, 0);

      expect(multiSel.ranges).toHaveLength(1);
    });
  });
});
