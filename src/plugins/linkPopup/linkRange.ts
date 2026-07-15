/**
 * Link-range validation.
 *
 * Purpose: the link popup captures `[from, to)` and the link's href when it
 * opens, then mutates that range when the user saves or removes. The document
 * can change in between (MCP edits, external reload, AI suggestions), which
 * shifts or destroys the range — applying the captured range to the new
 * document would rewrite whatever now occupies those positions.
 *
 * `linkRangeIsIntact` is the guard: it re-checks, against the live state, that
 * the range is still in bounds and still fully covered by a link mark carrying
 * the same href. The same check protects the context menu's "Edit link" entry
 * (see EditorContextMenu/runMenuAction.ts).
 *
 * @coordinates-with LinkPopupView.ts — save/remove call this before dispatching
 * @module plugins/linkPopup/linkRange
 */

import type { EditorState } from "@tiptap/pm/state";

/**
 * True when `[from, to)` is in bounds and every text node inside it carries a
 * link mark whose href equals `href`.
 */
export function linkRangeIsIntact(
  state: EditorState,
  from: number,
  to: number,
  href: string
): boolean {
  const linkType = state.schema.marks.link;
  if (!linkType) return false;
  if (from < 0 || to <= from || to > state.doc.content.size) return false;

  let covered = 0;
  let matches = true;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!matches) return false;
    if (!node.isText) return true;
    const mark = linkType.isInSet(node.marks);
    if (!mark || (mark.attrs.href ?? "") !== href) {
      matches = false;
      return false;
    }
    covered += Math.min(to, pos + node.nodeSize) - Math.max(from, pos);
    return true;
  });

  return matches && covered === to - from;
}
