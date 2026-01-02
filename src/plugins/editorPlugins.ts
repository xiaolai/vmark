/**
 * Editor Plugins
 *
 * Custom ProseMirror plugins for the Milkdown editor.
 * Extracted from Editor.tsx to keep file size manageable.
 */

import { Plugin, PluginKey, Selection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { keymap } from "@milkdown/kit/prose/keymap";
import { $prose } from "@milkdown/kit/utils";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useUIStore } from "@/stores/uiStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getCursorInfoFromProseMirror } from "@/utils/cursorSync/prosemirror";
import { findMarkRange, findAnyMarkRangeAtCursor, findWordAtCursor } from "@/plugins/syntaxReveal/marks";

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

// Track last removed mark for undo-like re-toggle (per-window via WeakMap)
interface LastRemovedMark {
  markType: string;
  from: number;
  to: number;
  docTextHash: number; // Simple hash of doc text content
}

// Use WeakMap keyed by EditorView to scope state per editor instance
const lastRemovedMarkMap = new WeakMap<EditorView, LastRemovedMark | null>();

/**
 * Simple string hash for document version detection.
 * Detects any character change, not just size changes.
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash;
}

/**
 * Expanded toggle mark: when cursor is inside a mark, toggle the entire marked range.
 * Also supports undo-like re-toggle if no changes were made.
 * Exported for reuse in menu command handlers.
 */
export function expandedToggleMark(view: EditorView, markTypeName: string): boolean {
  const { state, dispatch } = view;
  const markType = state.schema.marks[markTypeName];
  if (!markType) return false;

  const { from, to, empty } = state.selection;
  const $from = state.selection.$from;
  const docTextHash = hashString(state.doc.textContent);

  // Get per-instance state
  const lastRemovedMark = lastRemovedMarkMap.get(view) ?? null;

  const clearLastRemoved = () => {
    lastRemovedMarkMap.set(view, null);
  };

  const setLastRemoved = (mark: LastRemovedMark) => {
    lastRemovedMarkMap.set(view, mark);
  };

  if (!empty) {
    // Has selection - standard toggle
    clearLastRemoved();
    if (state.doc.rangeHasMark(from, to, markType)) {
      dispatch(state.tr.removeMark(from, to, markType));
    } else {
      dispatch(state.tr.addMark(from, to, markType.create()));
    }
    return true;
  }

  // Empty selection - find mark range at cursor
  const markRange = findMarkRange(
    from,
    markType.create(),
    $from.start(),
    $from.parent
  );

  if (markRange) {
    // Cursor inside mark - remove from entire range and remember it
    setLastRemoved({
      markType: markTypeName,
      from: markRange.from,
      to: markRange.to,
      docTextHash,
    });
    dispatch(state.tr.removeMark(markRange.from, markRange.to, markType));
    return true;
  } else {
    // Cursor not in target mark - check if we can restore previous mark
    if (
      lastRemovedMark &&
      lastRemovedMark.markType === markTypeName &&
      lastRemovedMark.docTextHash === docTextHash &&
      from >= lastRemovedMark.from &&
      from <= lastRemovedMark.to
    ) {
      // Undo: restore the mark
      dispatch(
        state.tr.addMark(
          lastRemovedMark.from,
          lastRemovedMark.to,
          markType.create()
        )
      );
      clearLastRemoved();
      return true;
    }

    // Fallback: check if cursor is inside ANY other mark (e.g., link)
    // If so, apply the target mark to that range
    // Exception: inline code inside link is not useful, skip this fallback
    const inheritedRange = findAnyMarkRangeAtCursor(from, $from);
    if (inheritedRange && !(markTypeName === "inlineCode" && inheritedRange.isLink)) {
      clearLastRemoved();
      dispatch(
        state.tr.addMark(
          inheritedRange.from,
          inheritedRange.to,
          markType.create()
        )
      );
      return true;
    }

    // Fallback: select word at cursor and apply mark
    const wordRange = findWordAtCursor($from);
    if (wordRange) {
      clearLastRemoved();
      dispatch(state.tr.addMark(wordRange.from, wordRange.to, markType.create()));
      return true;
    }

    // Final fallback - toggle stored mark for new typing
    clearLastRemoved();
    const storedMarks = state.storedMarks || $from.marks();
    if (markType.isInSet(storedMarks)) {
      dispatch(state.tr.removeStoredMark(markType));
    } else {
      dispatch(state.tr.addStoredMark(markType.create()));
    }
    return true;
  }
}

/**
 * Keymap plugin for expanded mark toggle (seamless behavior).
 * Overrides Milkdown's default Mod-b, Mod-i, etc. to toggle entire mark ranges.
 */
export const expandedMarkTogglePlugin = $prose(() =>
  keymap({
    "Mod-b": (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "strong");
    },
    "Mod-i": (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "emphasis");
    },
    "Mod-`": (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "inlineCode");
    },
    "Mod-Shift-x": (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "strike_through");
    },
    "Mod-k": (_state, _dispatch, view) => {
      if (!view) return false;
      return expandedToggleMark(view, "link");
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
