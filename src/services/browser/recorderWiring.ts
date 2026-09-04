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
 * @coordinates-with services/browser/browserNativeEvents.ts — the validated event hub this subscribes to
 * @coordinates-with stores/tabRemovalBus.ts — close/detach notifications
 * @module services/browser/recorderWiring
 */

import { onTabRemoved } from "@/stores/tabRemovalBus";
import { browserNativeEvents, type BrowserNativeEventSource } from "./browserNativeEvents";
import { isRecording, recordNavigation, abortRecorderSession } from "@/services/workflow/recorderSession";

/** Attach the recorder's event sources. Returns a stop function. The native
 *  events arrive through the ONE validated decoder hub (round 3): this used to
 *  decode `browser://navigated` on its own `listen`, a third copy of the payload
 *  rules that accepted a generation of 0 for a missing field. */
export function startRecorderWiring(source: BrowserNativeEventSource = browserNativeEvents): () => void {
  const subscription = source.subscribe((event) => {
    if (event.kind !== "navigated") return;
    // Only a tab with an active recording; ordinary navigation is untouched.
    if (!isRecording(event.tabId)) return;
    void recordNavigation(event.tabId, event.url, event.generation);
  });
  const offTabRemoved = onTabRemoved((_windowLabel, tabId) => {
    abortRecorderSession(tabId);
  });
  return () => {
    subscription.unsubscribe();
    offTabRemoved();
  };
}
