/**
 * useBrowserNavEvents — subscribe to the native WKNavigationDelegate events for
 * one browser tab and route them to handlers (WI-1.7).
 *
 * Purpose: the VMark-owned WKWebView drives its own navigation (redirects,
 * AI-driven clicks, `reload`), so the React chrome cannot know the current URL
 * from `browser_navigate` alone. `browser/nav_delegate_macos.rs` emits
 * `browser://navigated` (committed), `browser://loaded` (finished, with title),
 * `browser://load-failed`, `browser://crashed` (content-process death, with the
 * recovery action), and `browser://dialog` (a page `alert`/`confirm`); this hook
 * listens, filters by `tabId`, and calls the matching handler so the chrome
 * (address bar, loading, crash overlay, dialog) tracks reality.
 *
 * Handlers are held in a ref so the subscription is set up once per `tabId` and
 * never churns when the parent re-renders with fresh closures.
 *
 * @coordinates-with src-tauri browser/nav_delegate_macos.rs — the event emitter
 * @module components/Browser/useBrowserNavEvents
 */
import { useLayoutEffect, useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { browserWarn } from "@/utils/debug";

/** How the native side is recovering from a content-process crash (WI-1.8):
 *  it is already reloading, or the user has to act. */
export type CrashAction = "auto-reload" | "manual";

/** A page JS dialog. Only a `confirm` can be answered, and answering needs the
 *  native completion-handler `id` — so the two travel together or not at all. */
export type BrowserDialog =
  | { kind: "alert"; message: string }
  | { kind: "confirm"; message: string; id: number };

export interface BrowserNavHandlers {
  /**
   * A navigation committed; `url` is the new location and `generation` is the
   * driver's navigation generation for it (WI-2.1). Operations are stamped with
   * the generation so the Rust gate rejects one authorized against an older page.
   */
  onNavigated?: (url: string, generation: number) => void;
  /** A load finished; `url` is final, `title` is the page title (may be ""). */
  onLoaded?: (url: string, title: string) => void;
  /** A (provisional or committed) navigation failed. */
  onFailed?: (message: string) => void;
  /** The web content process died (WI-1.8). */
  onCrashed?: (action: CrashAction) => void;
  /** The page opened a JS dialog (`alert`/`confirm`). */
  onDialog?: (dialog: BrowserDialog) => void;
}

interface TabScoped {
  tabId: string;
}
interface NavPayload extends TabScoped {
  url: string;
  generation: number;
}
interface LoadedPayload extends TabScoped {
  url: string;
  title: string;
}
interface FailedPayload extends TabScoped {
  message: string;
}
interface CrashPayload extends TabScoped {
  action: string;
}
interface DialogPayload extends TabScoped {
  kind: string;
  message: string;
  id?: number;
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

export function useBrowserNavEvents(tabId: string, handlers: BrowserNavHandlers): void {
  const handlersRef = useRef(handlers);
  // Layout effect, not a passive one: a native event can arrive between commit
  // and a passive effect, and would then hit the previous render's handlers.
  // (Writing the ref during render is what React 19 forbids — this is after commit.)
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    let active = true;
    const unlisteners: UnlistenFn[] = [];

    /** Subscribe to one tab-scoped native event: filter by tab, dispatch to the
     *  latest handler, track the unlisten (undoing it if we already unmounted),
     *  and never let a failed registration become an unhandled rejection. */
    const on = <P extends TabScoped>(
      event: string,
      dispatch: (payload: P, h: BrowserNavHandlers) => void,
    ): void => {
      listen<P>(event, (e) => {
        if (e.payload.tabId === tabId) dispatch(e.payload, handlersRef.current);
      })
        .then((un) => {
          if (active) unlisteners.push(un);
          else un(); // unmounted before listen() resolved — undo it
        })
        .catch((error: unknown) => {
          // A dead listener means this part of the chrome silently stops tracking
          // reality (no crash overlay, a stale address bar) — say so, loudly.
          browserWarn(`browser: failed to subscribe to ${event}`, error);
        });
    };

    on<NavPayload>("browser://navigated", (p, h) => h.onNavigated?.(p.url, p.generation));
    on<LoadedPayload>("browser://loaded", (p, h) => h.onLoaded?.(p.url, p.title));
    on<FailedPayload>("browser://load-failed", (p, h) => h.onFailed?.(p.message));
    on<CrashPayload>("browser://crashed", (p, h) => h.onCrashed?.(toCrashAction(p.action)));
    on<DialogPayload>("browser://dialog", (p, h) => h.onDialog?.(toDialog(p)));

    return () => {
      active = false;
      for (const un of unlisteners) un();
    };
  }, [tabId]);
}
