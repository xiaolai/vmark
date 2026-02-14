/**
 * Multi-cursor Horizontal Movement
 *
 * Purpose: Handles left/right arrow key movement for all cursors in a MultiSelection,
 * supporting character, word, and line-level granularity with optional Shift+extend.
 *
 * Key decisions:
 *   - Uses wordSegmentation utility for word boundaries (CJK-aware via Intl.Segmenter)
 *   - Line-start/end uses doc.resolve to find textblock boundaries
 *
 * @coordinates-with keymap.ts — binds arrow key combos to these handlers
 * @coordinates-with rangeUtils.ts — normalizes resulting ranges
 * @module plugins/multiCursor/horizontalMovement
 */
import { Selection, SelectionRange } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { findWordEdge } from "@/utils/wordSegmentation";
import { MultiSelection } from "./MultiSelection";
import { normalizeRangesWithPrimary } from "./rangeUtils";

export type HorizontalUnit = "char" | "word" | "line";

function moveRangeHorizontally(
  doc: EditorState["doc"],
  range: SelectionRange,
  dir: -1 | 1,
  extend: boolean,
  unit: HorizontalUnit
): SelectionRange {
  const headPos = range.$to.pos;

  if (unit === "char") {
    const startPos = Math.max(0, Math.min(doc.content.size, headPos + dir));
    const $head = doc.resolve(startPos);
    const found = Selection.findFrom($head, dir, true);
    if (!found) return range;
    const targetPos = dir < 0 ? found.from : found.to;
    if (extend) {
      const anchorPos = range.$from.pos;
      const from = Math.min(anchorPos, targetPos);
      const to = Math.max(anchorPos, targetPos);
      return new SelectionRange(doc.resolve(from), doc.resolve(to));
    }
    const $pos = doc.resolve(targetPos);
    return new SelectionRange($pos, $pos);
  }

  const $head = doc.resolve(headPos);
  const blockStart = headPos - $head.parentOffset;
  const blockEnd = blockStart + $head.parent.content.size;

  let targetPos = headPos;
  if (unit === "line") {
    targetPos = dir < 0 ? blockStart : blockEnd;
  } else {
    const text = $head.parent.textContent;
    const edge = findWordEdge(text, $head.parentOffset, dir);
    if (edge === null) return range;
    targetPos = blockStart + edge;
  }

  if (extend) {
    const anchorPos = range.$from.pos;
    const from = Math.min(anchorPos, targetPos);
    const to = Math.max(anchorPos, targetPos);
    return new SelectionRange(doc.resolve(from), doc.resolve(to));
  }

  const $pos = doc.resolve(targetPos);
  return new SelectionRange($pos, $pos);
}

export function handleMultiCursorHorizontal(
  state: EditorState,
  direction: "ArrowLeft" | "ArrowRight",
  extend: boolean,
  unit: HorizontalUnit
): Transaction | null {
  const { selection, doc } = state;
  if (!(selection instanceof MultiSelection)) {
    return null;
  }

  const dir = direction === "ArrowLeft" ? -1 : 1;
  const nextRanges = selection.ranges.map((range) =>
    moveRangeHorizontally(doc, range, dir, extend, unit)
  );

  const normalized = normalizeRangesWithPrimary(
    nextRanges,
    doc,
    selection.primaryIndex
  );
  const newSel = new MultiSelection(normalized.ranges, normalized.primaryIndex);
  return state.tr.setSelection(newSel);
}
