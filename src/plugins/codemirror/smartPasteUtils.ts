/**
 * Smart Paste Utilities
 *
 * Purpose: Pure/small helper functions used by the smart paste plugin and image handling.
 *
 * @coordinates-with smartPaste.ts — plugin factory
 * @coordinates-with smartPasteImage.ts — image paste handling
 * @module plugins/codemirror/smartPasteUtils
 */

import { EditorView } from "@codemirror/view";
import { exists } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";
import { getWindowLabel } from "@/services/navigation/windowFocus";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";

/**
 * Check if a CodeMirror view is still connected and valid.
 */
export function isViewConnected(view: EditorView | null | undefined): boolean {
  if (!view) return false;
  try {
    return view.dom?.isConnected ?? false;
  } catch {
    return false;
  }
}

/**
 * Check if a string looks like a valid URL.
 */
export function isValidUrl(str: string): boolean {
  const trimmed = str.trim();
  // Must start with http:// or https:// and contain no spaces
  return /^https?:\/\/\S+$/.test(trimmed);
}

/**
 * Get the active document file path for the current window.
 */
export function getActiveFilePath(): string | null {
  try {
    const windowLabel = getWindowLabel();
    const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
    if (!tabId) return null;
    return useDocumentStore.getState().getDocument(tabId)?.filePath ?? null;
  } catch {
    return null;
  }
}

/**
 * Expand home path (~/) to absolute path.
 */
export async function expandHomePath(path: string): Promise<string | null> {
  if (!path.startsWith("~/")) return path;

  try {
    const home = await homeDir();
    return await join(home, path.slice(2));
  } catch {
    return null;
  }
}

/**
 * Validate a local image path exists.
 */
export async function validateLocalPath(path: string): Promise<boolean> {
  try {
    return await exists(path);
  } catch {
    return false;
  }
}

/**
 * Get anchor rect for toast positioning based on cursor position.
 */
export function getToastAnchorRect(view: EditorView, pos: number): { top: number; left: number; bottom: number; right: number } {
  try {
    const coords = view.coordsAtPos(pos);
    if (coords) {
      return {
        top: coords.top,
        left: coords.left,
        bottom: coords.bottom,
        right: coords.right,
      };
    }
  } catch {
    // Fallback
  }
  return {
    top: window.innerHeight / 2 - 20,
    left: window.innerWidth / 2,
    bottom: window.innerHeight / 2,
    right: window.innerWidth / 2,
  };
}

/**
 * Paste text as plain text.
 * Uses captured positions to handle async timing.
 */
export function pasteAsText(view: EditorView, text: string, capturedFrom: number, capturedTo: number): void {
  if (!isViewConnected(view)) {
    return;
  }

  // Use captured positions if selection hasn't changed, otherwise use current
  const { from: currentFrom, to: currentTo } = view.state.selection.main;
  const docLength = view.state.doc.length;
  const from = currentFrom === capturedFrom && currentTo === capturedTo
    ? Math.min(capturedFrom, docLength)
    : Math.min(currentFrom, docLength);
  const to = currentFrom === capturedFrom && currentTo === capturedTo
    ? Math.min(capturedTo, docLength)
    : Math.min(currentTo, docLength);

  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}
