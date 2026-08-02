/**
 * Source Mode Shortcut Helpers
 *
 * Purpose: the four handlers `buildSourceShortcutKeymap()` binds directly,
 * because none of them mutates the document — find/search navigation and
 * copy-as-HTML.
 * Everything that changes the document goes through `runEditorAction`, and
 * `__tests__/dispatchBoundary.test.ts` gates that.
 *
 * This file used to export 24 functions of which production imported five. The
 * other 19 were parallel reimplementations of heading, list, blockquote, CJK,
 * text-transform and line operations that the action system had already taken
 * over — dead in production, kept alive only by their own tests, and free to
 * drift from the implementations users actually reached (WI-2.1).
 *
 * @coordinates-with plugins/codemirror/sourceShortcuts.ts — consumes these helpers
 * @coordinates-with plugins/codemirror/__tests__/dispatchBoundary.test.ts — the gate
 * @module plugins/codemirror/sourceShortcutsHelpers
 */

import type { EditorView } from "@codemirror/view";
import { hostSearch } from "@/plugins/shared/hostSearch";
import { exportError } from "@/utils/debug";



// --- Navigation helpers (no document mutation) ---

/** Opens the find/replace bar via the search store. */
export function openFindBar(): boolean {
  hostSearch.open();
  return true;
}

/** Navigates to the next search match if the find bar is open. */
export function findNextMatch(_view: EditorView): boolean {
  const search = hostSearch.current();
  if (!search.isOpen || search.matchCount === 0) return false;
  hostSearch.findNext();
  return true;
}

/** Navigates to the previous search match if the find bar is open. */
export function findPreviousMatch(_view: EditorView): boolean {
  const search = hostSearch.current();
  if (!search.isOpen || search.matchCount === 0) return false;
  hostSearch.findPrevious();
  return true;
}

// --- Copy as HTML (reads the document, never writes) ---

/** Copies the current selection (or full document) as rendered HTML. */
export function copySelectionAsHtml(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const markdown =
    from === to ? view.state.doc.toString() : view.state.doc.sliceString(from, to);

  // Dynamic import to avoid loading exportStyles.css at startup.
  void import("@/export/useExportOperations")
    .then(({ copyAsHtml }) => copyAsHtml(markdown))
    .catch((error) => exportError("CopyAsHtml failed:", error));
  return true;
}
