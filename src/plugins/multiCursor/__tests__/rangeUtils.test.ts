// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, SelectionRange } from "@tiptap/pm/state";
import { multiCursorPlugin } from "../multiCursorPlugin";
import {
  mergeOverlappingRanges,
  sortAndDedupeRanges,
  normalizeRangesWithPrimary,
  remapBackwardFlags,
} from "../rangeUtils";

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

describe("rangeUtils", () => {
  describe("mergeOverlappingRanges", () => {
    it("merges overlapping ranges", () => {
      const state = createState("hello world");
      const doc = state.doc;

      // Ranges 1-5 and 3-8 overlap
      const ranges = [
        new SelectionRange(doc.resolve(1), doc.resolve(5)),
        new SelectionRange(doc.resolve(3), doc.resolve(8)),
      ];

      const merged = mergeOverlappingRanges(ranges, doc);

      expect(merged).toHaveLength(1);
      expect(merged[0].$from.pos).toBe(1);
      expect(merged[0].$to.pos).toBe(8);
    });

    it("does not merge adjacent ranges", () => {
      const state = createState("hello world");
      const doc = state.doc;

      // Ranges 1-5 and 5-8 are adjacent
      const ranges = [
        new SelectionRange(doc.resolve(1), doc.resolve(5)),
        new SelectionRange(doc.resolve(5), doc.resolve(8)),
      ];

      const merged = mergeOverlappingRanges(ranges, doc);

      expect(merged).toHaveLength(2);
      expect(merged[0].$from.pos).toBe(1);
      expect(merged[0].$to.pos).toBe(5);
      expect(merged[1].$from.pos).toBe(5);
      expect(merged[1].$to.pos).toBe(8);
    });

    it("keeps non-overlapping ranges separate", () => {
      const state = createState("hello world");
      const doc = state.doc;

      // Ranges 1-3 and 7-10 don't overlap
      const ranges = [
        new SelectionRange(doc.resolve(1), doc.resolve(3)),
        new SelectionRange(doc.resolve(7), doc.resolve(10)),
      ];

      const merged = mergeOverlappingRanges(ranges, doc);

      expect(merged).toHaveLength(2);
    });

    it("handles multiple overlapping groups", () => {
      const state = createState("hello world foo");
      const doc = state.doc;

      // Two overlapping groups
      const ranges = [
        new SelectionRange(doc.resolve(1), doc.resolve(3)),
        new SelectionRange(doc.resolve(2), doc.resolve(5)),
        new SelectionRange(doc.resolve(10), doc.resolve(12)),
        new SelectionRange(doc.resolve(11), doc.resolve(14)),
      ];

      const merged = mergeOverlappingRanges(ranges, doc);

      expect(merged).toHaveLength(2);
    });

    it("handles cursor positions (empty ranges)", () => {
      const state = createState("hello world");
      const doc = state.doc;

      // Multiple cursors at different positions
      const ranges = [
        new SelectionRange(doc.resolve(1), doc.resolve(1)),
        new SelectionRange(doc.resolve(5), doc.resolve(5)),
        new SelectionRange(doc.resolve(10), doc.resolve(10)),
      ];

      const merged = mergeOverlappingRanges(ranges, doc);

      // Cursors don't merge unless at same position
      expect(merged).toHaveLength(3);
    });

    it("merges cursors at same position", () => {
      const state = createState("hello world");
      const doc = state.doc;

      // Two cursors at same position
      const ranges = [
        new SelectionRange(doc.resolve(5), doc.resolve(5)),
        new SelectionRange(doc.resolve(5), doc.resolve(5)),
      ];

      const merged = mergeOverlappingRanges(ranges, doc);

      expect(merged).toHaveLength(1);
      expect(merged[0].$from.pos).toBe(5);
    });
  });

  describe("sortAndDedupeRanges", () => {
    it("sorts ranges by position", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const ranges = [
        new SelectionRange(doc.resolve(10), doc.resolve(10)),
        new SelectionRange(doc.resolve(1), doc.resolve(1)),
        new SelectionRange(doc.resolve(5), doc.resolve(5)),
      ];

      const sorted = sortAndDedupeRanges(ranges, doc);

      expect(sorted[0].$from.pos).toBe(1);
      expect(sorted[1].$from.pos).toBe(5);
      expect(sorted[2].$from.pos).toBe(10);
    });

    it("removes duplicate positions", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const ranges = [
        new SelectionRange(doc.resolve(5), doc.resolve(5)),
        new SelectionRange(doc.resolve(5), doc.resolve(5)),
        new SelectionRange(doc.resolve(10), doc.resolve(10)),
      ];

      const sorted = sortAndDedupeRanges(ranges, doc);

      expect(sorted).toHaveLength(2);
    });
  });

  describe("normalizeRangesWithPrimary", () => {
    it("preserves primary range after sorting", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const ranges = [
        new SelectionRange(doc.resolve(10), doc.resolve(10)),
        new SelectionRange(doc.resolve(1), doc.resolve(1)),
        new SelectionRange(doc.resolve(5), doc.resolve(5)),
      ];

      const result = normalizeRangesWithPrimary(ranges, doc, 2);

      expect(result.ranges[0].$from.pos).toBe(1);
      expect(result.ranges[1].$from.pos).toBe(5);
      expect(result.ranges[2].$from.pos).toBe(10);
      expect(result.primaryIndex).toBe(1); // original primary at pos 5
    });

    it("returns empty ranges and primaryIndex 0 when input is empty (line 155)", () => {
      const state = createState("hello");
      const doc = state.doc;

      const result = normalizeRangesWithPrimary([], doc, 0);

      expect(result.ranges).toHaveLength(0);
      expect(result.primaryIndex).toBe(0);
    });

    it("tracks primary via containment when ranges are merged", () => {
      // When overlapping ranges merge, the primary's position is found
      // inside the merged range via containment check.
      const state = createState("hello world");
      const doc = state.doc;

      // Three overlapping ranges: [1-5], [3-8], [6-10]
      // With merge=true, all merge to [1-10].
      // Primary = index 1 (range [3-8], from=3).
      // Containment check: merged [1-10] contains pos 3 → primaryIndex = 0.
      const ranges = [
        new SelectionRange(doc.resolve(1), doc.resolve(5)),
        new SelectionRange(doc.resolve(3), doc.resolve(8)),  // primary
        new SelectionRange(doc.resolve(6), doc.resolve(10)),
      ];

      const result = normalizeRangesWithPrimary(ranges, doc, 1, true);

      expect(result.ranges).toHaveLength(1);
      expect(result.primaryIndex).toBe(0);
    });
  });

  describe("remapBackwardFlags", () => {
    it("preserves flags when ranges are unchanged", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const ranges = [
        new SelectionRange(doc.resolve(1), doc.resolve(3)),
        new SelectionRange(doc.resolve(5), doc.resolve(8)),
      ];
      const backward = [true, false];

      const result = remapBackwardFlags(ranges, backward, ranges);
      expect(result).toEqual([true, false]);
    });

    it("remaps flags when duplicate ranges are removed", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const original = [
        new SelectionRange(doc.resolve(1), doc.resolve(3)),
        new SelectionRange(doc.resolve(5), doc.resolve(5)),
        new SelectionRange(doc.resolve(5), doc.resolve(5)), // duplicate
      ];
      const backward = [true, false, true];

      // After dedup, only first occurrence at pos 5 survives
      const normalized = sortAndDedupeRanges(original, doc);
      expect(normalized).toHaveLength(2);

      const result = remapBackwardFlags(original, backward, normalized);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(true);  // range [1,3] → backward=true
      expect(result[1]).toBe(false); // range [5,5] → first match backward=false
    });

    it("remaps flags when overlapping ranges are merged", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const original = [
        new SelectionRange(doc.resolve(1), doc.resolve(5)),
        new SelectionRange(doc.resolve(3), doc.resolve(8)),
      ];
      const backward = [false, true];

      // After merge: single range [1, 8]
      const normalized = mergeOverlappingRanges(original, doc);
      expect(normalized).toHaveLength(1);

      const result = remapBackwardFlags(original, backward, normalized);
      expect(result).toHaveLength(1);
      // Merged range contains original[1] which has backward=true
      expect(result[0]).toBe(true);
    });

    it("falls back to false when backward array is shorter than original ranges", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const original = [
        new SelectionRange(doc.resolve(1), doc.resolve(3)),
        new SelectionRange(doc.resolve(5), doc.resolve(8)),
      ];
      // backward array is shorter — index 1 is undefined
      const backward = [true];

      const result = remapBackwardFlags(original, backward, original);
      expect(result).toEqual([true, false]); // second falls back to false
    });

    it("falls back to false for merged range when backward entry is undefined", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const original = [
        new SelectionRange(doc.resolve(1), doc.resolve(5)),
        new SelectionRange(doc.resolve(3), doc.resolve(8)),
      ];
      // backward array has only first entry; second is undefined
      const backward: boolean[] = [];

      const normalized = mergeOverlappingRanges(original, doc);
      expect(normalized).toHaveLength(1);

      const result = remapBackwardFlags(original, backward, normalized);
      expect(result).toEqual([false]); // ?? false fallback
    });

    it("returns false for ranges with no matching original", () => {
      const state = createState("hello world");
      const doc = state.doc;

      const original = [
        new SelectionRange(doc.resolve(1), doc.resolve(3)),
      ];
      const backward = [true];

      // A normalized range that doesn't match any original
      const normalized = [
        new SelectionRange(doc.resolve(7), doc.resolve(10)),
      ];

      const result = remapBackwardFlags(original, backward, normalized);
      expect(result).toEqual([false]);
    });
  });
});
