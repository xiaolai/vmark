/**
 * Editor Restore Choice — decides whether a surface coming on screen puts its
 * tab back by the remembered scroll offset or by the cursor.
 *
 * Why this exists (#1556): the cursor used to win every restore it was present
 * for. A caret is placed once, by a click, and then stays put while the reader
 * scrolls on — so every tab switch snapped the document back to that one
 * caret, a fixed place per document however far it had been read.
 *
 * Key decisions:
 *   - The deciding fact is whether the SAME surface is coming back. Returning
 *     to the surface the tab was last shown on (a tab switch, a remount) means
 *     its remembered pixels are the reader's own last view: they win, and the
 *     caret is put back without scrolling to it. A different surface (a
 *     WYSIWYG↔Source toggle, split on/off) has pixels that mean nothing here,
 *     and the cursor wins because it carries the position mapping.
 *   - No cursor is unchanged from #1249: the remembered offset, or the top.
 *   - When a surface change hands the view to the cursor, that surface's old
 *     offset is dropped. A caret already in view scrolls nothing, records
 *     nothing, and would leave the old pixels to be "restored" on the next tab
 *     switch — to a place the reader has not seen since.
 *   - A pending lint / Find-in-Files jump owns the viewport and skips the
 *     restore, so it records the surface it showed through `noteEditorJump`;
 *     otherwise the next return would wrongly read as a surface change.
 *   - A plain module map, like `scrollPosition.ts`: nothing renders from it.
 *     `cleanupTabState` forgets the tab on close.
 *
 * @coordinates-with scrollPosition.ts — the offsets the choice reads and drops
 * @coordinates-with tiptapFocus.ts — WYSIWYG restore
 * @coordinates-with components/Editor/sourceFocusRestore.ts — Source restore
 * @coordinates-with services/windowClose/tabCleanup.ts — forgets a closed tab
 * @module services/editor/restoreChoice
 */

import {
  clearEditorScrollOffsets,
  getEditorScrollOffset,
  type EditorSurface,
} from "./scrollPosition";

/** How a surface puts its tab back: by the remembered offset, or by the cursor. */
export type RestoreBy = "scroll" | "cursor";

/** The surface each tab was last shown on. */
const shownSurfaceByTab = new Map<string, EditorSurface>();

/**
 * Record that `surface` now shows `tabId`, and report whether it already did.
 * A caret placed on a surface change makes that surface's old offset stale.
 */
function claimSurface(tabId: string, surface: EditorSurface, placesCaret: boolean): boolean {
  const returning = shownSurfaceByTab.get(tabId) === surface;
  shownSurfaceByTab.set(tabId, surface);
  if (!returning && placesCaret) clearEditorScrollOffsets(tabId, surface);
  return returning;
}

/** Decide how `surface`, coming on screen, puts `tabId` back — and record that it did. */
export function chooseEditorRestore(
  tabId: string | null | undefined,
  surface: EditorSurface,
  hasCursor: boolean,
): RestoreBy {
  if (!hasCursor) {
    if (tabId) claimSurface(tabId, surface, false);
    return "scroll";
  }
  if (!tabId) return "cursor";
  const returning = claimSurface(tabId, surface, true);
  return returning && getEditorScrollOffset(tabId, surface) !== undefined ? "scroll" : "cursor";
}

/** A navigation jump showed `surface` for `tabId` instead of a restore. */
export function noteEditorJump(tabId: string | null | undefined, surface: EditorSurface): void {
  if (tabId) claimSurface(tabId, surface, true);
}

/** Forget which surface a tab was shown on (called on tab close/detach). */
export function forgetShownEditorSurface(tabId: string): void {
  shownSurfaceByTab.delete(tabId);
}
