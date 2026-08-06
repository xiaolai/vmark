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
 *   - Multi-cursor list handling lives HERE and shares the single-cursor
 *     semantics, cursor by cursor. The old short-circuit returned one boolean
 *     that conflated "no multi-selection" with "nothing applied", so a
 *     multi-cursor action whose cursors were all outside lists fell through
 *     and marked only the main cursor's line — and in-list cursors got
 *     conversion-only semantics with no toggle and no dedupe.
 *
 * @coordinates-with sourceAdapter.ts — dispatcher narrows action IDs and routes here
 * @coordinates-with sourceMultiSelection.ts — blockquote multi-cursor variant short-circuits first
 * Changing a list's TYPE goes through `listBlockConversion.convertListBlock`,
 * which rewrites the whole innermost list — rewriting only the cursor's marker
 * turned one list into three.
 *
 * Toggling a list OFF removes one level: a nested item outdents into its parent,
 * only a top-level item leaves the list. Full removal is the Remove List action.
 *
 * @coordinates-with sourceContextDetection/listBlockConversion.ts — whole-list conversion
 * @module plugins/toolbarActions/sourceBlockActions
 */

import { EditorSelection } from "@codemirror/state";
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
  getListBlockBounds,
  getListItemInfo,
  type ListItemInfo,
  indentListItem,
  outdentListItem,
  removeList,
} from "@/plugins/sourceContextDetection/listDetection";
import {
  convertListBlock,
  type ListTypeTarget,
} from "@/plugins/sourceContextDetection/listBlockConversion";
import { applyMultiSelectionBlockquoteAction } from "./sourceMultiSelection";
import { insertListMarker } from "./sourceInsertActions";

/** List-type action IDs — the ones that toggle, convert, or create a list. */
type ListTypeAction = "bulletList" | "orderedList" | "taskList";

/** List-related action IDs handled in source mode. */
type SourceListAction = ListTypeAction | "indent" | "outdent" | "removeList";

/** Blockquote nesting action IDs handled in source mode. */
type SourceBlockquoteAction =
  | "nestBlockquote"
  | "unnestBlockquote"
  | "removeBlockquote";

/**
 * The list type and creation marker each list-type action targets — named once,
 * because spelling the three action→type→marker triples out in two switches let
 * them drift and tripled every branch.
 */
const LIST_TARGETS: Record<ListTypeAction, { type: ListTypeTarget; marker: string }> = {
  bulletList: { type: "bullet", marker: "- " },
  orderedList: { type: "ordered", marker: "1. " },
  taskList: { type: "task", marker: "- [ ] " },
};

function isListTypeAction(action: SourceListAction): action is ListTypeAction {
  return action in LIST_TARGETS;
}

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
  const multi = applyListActionToAllCursors(view, action);
  // Fall through to the main cursor ONLY when there is no multi-selection.
  // "Handled, but no cursor changed anything" must not run the single-cursor
  // path on top — that is the conflation that marked only the main line.
  if (multi.status === "handled") return multi.changed;
  const { main, mainIndex } = view.state.selection;
  return applyListActionAtCursor(view, action, main.from, mainIndex).changed;
}

/**
 * Outcome of the multi-cursor pass, kept distinct from a plain boolean so the
 * caller can tell "not in multi-selection" apart from "handled with nothing to
 * do".
 */
type MultiCursorListResult =
  | { status: "not-applicable" }
  | { status: "handled"; changed: boolean };

/**
 * Apply one list action at EVERY cursor, deduplicating cursors that share a
 * structural block.
 *
 * Cursors run in descending document order so each edit leaves the positions
 * above it untouched, and the remapped selection is re-read every pass.
 * `claimFrom` marks the start of the region an operation covered; under
 * descending order one low-water mark suffices, and it is what keeps two
 * cursors in one item from toggling it twice — and a second cursor inside a
 * just-converted list from reading "already the target type" and turning the
 * list back off.
 */
function applyListActionToAllCursors(
  view: EditorView,
  action: SourceListAction,
): MultiCursorListResult {
  const count = view.state.selection.ranges.length;
  if (count <= 1) return { status: "not-applicable" };

  let watermark = Infinity;
  let changed = false;
  for (let i = count - 1; i >= 0; i -= 1) {
    // Re-read: earlier passes may have remapped (or even merged) the ranges.
    const ranges = view.state.selection.ranges;
    const index = Math.min(i, ranges.length - 1);
    const pos = ranges[index].from;
    if (pos >= watermark) continue;
    const outcome = applyListActionAtCursor(view, action, pos, index);
    watermark = Math.min(watermark, outcome.claimFrom);
    changed = outcome.changed || changed;
  }
  return { status: "handled", changed };
}

/**
 * One cursor's worth of list action — the semantics the single-cursor path has
 * always had: toggle off on the own type, whole-list conversion to a different
 * type, marker creation outside a list, structure changes on the item.
 *
 * `claimFrom` is the start of the structural block the operation covered: the
 * item's line for per-item work, the whole list block for a conversion (which
 * rewrites every item), the cursor's own line otherwise.
 */
function applyListActionAtCursor(
  view: EditorView,
  action: SourceListAction,
  pos: number,
  rangeIndex: number,
): { changed: boolean; claimFrom: number } {
  const lineFrom = view.state.doc.lineAt(pos).from;
  const info = getListItemInfo(view, pos);
  if (!info) {
    // Indent, outdent and removal only make sense on an existing item.
    if (!isListTypeAction(action)) return { changed: false, claimFrom: lineFrom };
    return { changed: insertListMarker(view, LIST_TARGETS[action].marker, pos), claimFrom: lineFrom };
  }
  if (!isListTypeAction(action)) {
    return { changed: adjustListStructure(view, action, info), claimFrom: info.lineStart };
  }

  // Re-applying the SAME list type turns the list off, as WYSIWYG does.
  // Source used to no-op, so the button was one-way in Source mode only.
  const target = LIST_TARGETS[action].type;
  if (info.type === target) {
    toggleListOff(view, info);
    return { changed: true, claimFrom: info.lineStart };
  }

  // Changing to a DIFFERENT type converts the whole list, not the cursor's
  // line — rewriting one marker turned one list into three. `convertListBlock`
  // reads the MAIN selection, so main must point at this cursor first, and the
  // claim covers the whole block: a later cursor inside it would otherwise see
  // "already the target type" and toggle the freshly converted list back off.
  pointMainAt(view, rangeIndex);
  const claimFrom = getListBlockBounds(view)?.from ?? info.lineStart;
  convertListBlock(view, target);
  return { changed: true, claimFrom };
}

/** Indent, outdent, and removal — structure changes needing an existing item. */
function adjustListStructure(
  view: EditorView,
  action: "indent" | "outdent" | "removeList",
  info: ListItemInfo,
): boolean {
  switch (action) {
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

/**
 * Point the selection's MAIN range at `rangeIndex` without touching the others.
 * Replacing the selection with a lone cursor here would dissolve the
 * multi-selection mid-loop.
 */
function pointMainAt(view: EditorView, rangeIndex: number): void {
  const { selection } = view.state;
  if (selection.mainIndex === rangeIndex) return;
  view.dispatch({ selection: EditorSelection.create([...selection.ranges], rangeIndex) });
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

/**
 * Turn the list off by ONE level.
 *
 * A NESTED item outdents into its parent list; only a top-level item leaves the
 * list altogether. That is what WYSIWYG does and what VMark documents — full
 * removal is the separate Remove List action. Unlisting a nested item outright
 * lost the nesting and split the parent list around the freed line.
 *
 * `outdentListItem` reports false at the outermost level, which is exactly the
 * "nothing left to outdent, so unlist" case.
 */
function toggleListOff(view: EditorView, info: ListItemInfo): void {
  if (!outdentListItem(view, info)) removeList(view, info);
}
