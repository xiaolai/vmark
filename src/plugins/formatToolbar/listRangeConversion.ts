/**
 * Range-aware list conversion (WI-3, audit-followups 20260729).
 *
 * `toggleListType`'s cursor path converts only the list under `$from`; this
 * module handles RANGE selections: every bullet/ordered list intersecting
 * the selection converts to the target type, covered plain textblocks are
 * wrapped into the target list, and adjacent same-type lists (including
 * pre-existing neighbours just outside the range) are joined so ordered
 * numbering stays continuous. Everything happens in ONE transaction — one
 * undo step.
 *
 * Mechanics worth naming:
 *   - `setNodeMarkup` is size-preserving, so all conversions use original
 *     positions with no mapping.
 *   - Each covered textblock is wrapped as its own single-item list (reverse
 *     document order keeps earlier positions valid); the join pass then
 *     merges the runs — reproducing wrapInList's one-item-per-paragraph
 *     shape without its separate-command dispatch.
 *   - `checked` attrs are cleared on every converted list's items: checkbox
 *     state makes no sense on an ordered list, and converting a task list
 *     to "plain bullet" mirrors the cursor path's behavior.
 *
 * @coordinates-with nodeActions.tiptap.ts — toggleListType delegates range selections here
 * @module plugins/formatToolbar/listRangeConversion
 */

import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { canJoin, findWrapping } from "@tiptap/pm/transform";

type ListTypeName = "bulletList" | "orderedList";

function isListNode(node: PMNode): boolean {
  return node.type.name === "bulletList" || node.type.name === "orderedList";
}

/** Convert one list node in place, clearing task checks on its direct items. */
export function convertListNode(tr: Transaction, pos: number, list: PMNode, targetName: ListTypeName): void {
  const targetType = tr.doc.type.schema.nodes[targetName];
  /* v8 ignore next -- @preserve defensive: schema always has both list types */
  if (!targetType) return;
  if (list.type.name !== targetName) {
    tr.setNodeMarkup(pos, targetType, list.attrs);
  }
  list.forEach((item, offset) => {
    const checked = item.attrs.checked as unknown;
    if (checked === true || checked === false) {
      tr.setNodeMarkup(pos + 1 + offset, undefined, { ...item.attrs, checked: null });
    }
  });
}

/**
 * Join same-type lists that touch, anywhere near the affected span (the
 * span is padded so a converted list connects with a pre-existing neighbour
 * just outside the selection). Boundaries are joined in descending order so
 * earlier positions stay valid, and only list↔list boundaries are joined.
 */
export function joinTouchingLists(
  tr: Transaction,
  targetName: ListTypeName,
  spanFrom: number,
  spanTo: number
): void {
  const boundaries = new Set<number>();
  tr.doc.nodesBetween(
    Math.max(0, spanFrom - 2),
    Math.min(tr.doc.content.size, spanTo + 2),
    (node, pos) => {
      if (node.type.name === targetName) {
        boundaries.add(pos);
        boundaries.add(pos + node.nodeSize);
      }
      return true;
    }
  );
  for (const boundary of [...boundaries].sort((a, b) => b - a)) {
    if (!canJoin(tr.doc, boundary)) continue;
    const $b = tr.doc.resolve(boundary);
    if ($b.nodeBefore?.type.name === targetName && $b.nodeAfter?.type.name === targetName) {
      tr.join(boundary);
    }
  }
}

/**
 * Wrap one textblock at [start, end] (its interior) into the target list.
 * A block the list item cannot hold directly (heading, code block) is
 * normalized to a paragraph first — the same conversion Tiptap's own list
 * toggle applies. Returns false when the block STILL cannot wrap; the caller
 * aborts the whole conversion rather than dispatching a partial one.
 */
function wrapTextblockAsList(
  tr: Transaction,
  listType: PMNode["type"],
  targetName: ListTypeName,
  start: number,
  end: number
): boolean {
  const attrs = targetName === "orderedList" ? { start: 1 } : undefined;
  const rangeAt = () => {
    const $s = tr.doc.resolve(start);
    const $e = tr.doc.resolve(end);
    return $s.blockRange($e);
  };
  let childRange = rangeAt();
  /* v8 ignore next -- @preserve defensive: a textblock's interior always yields a range */
  if (!childRange) return false;
  let wrappers = findWrapping(childRange, listType, attrs);
  if (!wrappers) {
    const blockPos = start - 1;
    const block = tr.doc.nodeAt(blockPos);
    const paragraphType = tr.doc.type.schema.nodes.paragraph;
    if (!block || !paragraphType || block.type === paragraphType) return false;
    tr.setNodeMarkup(blockPos, paragraphType); // size-preserving
    childRange = rangeAt();
    /* v8 ignore next -- @preserve defensive: normalization keeps the interior resolvable */
    if (!childRange) return false;
    wrappers = findWrapping(childRange, listType, attrs);
    if (!wrappers) return false;
  }
  tr.wrap(childRange, wrappers);
  return true;
}

/** Children of a list item, with nested lists flattened when `deep`. */
function itemChildren(item: PMNode, deep: boolean): PMNode[] {
  const out: PMNode[] = [];
  item.forEach((child) => {
    if (deep && isListNode(child)) {
      child.forEach((nested) => out.push(...itemChildren(nested, true)));
    } else {
      out.push(child);
    }
  });
  return out;
}

/**
 * Lift the children of every selection-covered item out of the OUTERMOST
 * lists intersecting the selection — the range counterpart of the cursor
 * path's liftListItem, which cannot lift across separate list parents.
 * Uncovered head/tail items stay behind as residual lists. `deep` also
 * flattens nested lists inside the lifted items ("remove list" semantics);
 * without it only one level unlists (toggle-off semantics).
 * One transaction; returns whether anything changed.
 */
export function unlistCoveredLists(view: EditorView, deep: boolean): boolean {
  const { state, dispatch } = view;
  const { empty, from, to } = state.selection;
  if (empty) return false;

  const lists: { pos: number; node: PMNode }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (isListNode(node)) {
      lists.push({ pos, node });
      return false; // outermost only — nested lists travel with their items
    }
    return true;
  });
  if (lists.length === 0) return false;

  const tr = state.tr;
  for (const { pos, node } of lists.reverse()) {
    const head: PMNode[] = [];
    const lifted: PMNode[] = [];
    const tail: PMNode[] = [];
    let itemPos = pos + 1;
    node.forEach((item) => {
      const covered = itemPos < to && itemPos + item.nodeSize > from;
      if (covered) lifted.push(...itemChildren(item, deep));
      else (lifted.length === 0 ? head : tail).push(item);
      itemPos += item.nodeSize;
    });
    if (lifted.length === 0) continue;
    const replacement: PMNode[] = [];
    if (head.length) replacement.push(node.type.create(node.attrs, head));
    replacement.push(...lifted);
    if (tail.length) replacement.push(node.type.create(node.attrs, tail));
    tr.replaceWith(pos, pos + node.nodeSize, replacement);
  }

  if (!tr.docChanged) return false;
  dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

/**
 * Convert everything a range selection touches to the target list type.
 * When every intersecting list is ALREADY the target type (nothing to
 * convert or wrap), toggles OFF instead — lifting the covered items of every
 * intersecting list, not just the one under `$from`.
 * Returns false when the selection is a cursor or nothing was convertible.
 */
export function convertRangeToListType(view: EditorView, targetName: ListTypeName): boolean {
  const { state, dispatch } = view;
  const { $from, $to, empty, from, to } = state.selection;
  if (empty) return false;

  const range = $from.blockRange($to);
  if (!range) return false;

  const listType = state.schema.nodes[targetName];
  /* v8 ignore next -- @preserve defensive: schema always has both list types */
  if (!listType) return false;

  const tr = state.tr;

  // 1. Convert every intersecting list (any depth) in place, and collect the
  //    covered textblocks OUTSIDE lists — at their actual parent depth, so a
  //    paragraph inside a covered blockquote wraps too, not only direct
  //    children of the shared range parent.
  const wrapTargets: { start: number; end: number }[] = [];
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (isListNode(node)) {
      convertListNode(tr, pos, node, targetName);
      return true; // still visit nested lists — they convert at their own level
    }
    if (node.isTextblock) {
      // Skip list content (already handled by conversion) and blocks that
      // can never live inside a listItem, like a details summary — wrapping
      // or normalizing those would corrupt their parent.
      if (parent && parent.type.name !== "listItem" && node.type.name !== "detailsSummary") {
        wrapTargets.push({ start: pos + 1, end: pos + 1 + node.content.size });
      }
      return false;
    }
    return true;
  });

  // 2. Wrap the collected textblocks each as a single-item target list, in
  //    reverse order (earlier positions stay valid). All-or-nothing: one
  //    unwrappable block aborts the whole conversion — a partially converted
  //    range is worse than an honest no-op.
  for (const { start, end } of wrapTargets.reverse()) {
    if (!wrapTextblockAsList(tr, listType, targetName, start, end)) return false;
  }

  // Nothing converted or wrapped: the range is already entirely the target
  // type — toggle OFF across every covered list.
  if (!tr.docChanged) return unlistCoveredLists(view, false);

  // 3. Join same-type lists that now touch (padded span connects converted
  //    lists with pre-existing neighbours outside the selection).
  joinTouchingLists(tr, targetName, tr.mapping.map(from), tr.mapping.map(to, -1));

  dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}
