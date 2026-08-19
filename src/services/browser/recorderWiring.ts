/**
 * Recorder event wiring (WI-NB7.1) — the real-world edges a cross-document
 * recording needs, in the shape of `browserLeaseWiring`.
 *
 * A page-world DOM buffer dies on navigation, so a multi-page recording only works
 * if the host records each navigation and re-arms the shim in the fresh document.
 * This connects the host-owned `recorderSession` to its two event sources:
 *   - `browser://navigated` — while a tab is recording, append a host-side navigate
 *     record (the native committed URL, not a page claim) and re-arm the new
 *     document (`recordNavigation`).
 *   - `tabRemovalBus` — a close/detach discards the recording (never keep draining a
 *     destroyed surface).
 *
 * Started once from `useCommandBootstrap`, next to `startBrowserLeaseWiring`.
 *
 * @coordinates-with services/workflow/recorderSession.ts — the session being driven
 * @coordinates-with src-tauri browser nav delegate — emits browser://navigated
 * @coordinates-with stores/tabRemovalBus.ts — close/detach notifications
 * @module services/browser/recorderWiring
 */

import { listen } from "@tauri-apps/api/event";
import { onTabRemoved } from "@/stores/tabRemovalBus";
import { isRecording, recordNavigation, abortRecorderSession } from "@/services/workflow/recorderSession";

/** Attach the recorder's event sources. Returns a stop function. */
export function startRecorderWiring(): () => void {
  let disposed = false;
  let unlistenNav: (() => void) | null = null;

  void listen("browser://navigated", (event) => {
    const payload = event.payload;
    if (typeof payload !== "object" || payload === null) return;
    const p = payload as Record<string, unknown>;
    const tabId = typeof p.tabId === "string" ? p.tabId : "";
    // Only a tab with an active recording; ordinary navigation is untouched.
    if (!tabId || !isRecording(tabId)) return;
    const url = typeof p.url === "string" ? p.url : "";
    const generation = typeof p.generation === "number" ? p.generation : 0;
    void recordNavigation(tabId, url, generation);
  }).then((stop) => {
    if (disposed) stop();
    else unlistenNav = stop;
  });

  const offTabRemoved = onTabRemoved((_windowLabel, tabId) => {
    abortRecorderSession(tabId);
  });

  return () => {
    disposed = true;
    unlistenNav?.();
    unlistenNav = null;
    offTabRemoved();
  };
}
