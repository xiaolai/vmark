/**
 * Source Block Actions
 *
 * Purpose: List, blockquote, and heading-step handlers for source (CodeMirror)
 * mode toolbar actions. Action IDs are typed unions so the switches are
 * exhaustive — no defensive default branches.
 *
 * Key decisions:
 *   - A list action re-applied to its OWN type turns the list off, matching
 *     WYSIWYG. Without that branch the toolbar button was one-way in Source
 *     mode alone.
 *   - Handlers propagate whether they actually changed the document. Reporting
 *     success unconditionally told the toolbar an outdent had happened at the
 *     outermost level, where nothing had.
 *
 * @coordinates-with sourceAdapter.ts — dispatcher narrows action IDs and routes here
 * @coordinates-with sourceMultiSelection.ts — multi-cursor variants short-circuit first
 * Changing a list's TYPE goes through `listBlockConversion.convertListBlock`,
 * which rewrites the whole innermost list — rewriting only the cursor's marker
 * turned one list into three.
 *
 * @coordinates-with sourceContextDetection/listBlockConversion.ts — whole-list conversion
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
} from "@/plugins/sourceContextDetection/listDetection";
import { convertListBlock } from "@/plugins/sourceContextDetection/listBlockConversion";
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
        // Re-applying the SAME list type turns the list off, as WYSIWYG does.
        // Source used to no-op, so the button was one-way in Source mode only.
        // Changing to a DIFFERENT type converts the whole list, not the cursor's
        // line — rewriting one marker turned one list into three.
        if (info.type === "bullet") removeList(view, info);
        else convertListBlock(view, "bullet");
        return true;
      case "orderedList":
        if (info.type === "ordered") removeList(view, info);
        else convertListBlock(view, "ordered");
        return true;
      case "taskList":
        if (info.type === "task") removeList(view, info);
        else convertListBlock(view, "task");
        return true;
      case "indent":
        indentListItem(view, info);
        return true;
      case "outdent":
        // Propagate: at the outermost level nothing happens, and reporting
        // success there told the toolbar an outdent had occurred.
        return outdentListItem(view, info);
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
