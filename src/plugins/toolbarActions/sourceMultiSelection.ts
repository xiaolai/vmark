/**
 * Source Multi-Selection Block Actions
 *
 * Purpose: Applies heading and blockquote actions across multiple CodeMirror
 * selections by iterating ranges in reverse document order. Each range is
 * independently evaluated and transformed. LIST actions no longer live here —
 * `sourceBlockActions` gives every cursor the full single-cursor semantics
 * (toggle-off, whole-list conversion, shared-block dedupe), which the old
 * per-range switch could not.
 *
 * @coordinates-with sourceAdapter.ts — delegates here when multi-selection is active
 * @coordinates-with sourceContextDetection — uses detection + action functions per block type
 * @module plugins/toolbarActions/sourceMultiSelection
 */
import type { EditorView } from "@codemirror/view";
import { getBlockquoteInfo, nestBlockquote, removeBlockquote, unnestBlockquote } from "@/plugins/sourceContextDetection/blockquoteDetection";
import { convertToHeading, getHeadingInfo, setHeadingLevel } from "@/plugins/sourceContextDetection/headingDetection";

function forEachRangeDescending(
  view: EditorView,
  handler: (pos: number) => boolean
): boolean {
  const ranges = [...view.state.selection.ranges].sort((a, b) => b.from - a.from);
  let applied = false;
  for (const range of ranges) {
    applied = handler(range.from) || applied;
  }
  return applied;
}

export function applyMultiSelectionHeading(view: EditorView, level: number): boolean {
  if (view.state.selection.ranges.length <= 1) return false;
  return forEachRangeDescending(view, (pos) => {
    const info = getHeadingInfo(view, pos);
    if (info) {
      setHeadingLevel(view, info, level);
      return true;
    }
    if (level === 0) return false;
    convertToHeading(view, level, pos);
    return true;
  });
}

export function applyMultiSelectionBlockquoteAction(view: EditorView, action: string): boolean {
  if (view.state.selection.ranges.length <= 1) return false;
  return forEachRangeDescending(view, (pos) => {
    const info = getBlockquoteInfo(view, pos);
    if (!info) return false;
    switch (action) {
      case "nestBlockquote":
        nestBlockquote(view, info);
        return true;
      case "unnestBlockquote":
        unnestBlockquote(view, info);
        return true;
      case "removeBlockquote":
        removeBlockquote(view, info);
        return true;
      default:
        return false;
    }
  });
}
