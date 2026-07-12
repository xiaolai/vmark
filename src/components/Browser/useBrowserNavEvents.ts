/**
 * useBrowserNavEvents — subscribe to the native WKNavigationDelegate events for
 * one browser tab and route them to handlers (WI-1.7).
 *
 * Purpose: the VMark-owned WKWebView drives its own navigation (redirects,
 * AI-driven clicks, `reload`), so the React chrome cannot know the current URL
 * from `browser_navigate` alone. `browser/nav_delegate_macos.rs` emits
 * `browser://navigated` (committed), `browser://loaded` (finished, with title),
 * and `browser://load-failed`; this hook listens, filters by `tabId`, and calls
 * the matching handler so the address bar and loading state track reality.
 *
 * Handlers are held in a ref so the subscription is set up once per `tabId` and
 * never churns when the parent re-renders with fresh closures.
 *
 * @coordinates-with src-tauri browser/nav_delegate_macos.rs — the event emitter
 * @module components/Browser/useBrowserNavEvents
 */
import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface BrowserNavHandlers {
  /** A navigation committed; `url` is the new location. */
  onNavigated?: (url: string) => void;
  /** A load finished; `url` is final, `title` is the page title (may be ""). */
  onLoaded?: (url: string, title: string) => void;
  /** A (provisional or committed) navigation failed. */
  onFailed?: (message: string) => void;
  /** The web content process died; `action` is "auto-reload" or "manual" (WI-1.8). */
  onCrashed?: (action: string) => void;
}

interface NavPayload {
  tabId: string;
  url: string;
}
interface LoadedPayload {
  tabId: string;
  url: string;
  title: string;
}
interface FailedPayload {
  tabId: string;
  message: string;
}
interface CrashPayload {
  tabId: string;
  action: string;
}

export function useBrowserNavEvents(tabId: string, handlers: BrowserNavHandlers): void {
  const handlersRef = useRef(handlers);
  // Keep the ref current without touching it during render (React 19 compiler
  // rule); listeners read handlersRef.current at event time, always after commit.
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    let active = true;
    const unlisteners: UnlistenFn[] = [];
    const track = (p: Promise<UnlistenFn>) => {
      void p.then((un) => {
        // If we already unmounted before the listen() promise resolved, undo it.
        if (active) unlisteners.push(un);
        else un();
      });
    };

    track(
      listen<NavPayload>("browser://navigated", (e) => {
        if (e.payload.tabId === tabId) handlersRef.current.onNavigated?.(e.payload.url);
      }),
    );
    track(
      listen<LoadedPayload>("browser://loaded", (e) => {
        if (e.payload.tabId === tabId) handlersRef.current.onLoaded?.(e.payload.url, e.payload.title);
      }),
    );
    track(
      listen<FailedPayload>("browser://load-failed", (e) => {
        if (e.payload.tabId === tabId) handlersRef.current.onFailed?.(e.payload.message);
      }),
    );
    track(
      listen<CrashPayload>("browser://crashed", (e) => {
        if (e.payload.tabId === tabId) handlersRef.current.onCrashed?.(e.payload.action);
      }),
    );

    return () => {
      active = false;
      for (const un of unlisteners) un();
    };
  }, [tabId]);
}
