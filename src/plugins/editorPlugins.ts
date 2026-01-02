/**
 * Editor Plugins
 *
 * Custom ProseMirror plugins for the Milkdown editor.
 * Extracted from Editor.tsx to keep file size manageable.
 */

import { Plugin, PluginKey, Selection } from "@milkdown/kit/prose/state";
import { keymap } from "@milkdown/kit/prose/keymap";
import { $prose } from "@milkdown/kit/utils";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useUIStore } from "@/stores/uiStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getCursorInfoFromProseMirror } from "@/utils/cursorSync/prosemirror";

/**
 * Delay (ms) before enabling cursor tracking to allow restoration to complete.
 */
export const CURSOR_TRACKING_DELAY_MS = 200;

/**
 * Plugin key for cursor tracking plugin.
 */
export const cursorSyncPluginKey = new PluginKey("cursorSync");

/**
 * Keymap plugin to override Milkdown's default Mod-Shift-b (blockquote toggle).
 * Instead, this shortcut toggles the sidebar.
 */
export const overrideKeymapPlugin = $prose(() =>
  keymap({
    "Mod-Shift-b": () => {
      useUIStore.getState().toggleSidebar();
      return true;
    },
  })
);

/**
 * ProseMirror plugin to track cursor position for mode synchronization.
 * Stores cursor info in the document store (per-window) so it can be
 * restored when switching between WYSIWYG and Source modes.
 */
export const cursorSyncPlugin = $prose(() => {
  let trackingEnabled = false;
  // Get window label synchronously (Tauri v2)
  const windowLabel = getCurrentWebviewWindow().label;

  // Delay tracking to allow cursor restoration to complete first
  setTimeout(() => {
    trackingEnabled = true;
  }, CURSOR_TRACKING_DELAY_MS);

  return new Plugin({
    key: cursorSyncPluginKey,
    view: () => ({
      update: (view, prevState) => {
        // Skip tracking until restoration is complete
        if (!trackingEnabled) return;
        // Track selection changes
        if (!view.state.selection.eq(prevState.selection)) {
          const cursorInfo = getCursorInfoFromProseMirror(view);
          useDocumentStore.getState().setCursorInfo(windowLabel, cursorInfo);
        }
      },
    }),
  });
});

/**
 * Plugin key for blank document focus plugin.
 */
export const blankDocFocusPluginKey = new PluginKey("blankDocFocus");

/**
 * Check if document is blank (single empty paragraph).
 */
function isBlankDocument(doc: { childCount: number; firstChild: { isTextblock: boolean; content: { size: number } } | null }): boolean {
  if (doc.childCount !== 1) return false;
  const firstChild = doc.firstChild;
  if (!firstChild || !firstChild.isTextblock) return false;
  return firstChild.content.size === 0;
}

/**
 * Plugin to keep focus on the first block in blank documents.
 * When clicking outside content in an empty document, focuses the editor
 * and places cursor at the start of the first paragraph.
 */
export const blankDocFocusPlugin = $prose(() => {
  return new Plugin({
    key: blankDocFocusPluginKey,
    props: {
      handleDOMEvents: {
        // Handle clicks on the editor root that miss the content
        mousedown: (view, event) => {
          // Only handle clicks directly on the editor root, not on content
          const target = event.target as HTMLElement;
          const editorDom = view.dom;

          // If click is on the editor dom itself (not a child), it's outside content
          if (target !== editorDom) return false;

          // Only apply for blank documents
          if (!isBlankDocument(view.state.doc)) return false;

          // Prevent default to avoid blur
          event.preventDefault();

          // Focus and place cursor at start of first paragraph
          view.focus();
          const { tr } = view.state;
          // Position 1 is inside the first paragraph (position 0 is before it)
          const selection = Selection.near(view.state.doc.resolve(1));
          view.dispatch(tr.setSelection(selection));

          return true;
        },
      },
    },
  });
});
