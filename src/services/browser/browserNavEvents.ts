/**
 * Native WKNavigationDelegate events for browser tabs (WI-1.7).
 *
 * Purpose: the VMark-owned WKWebView drives its own navigation (redirects,
 * AI-driven clicks, `reload`), so the React chrome cannot know the current URL
 * from `browser_navigate` alone. `browser/nav_delegate_macos.rs` emits
 * `browser://navigated` (committed), `browser://loaded` (finished, with title),
 * `browser://load-failed`, `browser://crashed` (content-process death, with the
 * recovery action), `browser://dialog` (a page `alert`/`confirm`) and
 * `browser://popup` (a `window.open` VMark refused); this module decodes them.
 *
 * Two entry points. `subscribeBrowserNavEvents` is the WINDOW-LEVEL one
 * (audit 2026-09-03 L-01): every handler receives the `tabId`, so one
 * subscription — `services/browser/browserTabEvents.ts` — tracks every tab of the
 * window whether or not its surface is mounted. A background tab's `confirm()`
 * used to park the page forever because only the mounted surface listened.
 * `useBrowserNavEvents` is the per-tab hook, kept for components that only care
 * about one tab; it filters the same events.
 *
 * The commit and finish events also carry the webview's back/forward-list state,
 * surfaced as `onHistoryChanged` (WI-S1.6). Missing flags are coerced to
 * `false`: an older or partial payload must disable the controls, never hand
 * `undefined` to the store as though it were a known state.
 *
 * @coordinates-with src-tauri browser/nav_delegate_macos.rs — the event emitter
 * @coordinates-with services/browser/browserTabEvents.ts — the window-level consumer
 * @coordinates-with components/Browser/useBrowserNavEvents — the per-tab React adapter
 * @module services/browser/browserNavEvents
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { browserWarn } from "@/utils/debug";
import type { BrowserDialog, CrashAction } from "@/stores/browserUiStore";


export interface BrowserNavHandlers {
  /**
   * A navigation committed; `url` is the new location and `generation` is the
   * driver's navigation generation for it (WI-2.1). Operations are stamped with
   * the generation so the Rust gate rejects one authorized against an older page.
   */
  onNavigated?: (url: string, generation: number, redirected: boolean, navigationId?: string) => void;
  /** A load finished; `url` is final, `title` is the page title (may be ""). */
  onLoaded?: (url: string, title: string, generation: number, navigationId?: string) => void;
  /**
   * The webview's back/forward-list state (WI-S1.6). Fires on BOTH commit and
   * finish — a redirect, a same-document push, or a `goBack()` can change history
   * on either — so the omnibox's back/forward controls can be disabled correctly
   * instead of shipping as no-ops.
   */
  onHistoryChanged?: (canGoBack: boolean, canGoForward: boolean) => void;
  /** A (provisional or committed) navigation failed. */
  onFailed?: (message: string, navigationId?: string) => void;
  /** The web content process died (WI-1.8). */
  onCrashed?: (action: CrashAction) => void;
  /** The page opened a JS dialog (`alert`/`confirm`). */
  onDialog?: (dialog: BrowserDialog) => void;
  /** The page tried to open a window and VMark blocked it (audit X-03). */
  onPopupBlocked?: (url: string) => void;
}

/** The window-level shape: every handler is told WHICH tab. */
export interface TabNavHandlers {
  onNavigated?:
    | ((tabId: string, url: string, generation: number, redirected: boolean, navigationId?: string) => void)
    | undefined;
  onLoaded?:
    | ((tabId: string, url: string, title: string, generation: number, navigationId?: string) => void)
    | undefined;
  onHistoryChanged?: ((tabId: string, canGoBack: boolean, canGoForward: boolean) => void) | undefined;
  onFailed?: ((tabId: string, message: string, navigationId?: string) => void) | undefined;
  onCrashed?: ((tabId: string, action: CrashAction) => void) | undefined;
  onDialog?: ((tabId: string, dialog: BrowserDialog) => void) | undefined;
  onPopupBlocked?: ((tabId: string, url: string) => void) | undefined;
}

interface TabScoped {
  tabId: string;
}
/** Back/forward-list state, carried by every event that can change it (WI-S1.6). */
interface HistoryScoped {
  canGoBack?: boolean;
  canGoForward?: boolean;
}
interface NavPayload extends TabScoped, HistoryScoped {
  url: string;
  generation: number;
  /** This navigation followed a server redirect (WI-S2.2). */
  redirected?: boolean;
  navigationId?: string;
}
interface LoadedPayload extends TabScoped, HistoryScoped {
  url: string;
  title: string;
  /** Committed generation of the page that finished — lets the store drop a stale
   *  (out-of-order) loaded event, the same way `navigated` does. (Audit, Medium.) */
  generation: number;
  navigationId?: string;
}
interface FailedPayload extends TabScoped {
  message: string;
  navigationId?: string;
}
interface CrashPayload extends TabScoped {
  action: string;
}
interface DialogPayload extends TabScoped {
  kind: string;
  message: string;
  id?: number;
}
interface PopupPayload extends TabScoped {
  url: string;
}

/** Fail closed: an unrecognized action means we do NOT know a reload is coming,
 *  so ask the user rather than show a "reloading…" that never completes. */
function toCrashAction(action: string): CrashAction {
  return action === "auto-reload" ? "auto-reload" : "manual";
}

/** A confirm without its completion-handler id cannot be answered — surface it as
 *  an alert rather than offer OK/Cancel buttons whose answer reaches nobody. */
function toDialog(p: DialogPayload): BrowserDialog {
  return p.kind === "confirm" && typeof p.id === "number"
    ? { kind: "confirm", message: p.message, id: p.id }
    : { kind: "alert", message: p.message };
}

/**
 * Subscribe to every tab's native events. `current()` is read per event so a
 * caller may swap handlers without resubscribing. Returns an unsubscribe.
 */
export function subscribeBrowserNavEvents(current: () => TabNavHandlers): () => void {
  let active = true;
  const unlisteners: UnlistenFn[] = [];

  /** Subscribe to one native event: dispatch to the latest handlers, track the
   *  unlisten (undoing it if we already stopped), and never let a failed
   *  registration become an unhandled rejection. */
  const on = <P extends TabScoped>(event: string, dispatch: (payload: P, h: TabNavHandlers) => void): void => {
    listen<P>(event, (e) => {
      if (typeof e.payload?.tabId === "string") dispatch(e.payload, current());
    })
      .then((un) => {
        if (active) unlisteners.push(un);
        else un(); // stopped before listen() resolved — undo it
      })
      .catch((error: unknown) => {
        // A dead listener means this part of the chrome silently stops tracking
        // reality (no crash overlay, a stale address bar) — say so, loudly.
        browserWarn(`browser: failed to subscribe to ${event}`, error);
      });
  };

  // Coerce the history flags: an older/partial payload must disable the controls,
  // never hand `undefined` to the store as if it were a known state.
  const history = (p: TabScoped & HistoryScoped, h: TabNavHandlers) =>
    h.onHistoryChanged?.(p.tabId, !!p.canGoBack, !!p.canGoForward);

  on<NavPayload>("browser://navigated", (p, h) => {
    if (p.navigationId === undefined) h.onNavigated?.(p.tabId, p.url, p.generation, !!p.redirected);
    else h.onNavigated?.(p.tabId, p.url, p.generation, !!p.redirected, p.navigationId);
    history(p, h);
  });
  on<LoadedPayload>("browser://loaded", (p, h) => {
    if (p.navigationId === undefined) h.onLoaded?.(p.tabId, p.url, p.title, p.generation);
    else h.onLoaded?.(p.tabId, p.url, p.title, p.generation, p.navigationId);
    history(p, h);
  });
  on<FailedPayload>("browser://load-failed", (p, h) => {
    if (p.navigationId === undefined) h.onFailed?.(p.tabId, p.message);
    else h.onFailed?.(p.tabId, p.message, p.navigationId);
  });
  on<CrashPayload>("browser://crashed", (p, h) => h.onCrashed?.(p.tabId, toCrashAction(p.action)));
  on<DialogPayload>("browser://dialog", (p, h) => h.onDialog?.(p.tabId, toDialog(p)));
  on<PopupPayload>("browser://popup", (p, h) => {
    if (typeof p.url === "string") h.onPopupBlocked?.(p.tabId, p.url);
  });

  return () => {
    active = false;
    for (const un of unlisteners) un();
  };
}

