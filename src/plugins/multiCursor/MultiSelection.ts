/**
 * MultiSelection - Custom ProseMirror Selection for multi-cursor support
 *
 * Allows multiple cursor positions/selection ranges to be managed simultaneously.
 * The primary cursor determines the anchor/head for compatibility with existing
 * ProseMirror APIs (toolbar state, marks, etc.)
 *
 * Note: SelectionRange uses $from/$to, while Selection uses $anchor/$head.
 * We use $from/$to throughout since that's what SelectionRange provides.
 */
import { Selection, SelectionRange } from "@tiptap/pm/state";
import type { Node } from "@tiptap/pm/model";
import type { Mappable } from "@tiptap/pm/transform";
import { normalizeRangesWithPrimary } from "./rangeUtils";

export class MultiSelection extends Selection {
  /** Index of the primary range (used for anchor/head compatibility) */
  readonly primaryIndex: number;

  constructor(ranges: SelectionRange[], primaryIndex = 0) {
    // Validate inputs
    if (ranges.length === 0) {
      throw new Error("MultiSelection requires at least one range");
    }
    const doc = ranges[0].$from.doc;
    const normalized = normalizeRangesWithPrimary(ranges, doc, primaryIndex, false);

    // Primary range determines $anchor/$head for ProseMirror compatibility
    // SelectionRange stores $from/$to, we use them as $anchor/$head
    const primary = normalized.ranges[normalized.primaryIndex];
    // Pass ranges as third argument to Selection constructor
    super(primary.$from, primary.$to, normalized.ranges);

    this.primaryIndex = normalized.primaryIndex;
  }

  /**
   * Map selection through document changes.
   * Each range is mapped through the transformation mapping.
   */
  map(doc: Node, mapping: Mappable): Selection {
    const mappedRanges = this.ranges.map((range) => {
      const from = mapping.map(range.$from.pos);
      const to = mapping.map(range.$to.pos);
      const $from = doc.resolve(from);
      const $to = doc.resolve(to);
      return new SelectionRange($from, $to);
    });

    return new MultiSelection(mappedRanges, this.primaryIndex);
  }

  /**
   * Check equality with another selection.
   */
  eq(other: Selection): boolean {
    if (!(other instanceof MultiSelection)) {
      return false;
    }
    if (this.ranges.length !== other.ranges.length) {
      return false;
    }
    if (this.primaryIndex !== other.primaryIndex) {
      return false;
    }
    return this.ranges.every((range, i) => {
      const otherRange = other.ranges[i];
      return (
        range.$from.pos === otherRange.$from.pos &&
        range.$to.pos === otherRange.$to.pos
      );
    });
  }

  /**
   * Serialize selection to JSON for undo/redo history.
   */
  toJSON(): {
    type: string;
    ranges: Array<{ anchor: number; head: number }>;
    primaryIndex: number;
  } {
    return {
      type: "multi",
      ranges: this.ranges.map((r) => ({
        anchor: r.$from.pos,
        head: r.$to.pos,
      })),
      primaryIndex: this.primaryIndex,
    };
  }

  /**
   * Deserialize selection from JSON.
   */
  static fromJSON(
    doc: Node,
    json: { ranges: Array<{ anchor: number; head: number }>; primaryIndex: number }
  ): MultiSelection {
    const ranges = json.ranges.map((r) => {
      const $from = doc.resolve(r.anchor);
      const $to = doc.resolve(r.head);
      return new SelectionRange($from, $to);
    });
    return new MultiSelection(ranges, json.primaryIndex);
  }

  /**
   * Get all ranges for iteration.
   * Alias for ranges property.
   */
  get allRanges(): readonly SelectionRange[] {
    return this.ranges;
  }

  /**
   * Get content of the primary selection.
   * For copy operations, use the dedicated clipboard handling.
   */
  content() {
    // Return content of primary selection
    return this.$anchor.doc.slice(this.from, this.to);
  }

  /**
   * Get text content of all selections concatenated.
   * Useful for clipboard operations.
   */
  getTextContent(doc: Node): string {
    return this.ranges
      .map((range) => doc.textBetween(range.$from.pos, range.$to.pos))
      .join("\n");
  }
}

// Register with ProseMirror's Selection system
Selection.jsonID("multi", MultiSelection);
