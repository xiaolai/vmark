/**
 * Source Block Actions
 *
 * Purpose: List, blockquote, and heading-step handlers for source (CodeMirror)
 * mode toolbar actions. Action IDs are typed unions so the switches are
 * exhaustive — no defensive default branches.
 *
 * @coordinates-with sourceAdapter.ts — dispatcher narrows action IDs and routes here
 * @coordinates-with sourceMultiSelection.ts — multi-cursor variants short-circuit first
 * @module plugins/toolbarActions/sourceBlockActions
 */

import type { EditorView } from "@codemirror/view";
import {
  getBlockquoteInfo,
  nestBlockquote,
  removeBlockquote,
  unnestBlockquote,
} from "@/plugins/sourceContextDetection/blockquoteDetection";
import {
  convertToHeading,
  getHeadingInfo,
  setHeadingLevel,
} from "@/plugins/sourceContextDetection/headingDetection";
import {
  getListItemInfo,
  indentListItem,
  outdentListItem,
  removeList,
  toBulletList,
  toOrderedList,
  toTaskList,
} from "@/plugins/sourceContextDetection/listDetection";
import {
  applyMultiSelectionBlockquoteAction,
  applyMultiSelectionListAction,
} from "./sourceMultiSelection";
import { insertListMarker } from "./sourceInsertActions";

/** List-related action IDs handled in source mode. */
type SourceListAction =
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "indent"
  | "outdent"
  | "removeList";

/** Blockquote nesting action IDs handled in source mode. */
type SourceBlockquoteAction =
  | "nestBlockquote"
  | "unnestBlockquote"
  | "removeBlockquote";

export function increaseHeadingLevel(view: EditorView): boolean {
  const info = getHeadingInfo(view);
  if (info && info.level < 6) {
    setHeadingLevel(view, info, info.level + 1);
    return true;
  }
  if (!info) {
    convertToHeading(view, 1);
    return true;
  }
  return false;
}

export function decreaseHeadingLevel(view: EditorView): boolean {
  const info = getHeadingInfo(view);
  if (info && info.level > 1) {
    setHeadingLevel(view, info, info.level - 1);
    return true;
  }
  if (info && info.level === 1) {
    setHeadingLevel(view, info, 0);
    return true;
  }
  return false;
}

export function handleListAction(view: EditorView, action: SourceListAction): boolean {
  /* v8 ignore next -- @preserve applyMultiSelectionListAction early-return is exercised via multiSelection tests */
  if (applyMultiSelectionListAction(view, action)) return true;
  const info = getListItemInfo(view);

  // If already in a list, convert or modify
  if (info) {
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
    }
  }

  // Not in a list - create new list for list type actions
  switch (action) {
    case "bulletList":
      return insertListMarker(view, "- ");
    case "orderedList":
      return insertListMarker(view, "1. ");
    case "taskList":
      return insertListMarker(view, "- [ ] ");
    case "indent":
    case "outdent":
    case "removeList":
      // These only make sense when already in a list
      return false;
  }
}

export function handleBlockquoteAction(
  view: EditorView,
  action: SourceBlockquoteAction,
): boolean {
  if (applyMultiSelectionBlockquoteAction(view, action)) return true;
  const info = getBlockquoteInfo(view);
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
  }
}
