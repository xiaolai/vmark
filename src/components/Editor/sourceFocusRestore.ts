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
 *   - Cursor or reading position is `restoreChoice.ts`'s call (#1556). On a
 *     return to Source the caret goes back WITHOUT scrolling and the remembered
 *     offset is restored; on a switch from WYSIWYG the cursor wins, because it
 *     carries the position mapping and the pixels would break mode-switch sync.
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
 *   - `takeFocus` false restores WITHOUT focusing. In a two-document split only
 *     the focused pane may take DOM focus: the split tracks DOM focus as the
 *     focused pane, so a background pane focusing itself on mount moved the
 *     pane focus — the edge of the #1554 loop. It still gets its position back.
 *   - Both paths schedule through `scheduleSourceFocusRestore`, which marks the
 *     view restore-pending until the restore has run or been cancelled: the
 *     caret before it is not the reader's, and the bridge must not read the
 *     restore moving it as the reader moving the selection.
 *
 * @coordinates-with SourceEditor.tsx — mount + hidden→visible paths
 * @coordinates-with services/editor/scrollPosition.ts — the offset store
 * @coordinates-with services/editor/restoreChoice.ts — cursor or reading position
 * @coordinates-with utils/cursorSync/codemirror.ts — cursor restoration
 * @coordinates-with services/editor/caretRestorePending.ts — the pending mark
 * @module components/Editor/sourceFocusRestore
 */

import type { EditorView } from "@codemirror/view";
import type { CursorInfo } from "@/types/cursorSync";
import { restoreCursorInCodeMirror } from "@/utils/cursorSync/codemirror";
import {
  getEditorScrollOffset,
  restoreEditorScroll,
} from "@/services/editor/scrollPosition";
import { chooseEditorRestore } from "@/services/editor/restoreChoice";
import { beginCaretRestore } from "@/services/editor/caretRestorePending";
import { consumeSourcePendingNav } from "./sourcePendingNav";

/** Focus `view` (unless `takeFocus` is false) and put it back where this tab left off. */
export function focusAndRestoreSource(
  view: EditorView,
  tabId: string | undefined,
  cursorInfo: CursorInfo | null,
  takeFocus = true,
): void {
  if (takeFocus) view.focus();
  if (consumeSourcePendingNav(view, tabId)) return;
  const by = chooseEditorRestore(tabId, "source", cursorInfo !== null);
  if (cursorInfo) {
    restoreCursorInCodeMirror(view, cursorInfo, by === "cursor");
    if (by === "cursor") return;
  }
  restoreEditorScroll(view.scrollDOM, getEditorScrollOffset(tabId, "source") ?? 0);
}

/** How long after a mount or show the Source restore runs: the view lays out first. */
const SOURCE_RESTORE_DELAY_MS = 50;

/**
 * Run `restore` once the view has laid out after a mount or show, the view
 * marked restore-pending until it has run (or thrown) or been cancelled.
 * Returns the cancel, for an unmount that must drop it.
 */
export function scheduleSourceFocusRestore(view: EditorView, restore: () => void): () => void {
  const settle = beginCaretRestore(view);
  const id = setTimeout(() => {
    try {
      restore();
    } finally {
      settle();
    }
  }, SOURCE_RESTORE_DELAY_MS);
  return () => {
    clearTimeout(id);
    settle();
  };
}
