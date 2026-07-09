/**
 * Composed source "unlink" — removes any link form at the cursor.
 *
 * Purpose: `unlinkAtCursor` (sourceImageActions.ts) handles inline
 * markdown links and wiki links; reference links ([text][label] and the
 * collapsed [text][]) were silently ignored, leaving the context menu's
 * "Remove Link" a no-op on them (audit finding, round 1). This wrapper
 * tries the existing path first, then unwraps reference links to their
 * visible text. `sourceAdapter`'s "unlink" case dispatches here.
 *
 * @coordinates-with utils/markdownLinkPatterns.ts — reference-link finder
 * @coordinates-with sourceImageActions.ts — inline/wiki unlink
 * @module plugins/toolbarActions/sourceUnlink
 */

import type { EditorView } from "@codemirror/view";
import { findReferenceLinkAtPosition } from "@/utils/markdownLinkPatterns";
import { unlinkAtCursor } from "./sourceImageActions";

/** Remove the link at the cursor (inline, wiki, or reference form),
 *  preserving its visible text. Returns false when not on a link. */
export function removeSourceLinkAtCursor(view: EditorView): boolean {
  if (unlinkAtCursor(view)) return true;

  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const ref = findReferenceLinkAtPosition(line.text, line.from, from);
  if (!ref) return false;

  view.dispatch({
    changes: { from: ref.from, to: ref.to, insert: ref.text },
    selection: { anchor: ref.from + ref.text.length },
  });
  view.focus();
  return true;
}
