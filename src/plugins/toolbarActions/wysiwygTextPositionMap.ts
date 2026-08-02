/**
 * Textblock text-offset <-> document-position mapping.
 *
 * Purpose: a textblock's `textContent` and its ProseMirror positions live in
 * different coordinate spaces — inline atoms (hardBreak, inline math, images)
 * occupy parent offsets but contribute nothing to the text — so any code that
 * runs a string algorithm over block text and applies the result to the
 * document must map between the two explicitly.
 *
 * Extracted from `toggleQuoteStyleAtCursor` so the mapping is directly
 * testable instead of living under coverage suppressions.
 *
 * @coordinates-with wysiwygAdapterFormatting.ts — the quote-style toggle consumer
 * @module plugins/toolbarActions/wysiwygTextPositionMap
 */
import type { Node as PMNode } from "@tiptap/pm/model";

export interface TextPositionMap {
  /** The block's text — the concatenation of its text nodes only. */
  text: string;
  /** Doc-absolute position of each character of `text`. */
  positions: number[];
}

/**
 * Build the block's text and, for each character, its document position.
 *
 * @param parent the textblock whose children are scanned
 * @param blockStart doc position of the block's first inline offset
 */
export function buildTextPositionMap(parent: PMNode, blockStart: number): TextPositionMap {
  const positions: number[] = [];
  let text = "";
  parent.forEach((child, offset) => {
    if (child.isText && child.text) {
      for (let i = 0; i < child.text.length; i++) {
        positions.push(blockStart + offset + i);
        text += child.text[i];
      }
    }
  });
  return { text, positions };
}

/**
 * Convert a cursor's parent offset to its offset in the block's text.
 *
 * A cursor sitting inside or after a non-text child maps to the text offset
 * of the nearest text boundary at or before it, so string algorithms see a
 * position that exists in their coordinate space.
 */
export function parentOffsetToTextOffset(parent: PMNode, parentOffset: number): number {
  let textOffset = 0;
  let childStart = 0;
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childEnd = childStart + child.nodeSize;
    if (parentOffset < childEnd) {
      if (child.isText) {
        textOffset += parentOffset - childStart;
      }
      break;
    }
    if (child.isText && child.text) {
      textOffset += child.text.length;
    }
    childStart = childEnd;
  }
  return textOffset;
}
