/**
 * BrowserSurface — the React surface for an embedded browser tab (WI-1.3).
 *
 * Purpose: renders the browser *chrome* (address bar, reload, loading state) and
 * a reserved viewport rect, and drives the VMark-owned native WKWebView through
 * the WI-1.2 Tauri commands: it creates the native webview on mount, reports the
 * reserved rect's bounds so Rust keeps the native view aligned under it
 * (ResizeObserver), navigates on address-bar submit, and destroys the webview on
 * unmount. It also listens (via `useBrowserNavEvents`) to the native
 * WKNavigationDelegate events so the address bar, tab url, and loading state
 * track navigation the page drives itself (redirects, AI clicks, reload), and on
 * `browser://crashed` it freezes the native view and shows a page-crashed reload
 * overlay (WI-1.8). The page paints in the native view over the viewport rect —
 * the rect here is a placeholder, deliberately empty.
 *
 * `Editor.tsx` mounts this for `kind === "browser"` tabs (R1). Store access is
 * via selectors + `getState()` in callbacks (no destructuring).
 *
 * @coordinates-with src-tauri browser commands — browser_create/navigate/set_bounds/destroy
 * @coordinates-with components/Browser/useBrowserNavEvents — native nav-delegate events
 * @coordinates-with stores/tabStore.ts — reads the BrowserTab url, updates it on navigate
 * @module components/Browser/BrowserSurface
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { canonicalizeBrowserUrl } from "@/lib/browser/url";
import { useBrowserNavEvents } from "./useBrowserNavEvents";
import "./browser-surface.css";

export function BrowserSurface({ tabId }: { tabId: string }): React.ReactElement {
  const { t } = useTranslation("common");
  const windowLabel = useMemo(() => getCurrentWebviewWindow().label, []);
  const url = useTabStore((s) => {
    const tab = s.findTabById(tabId);
    return tab && isBrowserTab(tab) ? tab.url : "";
  });

  const [urlInput, setUrlInput] = useState(url);
  const [loading, setLoading] = useState(true);
  // Non-null while the web content process is down (WI-1.8). `action` is
  // "auto-reload" (native is already reloading) or "manual" (needs the user).
  const [crash, setCrash] = useState<{ action: string } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Mounted per-tab (keyed in Editor.tsx), so `url` is the initial target and
  // the address bar is seeded once from it; navigation updates it explicitly.

  // Create the native webview on mount; destroy it on unmount.
  useEffect(() => {
    let active = true;
    void invoke("browser_create", { tabId, windowLabel, url })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      void invoke("browser_destroy", { tabId }).catch(() => {});
    };
    // `url` is the initial navigation target only; navigation is explicit after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, windowLabel]);

  // Report the reserved rect's viewport bounds to Rust on layout/resize so the
  // native view stays aligned under the placeholder.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      void invoke("browser_set_bounds", {
        tabId,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      }).catch(() => {});
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => observer.disconnect();
  }, [tabId]);

  // Track native-driven navigation (redirects, AI clicks, reload) so the address
  // bar and loading state reflect where the WKWebView actually is — the delegate
  // (nav_delegate_macos.rs) is the source of truth once a load is underway.
  useBrowserNavEvents(tabId, {
    onNavigated: (next) => {
      setUrlInput(next);
      setLoading(true);
      useTabStore.getState().updateBrowserTab(tabId, { url: next });
    },
    onLoaded: (next) => {
      setUrlInput(next);
      setLoading(false);
      // A clean load means the process recovered — reveal the native view again.
      setCrash((prev) => {
        if (prev) void invoke("browser_thaw", { tabId }).catch(() => {});
        return null;
      });
      useTabStore.getState().updateBrowserTab(tabId, { url: next });
    },
    onFailed: () => setLoading(false),
    onCrashed: (action) => {
      // The native view still occludes the DOM after a crash; freeze (hide) it so
      // the recovery overlay is visible in its place (WI-1.4 occlusion / WI-1.8).
      setCrash({ action });
      void invoke("browser_freeze", { tabId }).catch(() => {});
    },
  });

  const navigate = (target: string) => {
    const next = canonicalizeBrowserUrl(target) ?? target;
    setUrlInput(next); // reflect the canonical URL in the address bar
    setLoading(true);
    void invoke("browser_navigate", { tabId, url: next })
      .catch(() => {})
      .finally(() => setLoading(false));
    useTabStore.getState().updateBrowserTab(tabId, { url: next });
  };

  return (
    <div className="browser-surface">
      <div className="browser-chrome">
        <button
          type="button"
          className="browser-chrome-btn"
          onClick={() => navigate(url)}
          aria-label={t("browser.reload")}
          title={t("browser.reload")}
        >
          ⟳
        </button>
        <form
          className="browser-url-form"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(urlInput);
          }}
        >
          <input
            className="browser-url-input"
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            aria-label={t("browser.addressBar")}
            spellCheck={false}
            autoComplete="off"
          />
        </form>
        {loading && <span className="browser-loading" role="status" aria-label={t("browser.loading")} />}
      </div>
      {/* The viewport is a placeholder the native view paints over, so it is
          hidden from a11y — except when the crash overlay is the real content. */}
      <div ref={viewportRef} className="browser-viewport" aria-hidden={crash ? undefined : true}>
        {crash && (
          <div className="browser-crash-overlay" role="alert">
            <p className="browser-crash-message">{t("browser.crashed")}</p>
            {crash.action === "manual" ? (
              <button
                type="button"
                className="browser-crash-reload"
                onClick={() => {
                  setCrash(null);
                  void invoke("browser_thaw", { tabId }).catch(() => {});
                  navigate(url);
                }}
              >
                {t("browser.reload")}
              </button>
            ) : (
              <span className="browser-crash-reloading">{t("browser.reloading")}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
