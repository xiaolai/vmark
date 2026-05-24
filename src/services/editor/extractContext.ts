/**
 * Extract surrounding blocks as read-only context for AI genies.
 *
 * Walks the document's top-level children to find neighbors of the
 * content range, serializing ±radius blocks as markdown.
 */

import type { EditorState } from "@tiptap/pm/state";
import type { SourcePeekRange } from "@/stores/sourcePeekStore";
import { serializeSourcePeekRange } from "@/services/editor/sourcePeek";

export interface ContextResult {
  before: string;
  after: string;
}

/**
 * Extract ±radius surrounding blocks around the given content range.
 *
 * Algorithm:
 * 1. Find the top-level child index containing contentRange.from
 * 2. Walk backward `radius` siblings (compound blocks count as 1)
 * 3. Find the top-level child index containing contentRange.to
 * 4. Walk forward `radius` siblings
 * 5. Serialize each collected range
 */
export function extractSurroundingContext(
  state: EditorState,
  contentRange: SourcePeekRange,
  radius: number
): ContextResult {
  if (radius <= 0) return { before: "", after: "" };

  const doc = state.doc;
  const childCount = doc.childCount;
  if (childCount === 0) return { before: "", after: "" };

  // Find the top-level child index that contains contentRange.from
  let fromIndex = -1;
  let toIndex = -1;
  let offset = 0;

  for (let i = 0; i < childCount; i++) {
    const child = doc.child(i);
    const nodeEnd = offset + child.nodeSize; // includes wrapper

    if (fromIndex === -1 && contentRange.from <= nodeEnd) {
      fromIndex = i;
    }
    if (contentRange.to <= nodeEnd && toIndex === -1) {
      toIndex = i;
    }

    offset += child.nodeSize;
  }

  // Fallback if not found
  if (fromIndex === -1) fromIndex = childCount - 1;
  if (toIndex === -1) toIndex = childCount - 1;

  // Collect "before" blocks: walk backward from fromIndex
  const beforeParts: string[] = [];
  for (let i = fromIndex - 1; i >= 0 && beforeParts.length < radius; i--) {
    const child = doc.child(i);
    const pos = childPos(doc, i);
    const range: SourcePeekRange = { from: pos, to: pos + child.nodeSize };
    const text = serializeSourcePeekRange(state, range);
    if (text.trim()) {
      beforeParts.unshift(text.trim());
    }
  }

  // Collect "after" blocks: walk forward from toIndex
  const afterParts: string[] = [];
  for (let i = toIndex + 1; i < childCount && afterParts.length < radius; i++) {
    const child = doc.child(i);
    const pos = childPos(doc, i);
    const range: SourcePeekRange = { from: pos, to: pos + child.nodeSize };
    const text = serializeSourcePeekRange(state, range);
    if (text.trim()) {
      afterParts.push(text.trim());
    }
  }

  return {
    before: beforeParts.join("\n\n"),
    after: afterParts.join("\n\n"),
  };
}

/** Get the absolute position of the i-th top-level child in the doc. */
function childPos(doc: import("@tiptap/pm/model").Node, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) {
    pos += doc.child(i).nodeSize;
  }
  return pos;
}
