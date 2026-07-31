/**
 * List Detection for Source Mode
 *
 * Detects if cursor is inside a markdown list item. The marker grammar lives
 * in listMarkerParsing, block bounds in listBlockBounds, and single-item
 * mutations in listMutations; this module keeps the one import surface
 * consumers already use, so the split is invisible to them.
 *
 * @coordinates-with listMarkerParsing.ts — the shared marker grammar
 * @coordinates-with listBlockBounds.ts — whole-list span detection
 * @coordinates-with listMutations.ts — the mutations re-exported below
 * @module plugins/sourceContextDetection/listDetection
 */

import type { EditorView } from "@codemirror/view";
import { parseListMarker } from "./listMarkerParsing";
import { getTabSize } from "./listMutations";

export { getListBlockBounds } from "./listBlockBounds";
export {
  indentListItem,
  outdentListItem,
  toBulletList,
  toOrderedList,
  toTaskList,
  removeList,
} from "./listMutations";

// ListItemInfo lives in listMarkerParsing.ts (the leaf) so mutation and
// detection can share it without a dependency cycle.
export type { ListItemInfo, ListType } from "./listMarkerParsing";
import type { ListItemInfo } from "./listMarkerParsing";

/**
 * Detect if cursor is on a list item line and get its info.
 *
 * A task checkbox on EITHER a bullet or an ordered item reports type "task"
 * (GFM allows both); an ordered task additionally keeps its number.
 */
export function getListItemInfo(view: EditorView, pos?: number): ListItemInfo | null {
  const { state } = view;
  const from = typeof pos === "number" ? pos : state.selection.main.from;
  const line = state.doc.lineAt(from);

  const parsed = parseListMarker(line.text);
  if (!parsed) return null;

  const tabSize = getTabSize();
  return {
    type: parsed.isTask ? "task" : parsed.kind,
    lineStart: line.from,
    lineEnd: line.to,
    indent: Math.floor(parsed.indent.length / tabSize),
    number: parsed.number,
    checked: parsed.checked,
    marker: parsed.prefix,
    contentStart: line.from + parsed.prefix.length,
  };
}
