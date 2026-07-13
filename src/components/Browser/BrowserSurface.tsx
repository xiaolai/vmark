/**
 * BrowserSurface — the React surface for an embedded browser tab (WI-1.3).
 *
 * Purpose: renders the browser *chrome* (back/forward, address bar, reload,
 * loading state) and a reserved viewport rect, and drives the native WKWebView through
 * the WI-1.2 Tauri commands: it creates the native webview on mount, reports the
 * reserved rect's bounds so Rust keeps the native view aligned under it
 * (ResizeObserver), navigates on address-bar submit, and destroys the webview on
 * unmount. It also listens (via `useBrowserNavEvents`) to the native
 * WKNavigationDelegate events so the address bar, tab url, and loading state
 * track navigation the page drives itself (redirects, AI clicks, reload). On
 * `browser://crashed` it freezes the native view and shows a page-crashed reload
 * overlay (WI-1.8); on `browser://dialog` it freezes and shows an alert/confirm
 * modal, answering `confirm()` via `browser_dialog_respond` (WI-1.7). Freezing is
 * required because the native view paints over the DOM. The page paints in the
 * native view over the viewport rect — the rect here is a placeholder, empty.
 *
 * `Editor.tsx` mounts this for `kind === "browser"` tabs (R1). Store access is
 * via selectors + `getState()` in callbacks (no destructuring).
 *
 * @coordinates-with src-tauri browser commands — browser_create/navigate/set_bounds/destroy
 * @coordinates-with components/Browser/useBrowserNavEvents — native nav-delegate events
 * @coordinates-with stores/tabStore.ts — reads the BrowserTab url, updates it on navigate
 * @module components/Browser/BrowserSurface
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { canonicalizeBrowserUrl } from "@/lib/browser/url";
import {
  useBrowserNavEvents,
  type BrowserDialog,
  type CrashAction,
} from "./useBrowserNavEvents";
import "./browser-surface.css";

/**
 * Canonicalize a navigation target while PRESERVING its fragment (`#section`).
 *
 * `canonicalizeBrowserUrl` is dedup-oriented and deliberately drops the fragment,
 * but navigation must keep it so the page scrolls to the anchor — otherwise
 * entering or reloading `page#section` silently loads `page`. Falls back to the
 * raw input when it is not a navigable http(s) URL (about:blank, a scheme-less
 * draft) so the tab still reaches the native side.
 */
function navigationTarget(input: string): string {
  const canonical = canonicalizeBrowserUrl(input);
  if (canonical === null) return input;
  const hashIndex = input.indexOf("#");
  return hashIndex >= 0 ? canonical + input.slice(hashIndex) : canonical;
}

export function BrowserSurface({ tabId }: { tabId: string }): React.ReactElement {
  const { t } = useTranslation("common");
  const url = useTabStore((s) => {
    const tab = s.findTabById(tabId);
    return tab && isBrowserTab(tab) ? tab.url : "";
  });

  const [urlInput, setUrlInput] = useState(url);
  const [loading, setLoading] = useState(true);
  // Non-null while the web content process is down (WI-1.8). `action` is
  // "auto-reload" (native is already reloading) or "manual" (needs the user).
  const [crash, setCrash] = useState<{ action: CrashAction } | null>(null);
  // Non-null while a page JS dialog (alert/confirm) is open (WI-1.7).
  const [dialog, setDialog] = useState<BrowserDialog | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Mounted per-tab (keyed in Editor.tsx), so `url` is the initial target and
  // the address bar is seeded once from it; navigation updates it explicitly.

  // Create the native webview on mount; destroy it on unmount.
  useEffect(() => {
    let active = true;
    // The window is derived Rust-side from the invoking WebviewWindow (a caller
    // can't assert a label), so we pass only tabId + url.
    const created = invoke("browser_create", { tabId, url });
    void created.catch(() => {}).finally(() => active && setLoading(false));
    return () => {
      active = false;
      // Destroy only AFTER create settles: a create that resolves after this
      // unmount would otherwise register a native webview this destroy already
      // missed, orphaning a content process nothing tears down.
      void created.catch(() => {}).then(() => void invoke("browser_destroy", { tabId }).catch(() => {}));
    };
    // `url` is the initial navigation target only; navigation is explicit after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

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
    onNavigated: (next, generation) => {
      setUrlInput(next);
      setLoading(true);
      // Record the generation with the URL: driver operations are stamped with it,
      // so one authorized against the previous page is refused by the Rust gate.
      useTabStore.getState().updateBrowserTab(tabId, { url: next, generation });
    },
    onLoaded: (next) => {
      setUrlInput(next);
      setLoading(false);
      // A clean load means the process recovered — reveal the native view again.
      // The thaw is fired here, not inside the `setCrash` updater: React may
      // re-invoke an updater (StrictMode), which would thaw twice.
      if (crash) {
        setCrash(null);
        void invoke("browser_thaw", { tabId }).catch(() => {});
      }
      useTabStore.getState().updateBrowserTab(tabId, { url: next });
    },
    onFailed: () => setLoading(false),
    onCrashed: (action) => {
      // The native view still occludes the DOM after a crash; freeze (hide) it so
      // the recovery overlay is visible in its place (WI-1.4 occlusion / WI-1.8).
      setCrash({ action });
      void invoke("browser_freeze", { tabId }).catch(() => {});
    },
    onDialog: (d) => {
      // Same occlusion story: freeze the native view so the DOM dialog shows.
      setDialog(d);
      void invoke("browser_freeze", { tabId }).catch(() => {});
    },
  });

  // Answer (or dismiss) the open page dialog, then reveal the page again. Only a
  // `confirm` can be answered — the type carries the completion-handler id, so
  // there is no unanswerable-confirm case to guard against here.
  const closeDialog = (accepted: boolean) => {
    const current = dialog;
    setDialog(null);
    void invoke("browser_thaw", { tabId }).catch(() => {});
    if (current?.kind === "confirm") {
      void invoke("browser_dialog_respond", { id: current.id, accepted }).catch(() => {});
    }
  };

  const navigate = (target: string) => {
    const next = navigationTarget(target);
    setUrlInput(next); // reflect the canonical URL (with fragment) in the address bar
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
          onClick={() => void invoke("browser_back", { tabId }).catch(() => {})}
          aria-label={t("browser.back")}
          title={t("browser.back")}
        >
          ‹
        </button>
        <button
          type="button"
          className="browser-chrome-btn"
          onClick={() => void invoke("browser_forward", { tabId }).catch(() => {})}
          aria-label={t("browser.forward")}
          title={t("browser.forward")}
        >
          ›
        </button>
        {loading ? (
          <button
            type="button"
            className="browser-chrome-btn"
            onClick={() => void invoke("browser_stop", { tabId }).catch(() => {})}
            aria-label={t("browser.stop")}
            title={t("browser.stop")}
          >
            ✕
          </button>
        ) : (
          <button
            type="button"
            className="browser-chrome-btn"
            onClick={() => navigate(url)}
            aria-label={t("browser.reload")}
            title={t("browser.reload")}
          >
            ⟳
          </button>
        )}
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
          hidden from a11y — except when an overlay (crash / dialog) is the real content. */}
      <div ref={viewportRef} className="browser-viewport" aria-hidden={crash || dialog ? undefined : true}>
        {dialog && (
          <div className="browser-dialog" role="alertdialog" aria-label={dialog.message}>
            <p className="browser-dialog-message">{dialog.message}</p>
            <div className="browser-dialog-actions">
              {dialog.kind === "confirm" && (
                <button
                  type="button"
                  className="browser-dialog-btn"
                  onClick={() => closeDialog(false)}
                >
                  {t("cancel")}
                </button>
              )}
              <button
                type="button"
                className="browser-dialog-btn browser-dialog-btn--primary"
                onClick={() => closeDialog(true)}
              >
                {t("ok")}
              </button>
            </div>
          </div>
        )}
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
