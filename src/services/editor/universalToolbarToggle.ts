/**
 * The one way to show or hide the Universal Toolbar (#1204, #1711).
 *
 * The View menu item and its accelerator are one command, so both must
 * show the bar on the first invocation and hide it on the second. The
 * document tabs live in the StatusBar, so opening the toolbar must not
 * take that strip: it closes the FindBar (which had hidden the StatusBar)
 * and gives the strip back. A StatusBar the reader hid themselves stays
 * hidden, because that path never saved a value to restore.
 *
 * @coordinates-with hooks/useUniversalToolbar.ts — the keyboard entry point
 * @coordinates-with services/commands/viewCommands.ts — the menu entry point
 * @coordinates-with components/Editor/UniversalToolbar/useToolbarSession.ts — re-exports focusActiveEditor
 * @module services/editor/universalToolbarToggle
 */
import { useEditorStore } from "@/stores/editorStore";
import { selectSourceEditing } from "@/stores/selectSourceEditing";
import { useUIStore } from "@/stores/uiStore";

/** Focus whichever editor surface (Source or WYSIWYG) is active. */
export function focusActiveEditor(): void {
  const isSource = selectSourceEditing(useUIStore.getState());
  if (isSource) {
    useEditorStore.getState().source.editorView?.focus();
    return;
  }
  useEditorStore.getState().tiptap.editorView?.focus();
}

/**
 * Show the toolbar, or hide it if it is already showing.
 * Safe to call from any surface — it reads current state itself.
 */
export function toggleUniversalToolbar(): void {
  const ui = useUIStore.getState();
  if (ui.universalToolbarVisible) {
    focusActiveEditor();
    ui.clearToolbarSession();
    return;
  }
  // FindBar hides the StatusBar while it is open. Closing it from here
  // does not run FindBar's own close handler, so restore explicitly.
  useUIStore.getState().searchClose();
  useUIStore.getState().restoreStatusBar();
  useUIStore.getState().toggleUniversalToolbar();
}
