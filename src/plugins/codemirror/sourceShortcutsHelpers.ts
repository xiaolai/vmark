/**
 * Source Mode Shortcut Helpers
 *
 * Purpose: the handlers `buildSourceShortcutKeymap()` binds directly, because
 * they are NOT document mutations — find/search navigation and copy-as-HTML.
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
import { useUIStore } from "@/stores/uiStore";
import { useEditorStore } from "@/stores/editorStore";
import { performSourceToolbarAction } from "@/plugins/toolbarActions/sourceAdapter";
import { getSourceMultiSelectionContext } from "@/plugins/toolbarActions/multiSelectionContext";
import { exportError } from "@/utils/debug";

/** Internal: shared by the surviving helpers, not a public API. */
function buildSourceContext(view: EditorView) {
  const cursorContext = useEditorStore.getState().source.context;
  const multiSelection = getSourceMultiSelectionContext(view, cursorContext);
  return {
    surface: "source" as const,
    view,
    context: cursorContext,
    multiSelection,
  };
}

/**
 * A CodeMirror command running a toolbar action directly on the source adapter.
 *
 * DELIBERATELY UNUSED by production. It bypasses the executor's format and
 * capability gates, unified cross-mode undo, and IME-safe dispatch, so a
 * keystroke bound through here would not match the same action invoked from
 * the menu. `unlink` was the last such binding, until `editor.unlink` existed
 * (WI-2.1). Kept as the named adapter entry point, and gated so a new caller
 * has to argue for itself.
 */
export function runSourceAction(action: string) {
  return (view: EditorView) => {
    performSourceToolbarAction(action, buildSourceContext(view));
    return true;
  };
}

// --- Navigation helpers (no document mutation) ---

/** Opens the find/replace bar via the search store. */
export function openFindBar(): boolean {
  useUIStore.getState().searchOpen();
  return true;
}

/** Navigates to the next search match if the find bar is open. */
export function findNextMatch(_view: EditorView): boolean {
  const root = useUIStore.getState();
  if (!root.search.isOpen || root.search.matchCount === 0) return false;
  root.searchFindNext();
  return true;
}

/** Navigates to the previous search match if the find bar is open. */
export function findPreviousMatch(_view: EditorView): boolean {
  const root = useUIStore.getState();
  if (!root.search.isOpen || root.search.matchCount === 0) return false;
  root.searchFindPrevious();
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
