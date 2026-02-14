/**
 * Tiptap Context Helpers
 *
 * Purpose: Helper functions for building CursorContext from ProseMirror state —
 * mark detection, position analysis, and context mode determination.
 * Extracted from tiptapContext.ts to keep files under ~300 lines.
 *
 * @coordinates-with tiptapContext.ts — calls these helpers during context extraction
 * @module plugins/formatToolbar/tiptapContextHelpers
 */

import type { ResolvedPos } from "@tiptap/pm/model";
import type { CursorContext } from "@/plugins/toolbarContext/types";
import { findWordBoundaries } from "@/utils/wordSegmentation";

/**
 * Detect marks (link, bold, italic, etc.) at cursor position.
 * Mutates ctx to add inLink or inFormattedRange info.
 */
export function detectMarksAtCursor($from: ResolvedPos, ctx: CursorContext): void {
  const marks = $from.marks();

  for (const mark of marks) {
    // Link mark
    if (mark.type.name === "link" && !ctx.inLink) {
      const range = findMarkRange($from, mark.type);
      if (range) {
        ctx.inLink = {
          href: mark.attrs.href || "",
          text: "",
          from: range.from,
          to: range.to,
          contentFrom: range.from,
          contentTo: range.to,
        };
      }
      continue;
    }

    // Other formatting marks (bold, italic, etc.)
    if (!ctx.inFormattedRange && !ctx.inLink) {
      const range = findMarkRange($from, mark.type);
      if (range) {
        ctx.inFormattedRange = {
          markType: mark.type.name,
          from: range.from,
          to: range.to,
          contentFrom: range.from,
          contentTo: range.to,
        };
      }
    }
  }
}

/**
 * Find the range of a mark at position.
 * Walks parent's children to find exact mark boundaries.
 *
 * @param $pos - Resolved position in document
 * @param markType - Mark type to find
 * @returns Range { from, to } or null if cursor not in mark
 */
export function findMarkRange(
  $pos: ResolvedPos,
  markType: { name: string }
): { from: number; to: number } | null {
  const { parent, parentOffset } = $pos;

  // Calculate base position
  const basePos = $pos.pos - parentOffset;

  // Walk through parent's children to find exact mark boundaries
  let markFrom = -1;
  let markTo = -1;

  let offset = 0;
  let found = false;

  for (let index = 0; index < parent.childCount; index++) {
    const child = parent.child(index);
    const childFrom = basePos + offset;
    const childTo = childFrom + child.nodeSize;
    offset += child.nodeSize;

    if (child.isText) {
      const hasMark = child.marks.some((m) => m.type.name === markType.name);
      if (hasMark) {
        if (markFrom === -1) markFrom = childFrom;
        markTo = childTo;
        continue;
      }
    }

    if (markFrom !== -1) {
      if ($pos.pos >= markFrom && $pos.pos <= markTo) {
        found = true;
        break;
      }
      markFrom = -1;
      markTo = -1;
    }
  }

  if (!found && markFrom !== -1 && $pos.pos >= markFrom && $pos.pos <= markTo) {
    found = true;
  }

  return found ? { from: markFrom, to: markTo } : null;
}

/**
 * Check if cursor is at paragraph line start.
 * Returns true if cursor is at start of a non-empty paragraph
 * (with only whitespace before cursor position).
 */
export function isAtLineStart($from: ResolvedPos): boolean {
  // Must be at start of parent content
  if ($from.parentOffset !== 0) {
    // Check if only whitespace before cursor
    const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
    if (textBefore.trim() !== "") {
      return false;
    }
  }

  // Must be in a paragraph
  if ($from.parent.type.name !== "paragraph") {
    return false;
  }

  // Paragraph must have content
  if ($from.parent.textContent.trim() === "") {
    return false;
  }

  return true;
}

/**
 * Find word at cursor position using shared word segmentation utility.
 * Uses Intl.Segmenter for consistent CJK support across both editors.
 *
 * @param $from - Resolved position in document
 * @returns Range { from, to } or null if cursor not in word
 */
export function findWordAtPos($from: ResolvedPos): { from: number; to: number } | null {
  const { parent, parentOffset } = $from;
  const text = parent.textContent;

  if (!text) {
    return null;
  }

  // Use shared word segmentation utility
  const result = findWordBoundaries(text, parentOffset);
  if (!result) {
    return null;
  }

  // Convert text-relative offsets to document positions
  const basePos = $from.pos - parentOffset;
  return { from: basePos + result.start, to: basePos + result.end };
}

/**
 * Determine context mode for insert fallback.
 * Returns "insert-block" when cursor is at empty paragraph start,
 * otherwise "insert" for inline insertion.
 */
export function determineContextMode($from: ResolvedPos, empty: boolean): "insert" | "insert-block" {
  if (!empty) return "insert";

  const parent = $from.parent;
  const atStart = $from.parentOffset === 0;
  const isEmpty = parent.textContent.trim() === "";

  if (atStart && isEmpty) {
    return "insert-block";
  }

  return "insert";
}
