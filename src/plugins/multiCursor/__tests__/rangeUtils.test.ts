import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, SelectionRange } from "@tiptap/pm/state";
import { multiCursorPlugin } from "../multiCursorPlugin";
import {
  mergeOverlappingRanges,
  sortAndDedupeRanges,
  normalizeRangesWithPrimary,
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
  });
});
