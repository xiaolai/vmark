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
import { normalizeRangesWithPrimary, remapBackwardFlags } from "./rangeUtils";

export class MultiSelection extends Selection {
  /** Index of the primary range (used for anchor/head compatibility) */
  readonly primaryIndex: number;

  /** Per-range directionality: true if the user selected backwards (anchor > head) */
  readonly backward: boolean[];

  constructor(ranges: SelectionRange[], primaryIndex = 0, backward?: boolean[]) {
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
    // Ensure backward array matches range count — mismatched lengths cause
    // selection direction bugs (see #311).
    this.backward = backward && backward.length === normalized.ranges.length
      ? backward
      : new Array(normalized.ranges.length).fill(false);
  }

  /**
   * Map selection through document changes.
   * Each range is mapped through the transformation mapping.
   */
  map(doc: Node, mapping: Mappable): Selection {
    const mappedRanges = this.ranges.map((range) => {
      const from = mapping.map(range.$from.pos, -1);
      const to = mapping.map(range.$to.pos, 1);
      const $from = doc.resolve(from);
      const $to = doc.resolve(to);
      return new SelectionRange($from, $to);
    });

    const normalized = normalizeRangesWithPrimary(mappedRanges, doc, this.primaryIndex, true);
    const remapped = remapBackwardFlags(mappedRanges, this.backward, normalized.ranges);
    return new MultiSelection(normalized.ranges, normalized.primaryIndex, remapped);
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
        range.$to.pos === otherRange.$to.pos &&
        this.backward[i] === other.backward[i]
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
      ranges: this.ranges.map((r, i) => {
        const isBackward = this.backward[i];
        return {
          anchor: isBackward ? r.$to.pos : r.$from.pos,
          head: isBackward ? r.$from.pos : r.$to.pos,
        };
      }),
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
    const backwardFlags: boolean[] = [];
    const size = doc.content.size;
    const ranges = json.ranges.map((r) => {
      const isBackward = r.anchor > r.head;
      backwardFlags.push(isBackward);
      const from = Math.max(0, Math.min(Math.min(r.anchor, r.head), size));
      const to = Math.max(0, Math.min(Math.max(r.anchor, r.head), size));
      return new SelectionRange(doc.resolve(from), doc.resolve(to));
    });
    return new MultiSelection(ranges, json.primaryIndex, backwardFlags);
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
