import type { EditorView } from "@codemirror/view";
import { getBlockquoteInfo, nestBlockquote, removeBlockquote, unnestBlockquote } from "@/plugins/sourceContextDetection/blockquoteDetection";
import { convertToHeading, getHeadingInfo, setHeadingLevel } from "@/plugins/sourceContextDetection/headingDetection";
import { getListItemInfo, indentListItem, outdentListItem, removeList, toBulletList, toOrderedList, toTaskList } from "@/plugins/sourceContextDetection/listDetection";

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

export function applyMultiSelectionListAction(view: EditorView, action: string): boolean {
  if (view.state.selection.ranges.length <= 1) return false;
  return forEachRangeDescending(view, (pos) => {
    const info = getListItemInfo(view, pos);
    if (!info) return false;
    switch (action) {
      case "bulletList":
        toBulletList(view, info);
        return true;
      case "orderedList":
        toOrderedList(view, info);
        return true;
      case "taskList":
        toTaskList(view, info);
        return true;
      case "indent":
        indentListItem(view, info);
        return true;
      case "outdent":
        outdentListItem(view, info);
        return true;
      case "removeList":
        removeList(view, info);
        return true;
      default:
        return false;
    }
  });
}

export function applyMultiSelectionBlockquoteAction(view: EditorView, action: string): boolean {
  if (view.state.selection.ranges.length <= 1) return false;
  return forEachRangeDescending(view, (pos) => {
    const info = getBlockquoteInfo(view, pos);
    if (!info) return false;
    switch (action) {
      case "nestQuote":
        nestBlockquote(view, info);
        return true;
      case "unnestQuote":
        unnestBlockquote(view, info);
        return true;
      case "removeQuote":
        removeBlockquote(view, info);
        return true;
      default:
        return false;
    }
  });
}
