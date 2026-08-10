/**
 * Source Editor Focus & Restore
 *
 * Purpose: the "come back to where I was" step the CodeMirror source editor
 * runs in BOTH its mount and hidden→visible paths — focus, restore, then
 * consume any pending navigation. Extracted from SourceEditor.tsx, which had
 * the two paths written out separately and drifting: only the mount path had a
 * no-cursor branch, and that branch scrolled to the top.
 *
 * Key decisions:
 *   - A cursor still wins. It carries the WYSIWYG↔Source position mapping, so
 *     overriding it with a raw pixel offset would break mode-switch sync.
 *   - With no cursor the reader has only been READING, and the remembered
 *     scroll offset is the only record of where (#1249). Nothing remembered
 *     means a first open, which lands at the top.
 *   - The old no-cursor branch dispatched `selection: {anchor: 0}` with
 *     `scrollIntoView` — that IS the jump-to-top. The selection half was a
 *     no-op anyway: a freshly created EditorState already sits at offset 0.
 *   - Pending navigation is consumed FIRST and short-circuits the rest. A lint
 *     or Find-in-Files jump already won under the old ordering (it ran last and
 *     overrode the restore), but the reading-position restore watches the
 *     container for up to ~1.5s while late content settles — so "override it
 *     afterwards" would now become a tug of war. The WYSIWYG side has always
 *     been ordered this way (`consumeWysiwygPendingNav` gates the call).
 *
 * @coordinates-with SourceEditor.tsx — mount + hidden→visible paths
 * @coordinates-with services/editor/scrollPosition.ts — the offset store
 * @coordinates-with utils/cursorSync/codemirror.ts — cursor restoration
 * @module components/Editor/sourceFocusRestore
 */

import type { EditorView } from "@codemirror/view";
import type { CursorInfo } from "@/types/cursorSync";
import { restoreCursorInCodeMirror } from "@/utils/cursorSync/codemirror";
import {
  getEditorScrollOffset,
  restoreEditorScroll,
} from "@/services/editor/scrollPosition";
import { consumeSourcePendingNav } from "./sourcePendingNav";

/** Focus `view` and put it back where this tab left off. */
export function focusAndRestoreSource(
  view: EditorView,
  tabId: string | undefined,
  cursorInfo: CursorInfo | null,
): void {
  view.focus();
  if (consumeSourcePendingNav(view, tabId)) return;
  if (cursorInfo) {
    restoreCursorInCodeMirror(view, cursorInfo);
  } else {
    restoreEditorScroll(view.scrollDOM, getEditorScrollOffset(tabId, "source") ?? 0);
  }
}
