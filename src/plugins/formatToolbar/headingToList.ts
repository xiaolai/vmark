/**
 * Flatten a heading so it can become a list item.
 *
 * Purpose: `wrapInList` refuses to wrap a heading, so "Bullet List" pressed on
 * `### Title` silently did nothing in WYSIWYG while Source mode replaced the `#`
 * run and made the list. A line cannot be a heading and a list item at once, so
 * the heading has to go — this is the one place that decides that.
 *
 * @coordinates-with nodeActions.tiptap.ts — the list toggles that call this
 * @coordinates-with sourceContextDetection/listDetection.ts — the Source counterpart
 * @module plugins/formatToolbar/headingToList
 */
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Turn the heading at the cursor into a paragraph, returning the resulting state
 * (or null when the cursor is not in a heading, so the caller keeps its own).
 */
export function flattenHeadingForList(view: EditorView): EditorState | null {
  const { state } = view;
  const { $from } = state.selection;
  const paragraphType = state.schema.nodes.paragraph;
  if (!paragraphType) return null;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name !== "heading") continue;
    const tr = state.tr.setBlockType($from.before(d), $from.after(d), paragraphType);
    view.dispatch(tr);
    return view.state;
  }
  return null;
}
