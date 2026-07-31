/**
 * List toggle strategies for the format toolbar.
 *
 * Purpose: implements the bullet/ordered toggle as three focused strategies —
 * range conversion, nearest-ancestor toggling, and block wrapping — tried in
 * that order. Each reports whether it APPLIES separately from whether it
 * CHANGED the document; the old single dispatcher folded both meanings into
 * one boolean, so a strategy that failed looked identical to one that never
 * applied.
 *
 * Key decisions:
 *   - The RANGE strategy handles selections spanning several items. A range
 *     inside ONE item declines, falling to the cursor semantics — as does a
 *     range the conversion leaves unchanged (already the target type)
 *   - The ANCESTOR strategy toggles the nearest enclosing list: task → plain
 *     for the bullet button, convert for the opposite type, or lift ONE level
 *     when already the plain target (full removal is the "remove list" action)
 *   - A HEADING is flattened and wrapped in ONE transaction: `wrapInList`
 *     refuses a heading outright, and dispatching the flatten separately made
 *     two undo steps — plus a stray flattened paragraph when the wrap then
 *     failed. Nothing is dispatched unless the whole conversion succeeds
 *
 * @coordinates-with nodeActions.tiptap.ts — the exported handlers delegate here
 * @coordinates-with listRangeConversion.ts — range strategy implementation
 * @coordinates-with sourceContextDetection/listDetection.ts — Source counterpart
 * @module plugins/formatToolbar/listToggle
 */

import type { Attrs, NodeType } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { liftListItem, wrapInList, wrapRangeInList } from "@tiptap/pm/schema-list";
import { selectionWithinOneListItem } from "@/plugins/shared/listHelpers";
import { convertListNode, convertRangeToListType, joinTouchingLists } from "./listRangeConversion";

export type ListTypeName = "bulletList" | "orderedList";

/**
 * Whether a strategy applies to the current selection, kept separate from
 * whether it changed the document. `{ applies: false }` means "try the next
 * strategy"; `{ applies: true, changed: false }` means "this was the right
 * strategy and it FAILED", which must not be retried as something else.
 */
type StrategyResult = { applies: false } | { applies: true; changed: boolean };

const NOT_APPLICABLE: StrategyResult = { applies: false };

/**
 * Shared toggle: convert to `target`, wrap in it, task → plain when already a
 * task list, or lift one level when already the plain target type.
 */
export function toggleListType(view: EditorView, target: ListTypeName): boolean {
  const ranged = toggleAcrossRange(view, target);
  if (ranged.applies) return ranged.changed;

  const ancestor = toggleAncestorList(view, target);
  if (ancestor.applies) {
    view.focus();
    return ancestor.changed;
  }

  const wrapped = wrapBlockInList(view, target);
  view.focus();
  return wrapped;
}

/**
 * Range strategy: a selection spanning SEVERAL items honours the full range —
 * every intersecting list converts, covered paragraphs wrap, adjacent
 * same-type lists join (WI-3). A no-op conversion declines so the cursor
 * semantics handle a range that is already the target type.
 */
function toggleAcrossRange(view: EditorView, target: ListTypeName): StrategyResult {
  const { state } = view;
  if (state.selection.empty || selectionWithinOneListItem(state)) return NOT_APPLICABLE;
  return convertRangeToListType(view, target) ? { applies: true, changed: true } : NOT_APPLICABLE;
}

/** Cursor strategy: toggle, convert, or de-task the nearest enclosing list. */
function toggleAncestorList(view: EditorView, target: ListTypeName): StrategyResult {
  const { state } = view;
  const { $from } = state.selection;
  const other: ListTypeName = target === "bulletList" ? "orderedList" : "bulletList";

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === target) {
      // A task list renders as a bulletList with checked items: the bullet
      // button converts it to a PLAIN bullet list rather than unlisting.
      if (target === "bulletList" && clearTaskChecks(view, d)) {
        return { applies: true, changed: true };
      }
      // Toggle off ONE level: top-level lists unlist; nested lists outdent
      // into the parent list (full removal is the "remove list" action).
      const listItemType = state.schema.nodes.listItem;
      /* v8 ignore next -- @preserve defensive: VMark's schema always has listItem */
      if (!listItemType) return { applies: true, changed: false };
      return { applies: true, changed: liftListItem(listItemType)(view.state, view.dispatch) };
    }
    if (node.type.name === other) {
      return { applies: true, changed: convertListType(view, d, target) };
    }
  }
  return NOT_APPLICABLE;
}

/** Wrap strategy: the cursor's block is not in a list — wrap it in one. */
function wrapBlockInList(view: EditorView, target: ListTypeName): boolean {
  const { state, dispatch } = view;
  const listType = state.schema.nodes[target];
  if (!listType) return false;
  const attrs = target === "orderedList" ? { start: 1 } : null;

  const headed = wrapHeadingInList(view, listType, attrs);
  if (headed.applies) return headed.changed;

  return wrapInList(listType, attrs)(state, dispatch);
}

/**
 * Flatten the heading at the cursor and wrap it in ONE transaction.
 *
 * `wrapInList` refuses a heading, so the button silently did nothing on
 * `### Title`. A line cannot be a heading and a list item at once, so the
 * heading has to go — but flattening in its own dispatched transaction made
 * two undo steps and, when the wrap then failed, left a stray paragraph.
 * Nothing is dispatched here unless the wrap succeeds.
 */
function wrapHeadingInList(
  view: EditorView,
  listType: NodeType,
  attrs: Attrs | null,
): StrategyResult {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const paragraphType = state.schema.nodes.paragraph;
  /* v8 ignore next -- @preserve defensive: VMark's schema always has paragraph */
  if (!paragraphType) return NOT_APPLICABLE;

  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== "heading") continue;
    const tr = state.tr.setBlockType($from.before(d), $from.after(d), paragraphType);
    // setBlockType is size-preserving, so the original selection positions
    // stay valid on the flattened doc.
    const range = tr.doc
      .resolve(state.selection.from)
      .blockRange(tr.doc.resolve(state.selection.to));
    if (!range || !wrapRangeInList(tr, range, listType, attrs)) {
      return { applies: true, changed: false };
    }
    if (dispatch) dispatch(tr.scrollIntoView());
    return { applies: true, changed: true };
  }
  return NOT_APPLICABLE;
}

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
