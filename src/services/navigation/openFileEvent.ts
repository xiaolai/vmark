/**
 * Window-scoped "open-file" event — single emitter for every producer.
 *
 * Purpose: Tauri's `emit()` AND `WebviewWindow.emit()` broadcast to every
 * window (only `emitTo` targets a specific one). #675 assumed
 * `getCurrentWebviewWindow().emit()` was window-local and #1112 regressed:
 * clicking a doc in one window's sidebar opened it in all windows. The
 * scoping therefore lives in the PAYLOAD — it carries the originating
 * window's label and the `useFileShortcuts` listener drops events whose
 * label doesn't match, exactly like the `menu:*` listeners.
 *
 * Every "open-file" producer (file explorer, wiki-link popups, markdown
 * link opens) must emit through this helper so the label can never be
 * forgotten again.
 *
 * @coordinates-with hooks/useFileShortcuts.ts — the filtering listener
 * @module services/navigation/openFileEvent
 */

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

export const OPEN_FILE_EVENT = "open-file";

export interface OpenFileEventPayload {
  path: string;
  /** Label of the window that should handle the open — all others drop it. */
  windowLabel: string;
}

/**
 * Emit "open-file" for the current window. Broadcasts (Tauri semantics)
 * but only the originating window's listener acts on it. Rejections
 * propagate — callers own their error handling.
 */
export async function emitOpenFileInCurrentWindow(path: string): Promise<void> {
  const current = getCurrentWebviewWindow();
  const payload: OpenFileEventPayload = { path, windowLabel: current.label };
  await current.emit(OPEN_FILE_EVENT, payload);
}
