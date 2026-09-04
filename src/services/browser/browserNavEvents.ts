/**
 * Native WKNavigationDelegate events for browser tabs (WI-1.7) — the handler adapter.
 *
 * Purpose: the VMark-owned WKWebView drives its own navigation (redirects,
 * AI-driven clicks, `reload`), so the React chrome cannot know the current URL
 * from `browser_navigate` alone. `browser/nav_delegate_macos.rs` emits
 * `browser://navigated` (committed), `browser://loaded` (finished, with title),
 * `browser://load-failed`, `browser://crashed` (content-process death, with the
 * recovery action), `browser://dialog` (a page `alert`/`confirm`) and
 * `browser://popup` (a `window.open` VMark refused). This module turns the typed
 * events into per-handler callbacks for the WINDOW-LEVEL consumer (audit
 * 2026-09-03 L-01): every handler receives the `tabId`, so one subscription —
 * `services/browser/browserTabEvents.ts` — tracks every tab of the window whether
 * or not its surface is mounted. A background tab's `confirm()` used to park the
 * page forever because only the mounted surface listened.
 *
 * It no longer decodes or subscribes on its own (round 3, #80). Decoding — the
 * round-2 validation (#81: a `url` must parse, a `generation` must be a
 * non-negative integer, else the event is dropped with a warning) — lives once in
 * `browserNativeEventDecoder`, and the Tauri subscription (registered once,
 * retried with backoff, every failure logged) in `browserNativeEvents`, which fans
 * the same typed events out to `browserEventBroker`'s navigation waiters. Two
 * decoders had drifted; now there is one.
 *
 * The commit and finish events also carry the webview's back/forward-list state,
 * surfaced as `onHistoryChanged` with the event's generation (WI-S1.6). Missing
 * flags are already `false` by the time they reach here.
 *
 * @coordinates-with services/browser/browserNativeEvents — the shared subscription hub
 * @coordinates-with services/browser/browserNativeEventDecoder — the typed events consumed here
 * @coordinates-with services/browser/browserTabEvents.ts — the window-level consumer
 * @module services/browser/browserNavEvents
 */
import type { BrowserDialog, CrashAction } from "@/stores/browserUiStore";
import { browserNativeEvents, type BrowserNativeEvent } from "./browserNativeEvents";

/** The window-level shape: every handler is told WHICH tab. */
export interface TabNavHandlers {
  onNavigated?:
    | ((tabId: string, url: string, generation: number, redirected: boolean, navigationId?: string) => void)
    | undefined;
  onLoaded?:
    | ((tabId: string, url: string, title: string, generation: number, navigationId?: string) => void)
    | undefined;
  onHistoryChanged?:
    | ((tabId: string, canGoBack: boolean, canGoForward: boolean, generation: number) => void)
    | undefined;
  onFailed?: ((tabId: string, message: string, navigationId?: string) => void) | undefined;
  onCrashed?: ((tabId: string, action: CrashAction) => void) | undefined;
  onDialog?: ((tabId: string, dialog: BrowserDialog) => void) | undefined;
  onPopupBlocked?: ((tabId: string, url: string) => void) | undefined;
}

/** Hand one typed event to the matching handler. A missing ticket is passed as an
 *  absent argument, never an explicit `undefined`. */
function dispatch(event: BrowserNativeEvent, h: TabNavHandlers): void {
  switch (event.kind) {
    case "navigated": {
      const { tabId, url, generation, redirected, navigationId } = event;
      if (navigationId === undefined) h.onNavigated?.(tabId, url, generation, redirected);
      else h.onNavigated?.(tabId, url, generation, redirected, navigationId);
      h.onHistoryChanged?.(tabId, event.canGoBack, event.canGoForward, generation);
      return;
    }
    case "loaded": {
      const { tabId, url, title, generation, navigationId } = event;
      if (navigationId === undefined) h.onLoaded?.(tabId, url, title, generation);
      else h.onLoaded?.(tabId, url, title, generation, navigationId);
      h.onHistoryChanged?.(tabId, event.canGoBack, event.canGoForward, generation);
      return;
    }
    case "failed":
      if (event.navigationId === undefined) h.onFailed?.(event.tabId, event.message);
      else h.onFailed?.(event.tabId, event.message, event.navigationId);
      return;
    case "crashed":
      h.onCrashed?.(event.tabId, event.action);
      return;
    case "dialog":
      h.onDialog?.(event.tabId, event.dialog);
      return;
    case "popup":
      h.onPopupBlocked?.(event.tabId, event.url);
      return;
  }
}

/**
 * Subscribe to every tab's native events. `current()` is read per event so a
 * caller may swap handlers without resubscribing. Returns an unsubscribe.
 */
export function subscribeBrowserNavEvents(current: () => TabNavHandlers): () => void {
  const subscription = browserNativeEvents.subscribe((event) => dispatch(event, current()));
  return subscription.unsubscribe;
}
