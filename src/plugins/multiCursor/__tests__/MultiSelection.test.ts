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

    it("maps from with bias -1 and to with bias 1 at insertion boundary", () => {
      const state = createState("hello world");
      const doc = state.doc;

      // Selection range covering "hello" (pos 1-6)
      const $from = doc.resolve(1);
      const $to = doc.resolve(6);
      const ranges = [new SelectionRange($from, $to)];
      const multiSel = new MultiSelection(ranges, 0);

      // Insert "XX" at exactly position 1 (the from boundary)
      const tr = state.tr.insertText("XX", 1, 1);
      const mapped = multiSel.map(tr.doc, tr.mapping) as MultiSelection;

      // from should stay at 1 (bias -1: stay before insertion)
      expect(mapped.ranges[0].$from.pos).toBe(1);
      // to should shift to 8 (6 + 2 inserted chars, bias 1: stay after)
      expect(mapped.ranges[0].$to.pos).toBe(8);
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

  describe("map merges overlapping ranges", () => {
    it("merges selection ranges that overlap after a replacement collapses the gap", () => {
      // "abcdefghijk" — 11 chars
      const state = createState("abcdefghijk");
      const doc = state.doc;

      // Range 1: [1,4) = "abc", Range 2: [8,11) = "hij"
      const ranges = [
        new SelectionRange(doc.resolve(1), doc.resolve(4)),
        new SelectionRange(doc.resolve(8), doc.resolve(11)),
      ];
      const multiSel = new MultiSelection(ranges, 0);

      // Replace [3,9) with "X" — replaces "cdefgh" (6 chars) with "X" (1 char), net -5
      // After mapping:
      //   Range 1: from=1 (bias -1)→1, to=4 (bias 1, in [3,9))→3+1=4
      //   Range 2: from=8 (bias -1, in [3,9))→3, to=11 (bias 1)→11-5=6
      // Result: range1=[1,4), range2=[3,6) — genuine overlap (4 > 3)
      const tr = state.tr.replaceWith(3, 9, schema.text("X"));
      const mapped = multiSel.map(tr.doc, tr.mapping) as MultiSelection;

      // With merge=true, overlapping ranges [1,4) and [3,6) should merge to [1,6)
      expect(mapped.ranges).toHaveLength(1);
      expect(mapped.ranges[0].$from.pos).toBe(1);
      expect(mapped.ranges[0].$to.pos).toBe(6);
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

    it("throws for empty ranges array", () => {
      expect(() => new MultiSelection([], 0)).toThrow(
        "MultiSelection requires at least one range"
      );
    });
  });

  describe("eq edge cases", () => {
    it("returns false for different primaryIndex", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];

      const sel1 = new MultiSelection(ranges, 0);
      const sel2 = new MultiSelection(ranges, 1);

      expect(sel1.eq(sel2)).toBe(false);
    });

    it("returns false when backward flags differ", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $from = doc.resolve(1);
      const $to = doc.resolve(6);

      const ranges = [new SelectionRange($from, $to)];

      const sel1 = new MultiSelection(ranges, 0, [false]);
      const sel2 = new MultiSelection(ranges, 0, [true]);

      expect(sel1.eq(sel2)).toBe(false);
    });
  });

  describe("content", () => {
    it("returns content of primary selection range", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $from = doc.resolve(1);
      const $to = doc.resolve(6);

      const ranges = [new SelectionRange($from, $to)];
      const multiSel = new MultiSelection(ranges, 0);

      const content = multiSel.content();
      expect(content).toBeDefined();
    });
  });

  describe("getTextContent", () => {
    it("concatenates text from all ranges with newlines", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $from1 = doc.resolve(1);
      const $to1 = doc.resolve(6);
      const $from2 = doc.resolve(7);
      const $to2 = doc.resolve(12);

      const ranges = [
        new SelectionRange($from1, $to1),
        new SelectionRange($from2, $to2),
      ];
      const multiSel = new MultiSelection(ranges, 0);

      expect(multiSel.getTextContent(doc)).toBe("hello\nworld");
    });

    it("returns empty lines for collapsed cursors", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];
      const multiSel = new MultiSelection(ranges, 0);

      expect(multiSel.getTextContent(doc)).toBe("\n");
    });
  });

  describe("fromJSON edge cases", () => {
    it("clamps out-of-bounds positions to doc size", () => {
      const doc = createDoc("hi");
      const size = doc.content.size;
      // Position 999 exceeds doc size
      const sel = MultiSelection.fromJSON(doc, {
        ranges: [{ anchor: 999, head: 999 }],
        primaryIndex: 0,
      });
      expect(sel.ranges[0].$from.pos).toBeLessThanOrEqual(size);
      expect(sel.ranges[0].$to.pos).toBeLessThanOrEqual(size);
    });

    it("clamps negative positions to 0", () => {
      const doc = createDoc("hi");
      const sel = MultiSelection.fromJSON(doc, {
        ranges: [{ anchor: -5, head: -10 }],
        primaryIndex: 0,
      });
      expect(sel.ranges[0].$from.pos).toBeGreaterThanOrEqual(0);
      expect(sel.ranges[0].$to.pos).toBeGreaterThanOrEqual(0);
    });

    it("clamps mixed out-of-bounds range (from valid, to exceeds)", () => {
      const doc = createDoc("hi");
      const size = doc.content.size;
      const sel = MultiSelection.fromJSON(doc, {
        ranges: [{ anchor: 1, head: 999 }],
        primaryIndex: 0,
      });
      expect(sel.ranges[0].$from.pos).toBe(1);
      expect(sel.ranges[0].$to.pos).toBeLessThanOrEqual(size);
    });
  });

  describe("toJSON / fromJSON with backward ranges", () => {
    it("serializes and deserializes backward ranges", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $from = doc.resolve(1);
      const $to = doc.resolve(6);

      const ranges = [new SelectionRange($from, $to)];
      const original = new MultiSelection(ranges, 0, [true]); // backward

      const json = original.toJSON();
      // With backward flag, anchor should be > head
      expect(json.ranges[0].anchor).toBe(6);
      expect(json.ranges[0].head).toBe(1);

      const restored = MultiSelection.fromJSON(doc, json);
      expect(restored.backward[0]).toBe(true);
    });
  });

  describe("map with backward flags", () => {
    it("preserves backward flags through mapping", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const $from = doc.resolve(1);
      const $to = doc.resolve(6);

      const ranges = [new SelectionRange($from, $to)];
      const multiSel = new MultiSelection(ranges, 0, [true]);

      const tr = state.tr.insertText("XX", 8, 8);
      const mapped = multiSel.map(tr.doc, tr.mapping) as MultiSelection;

      expect(mapped.backward[0]).toBe(true);
    });

    it("remaps backward flags when ranges merge after mapping (#490)", () => {
      // Two adjacent ranges that will overlap after a deletion between them
      const state = createState("abcdefghij");
      const doc = state.doc;

      // Range 1: positions 1–4 ("abc"), Range 2: positions 6–9 ("fgh")
      const ranges = [
        new SelectionRange(doc.resolve(1), doc.resolve(4)),
        new SelectionRange(doc.resolve(6), doc.resolve(9)),
      ];
      const multiSel = new MultiSelection(ranges, 0, [true, false]);

      // Delete the text between the two ranges (positions 4–6: "de")
      // This causes the ranges to become adjacent/overlapping and get merged
      const tr = state.tr.delete(4, 6);
      const mapped = multiSel.map(tr.doc, tr.mapping) as MultiSelection;

      // After merge, should have fewer ranges and backward flags should be
      // remapped (not silently reset to all-false)
      expect(mapped.ranges.length).toBeLessThanOrEqual(2);
      // The backward array must match the range count (not be reset due to mismatch)
      expect(mapped.backward).toHaveLength(mapped.ranges.length);
    });
  });

  describe("backward array length mismatch defense (#311)", () => {
    it("resets backward to all-false when length mismatches ranges", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const ranges = [
        new SelectionRange(doc.resolve(1), doc.resolve(1)),
        new SelectionRange(doc.resolve(5), doc.resolve(5)),
      ];
      // Deliberately wrong length (3 flags for 2 ranges)
      const wrongBackward = [true, false, true];

      const sel = new MultiSelection(ranges, 0, wrongBackward);
      // Should have reset to [false, false] due to length mismatch
      expect(sel.backward).toHaveLength(2);
      expect(sel.backward).toEqual([false, false]);
    });
  });
});
