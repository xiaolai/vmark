/**
 * Format Toolbar Node Actions
 *
 * Purpose: Provides manipulation actions for block-level nodes
 * (lists, blockquotes) used by the format toolbar in WYSIWYG mode.
 *
 * Key decisions:
 *   - List operations use ProseMirror schema-list commands for correct nesting behavior
 *   - All list types (bullet, ordered, task) share the same indent/outdent logic
 *   - Toggling the active list type lifts ONE level (nested lists outdent, not flatten);
 *     full unlisting is the explicit "remove list" action
 *   - Outdent removes one level of NESTING and declines at the outermost level,
 *     matching Source mode; leaving a list is Remove List or a toggle
 *   - Every handler returns whether it changed the document, and the value is
 *     the underlying ProseMirror command result — callers must not report a
 *     no-op as handled
 *   - Blockquote nest/unnest are symmetric: both operate on the WHOLE nearest
 *     quote's inner range, never just the block under the cursor
 *
 * @coordinates-with tiptapContext.ts — format toolbar context building
 * @coordinates-with shared/listHelpers.ts — shared repeated-lift primitive
 * @module plugins/formatToolbar/nodeActions.tiptap
 */

import type { EditorView } from "@tiptap/pm/view";
import { liftTarget } from "@tiptap/pm/transform";
import { liftListItem, sinkListItem, wrapInList } from "@tiptap/pm/schema-list";
import { liftSelectionOutOfLists } from "@/plugins/shared/listHelpers";
import {
  convertListNode,
  convertRangeToListType,
  joinTouchingLists,
  unlistCoveredLists,
} from "./listRangeConversion";

/** Indents (sinks) the current list item one level deeper. */
export function handleListIndent(view: EditorView): boolean {
  const listItemType = view.state.schema.nodes.listItem;
  if (!listItemType) return false;
  view.focus();
  return sinkListItem(listItemType)(view.state, view.dispatch);
}

/**
 * Outdents the current list item one nesting level.
 *
 * Refuses at the OUTERMOST level rather than lifting the item out of the list
 * entirely. "Outdent" means remove one level of nesting, and at the top there is
 * none to remove; VMark already has Remove List and the list toggles for leaving
 * a list, so using this command as a third, implicit unlist blurs the action
 * model. Source mode has always declined here — `liftListItem` was the only
 * reason the two surfaces disagreed.
 */
export function handleListOutdent(view: EditorView): boolean {
  const listItemType = view.state.schema.nodes.listItem;
  if (!listItemType) return false;
  if (!isNestedListItem(view)) return false;
  view.focus();
  return liftListItem(listItemType)(view.state, view.dispatch);
}

/** Whether the cursor's list item sits inside another list item. */
function isNestedListItem(view: EditorView): boolean {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name !== "listItem") continue;
    // depth-1 is the enclosing list; depth-2 is what that list sits in.
    return depth >= 3 && $from.node(depth - 2).type.name === "listItem";
  }
  return false;
}

type ListTypeName = "bulletList" | "orderedList";

/**
 * Clear boolean `checked` attrs on the list's direct items (task → plain).
 * Returns true when any item changed.
 */
function clearTaskChecks(view: EditorView, listDepth: number): boolean {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const listNode = $from.node(listDepth);
  const listPos = $from.before(listDepth);
  const tr = state.tr;
  let changed = false;
  listNode.forEach((item, offset) => {
    const checked = item.attrs.checked as unknown;
    if (checked === true || checked === false) {
      tr.setNodeMarkup(listPos + 1 + offset, undefined, { ...item.attrs, checked: null });
      changed = true;
    }
  });
  if (changed) dispatch(tr);
  return changed;
}

/**
 * Shared toggle: convert to `target`, wrap in it, task→plain when already a
 * task list, or lift one level when already the plain target type.
 */
function toggleListType(view: EditorView, target: ListTypeName): boolean {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const other: ListTypeName = target === "bulletList" ? "orderedList" : "bulletList";

  // Range selections honor the FULL range: every intersecting list converts,
  // covered paragraphs wrap, adjacent same-type lists join (WI-3). When the
  // range changes nothing (already the plain target type), fall through to
  // the cursor semantics below — toggle-off still works on a full-list
  // selection.
  if (!state.selection.empty && convertRangeToListType(view, target)) {
    return true;
  }

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === target) {
      // A task list renders as a bulletList with checked items: the bullet
      // button converts it to a PLAIN bullet list rather than unlisting.
      if (target === "bulletList" && clearTaskChecks(view, d)) {
        view.focus();
        return true;
      }
      // Toggle off ONE level: top-level lists unlist; nested lists outdent
      // into the parent list (full removal is the "remove list" action).
      const listItemType = state.schema.nodes.listItem;
      /* v8 ignore next -- @preserve defensive: VMark's schema always has listItem */
      if (!listItemType) return false;
      const lifted = liftListItem(listItemType)(view.state, view.dispatch);
      view.focus();
      return lifted;
    }
    if (node.type.name === other) {
      const converted = convertListType(view, d, target);
      view.focus();
      return converted;
    }
  }

  const listType = state.schema.nodes[target];
  if (!listType) return false;
  const wrapped = wrapInList(listType, target === "orderedList" ? { start: 1 } : undefined)(state, dispatch);
  view.focus();
  return wrapped;
}

/**
 * Converts the current list to a bullet list, wraps the current block in one,
 * converts a task list to a plain bullet list, or — when already in a plain
 * bullet list — lifts one level (toggle off).
 */
export function handleToBulletList(view: EditorView): boolean {
  return toggleListType(view, "bulletList");
}

/**
 * Converts the current list to an ordered list, wraps the current block in one,
 * or — when already in an ordered list — lifts one level (toggle off).
 */
export function handleToOrderedList(view: EditorView): boolean {
  return toggleListType(view, "orderedList");
}

/** Removes all list wrapping from the current selection by repeatedly lifting list items. */
export function handleRemoveList(view: EditorView): boolean {
  // A range can span SEPARATE lists, which the single-range lift below
  // cannot cross — unlist every covered list (nested levels flattened too).
  if (!view.state.selection.empty && unlistCoveredLists(view, true)) {
    return true;
  }
  const lifted = liftSelectionOutOfLists(view);
  view.focus();
  return lifted;
}

function convertListType(view: EditorView, listDepth: number, newListType: ListTypeName): boolean {
  const { state, dispatch } = view;
  const { $from } = state.selection;

  const listNode = $from.node(listDepth);
  const listPos = $from.before(listDepth);
  if (!state.schema.nodes[newListType]) return false;

  // Shared primitives with the range path (one behavior, one implementation):
  // convert in place (checked attrs cleared — checkboxes make no sense after
  // a type conversion), then join type-gated touching neighbours so ordered
  // numbering stays continuous (WI-3).
  const tr = state.tr;
  convertListNode(tr, listPos, listNode, newListType);
  joinTouchingLists(tr, newListType, listPos, listPos + listNode.nodeSize);
  dispatch(tr);
  return true;
}

/**
 * Resolve the complete inner block range of the nearest enclosing blockquote
 * (walking from `innermost ? deepest : shallowest`), or null when the cursor
 * is not inside one.
 */
function nearestBlockquoteInnerRange(view: EditorView, innermost: boolean) {
  const { state } = view;
  const { $from } = state.selection;
  const depths = innermost
    ? Array.from({ length: $from.depth }, (_, i) => $from.depth - i)
    : Array.from({ length: $from.depth }, (_, i) => i + 1);

  for (const d of depths) {
    if ($from.node(d).type.name === "blockquote") {
      const start = $from.before(d) + 1;
      const end = $from.after(d) - 1;
      return state.doc.resolve(start).blockRange(state.doc.resolve(end));
    }
  }
  return null;
}

/** Nests the current blockquote one level deeper by wrapping it in another blockquote. */
export function handleBlockquoteNest(view: EditorView): boolean {
  const { state, dispatch } = view;
  const blockquoteType = state.schema.nodes.blockquote;
  /* v8 ignore next -- @preserve defensive: schema always has blockquote when quotes exist */
  if (!blockquoteType) return false;

  const range = nearestBlockquoteInnerRange(view, true);
  if (!range) return false;

  dispatch(state.tr.wrap(range, [{ type: blockquoteType }]));
  view.focus();
  return true;
}

/**
 * Unnests the current blockquote by lifting its COMPLETE inner range one
 * level — symmetric with nesting, which wraps the whole quote. Lifting only
 * the block under the cursor would split a multi-block quote.
 */
export function handleBlockquoteUnnest(view: EditorView): boolean {
  const { state, dispatch } = view;

  const range = nearestBlockquoteInnerRange(view, true);
  if (!range) return false;
  const target = liftTarget(range);
  /* v8 ignore next -- @preserve defensive: a quote's inner range is always liftable */
  if (target === null) return false;

  dispatch(state.tr.lift(range, target));
  view.focus();
  return true;
}

/** Unwrap the outermost blockquote around the cursor. Returns false when none. */
function removeOutermostBlockquote(view: EditorView): boolean {
  const { state, dispatch } = view;

  const range = nearestBlockquoteInnerRange(view, false);
  if (!range) return false;
  const target = liftTarget(range);
  /* v8 ignore next -- @preserve defensive: a quote's inner range is always liftable */
  if (target === null) return false;

  // A lift step maps positions faithfully, so cursor AND range selections
  // survive through EditorState's automatic selection mapping — no manual
  // cursor arithmetic (the old replaceWith approach collapsed ranges).
  dispatch(state.tr.lift(range, target));
  return true;
}

/** Removes ALL blockquote wrapping from the current position, preserving the selection. */
export function handleRemoveBlockquote(view: EditorView): boolean {
  // Nested quotes leave an inner blockquote after the outer unwrap — repeat
  // until no blockquote ancestor remains. Bounded by the ENTRY depth rather
  // than `while (unwrap())`: a view whose dispatch does not apply
  // transactions (test doubles) would otherwise never observe progress.
  const { $from } = view.state.selection;
  let quoteDepth = 0;
  for (let d = 1; d <= $from.depth; d++) {
    if ($from.node(d).type.name === "blockquote") quoteDepth++;
  }
  let removed = false;
  for (let i = 0; i < quoteDepth; i++) {
    if (!removeOutermostBlockquote(view)) break;
    removed = true;
  }
  view.focus();
  return removed;
}
