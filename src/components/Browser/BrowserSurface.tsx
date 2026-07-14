/**
 * BrowserSurface — the React surface for an embedded browser tab (WI-1.3, chrome
 * relocated in WI-S1.4).
 *
 * Purpose: owns the native WKWebView for one browser tab and a reserved viewport
 * rect. It creates the native webview on mount, reports the reserved rect's bounds
 * so Rust keeps the native view aligned under it (ResizeObserver), and destroys the
 * webview on unmount. It listens (via `useBrowserNavEvents`) to the native
 * WKNavigationDelegate events and writes the address-bar text + loading flag into
 * `browserUiStore` (ADR-5) — the bottom-bar `BrowserOmnibox` reads them and drives
 * navigation. On `browser://crashed` it freezes the native view and shows a
 * page-crashed reload overlay (WI-1.8); on `browser://dialog` it freezes and shows
 * an alert/confirm modal, answering `confirm()` via `browser_dialog_respond`
 * (WI-1.7). Freezing is required because the native view paints over the DOM. The
 * page paints in the native view over the viewport rect — the rect here is a
 * placeholder, empty, except when a full-cover overlay (crash / dialog) is showing.
 *
 * The nav chrome (back/forward/reload + address bar) is NOT here anymore — it lives
 * in the bottom `StatusBar` as `BrowserOmnibox` (ADR-4). This surface is viewport +
 * full-cover overlays only.
 *
 * `Editor.tsx` mounts this for `kind === "browser"` tabs (R1). Store access is via
 * selectors + `getState()` in callbacks (no destructuring).
 *
 * @coordinates-with src-tauri browser commands — browser_create/set_bounds/destroy/freeze/thaw
 * @coordinates-with components/Browser/useBrowserNavEvents — native nav-delegate events
 * @coordinates-with stores/browserUiStore — writes urlInput/loading; seeds/clears the entry
 * @coordinates-with services/browser/browserNavigation — reloadBrowser for the crash overlay
 * @coordinates-with stores/tabStore.ts — reads the BrowserTab url, updates it on navigate
 * @module components/Browser/BrowserSurface
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { reloadBrowser } from "@/services/browser/browserNavigation";
import {
  useBrowserNavEvents,
  type BrowserDialog,
  type CrashAction,
} from "./useBrowserNavEvents";
import "./browser-surface.css";

export function BrowserSurface({ tabId }: { tabId: string }): React.ReactElement {
  const { t } = useTranslation("common");
  const url = useTabStore((s) => {
    const tab = s.findTabById(tabId);
    return tab && isBrowserTab(tab) ? tab.url : "";
  });

  // Non-null while the web content process is down (WI-1.8). `action` is
  // "auto-reload" (native is already reloading) or "manual" (needs the user).
  const [crash, setCrash] = useState<{ action: CrashAction } | null>(null);
  // Non-null while a page JS dialog (alert/confirm) is open (WI-1.7).
  const [dialog, setDialog] = useState<BrowserDialog | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Create the native webview on mount; destroy it on unmount. Seed/clear the
  // transient omnibox UI state (ADR-5) alongside the native view's lifecycle so
  // the bottom-bar omnibox has this tab's url the moment it renders.
  useEffect(() => {
    let active = true;
    useBrowserUiStore.getState().ensureEntry(tabId, url);
    // The window is derived Rust-side from the invoking WebviewWindow (a caller
    // can't assert a label), so we pass only tabId + url.
    const created = invoke("browser_create", { tabId, url });
    void created
      .catch(() => {})
      .finally(() => active && useBrowserUiStore.getState().setLoading(tabId, false));
    return () => {
      active = false;
      // Destroy only AFTER create settles: a create that resolves after this
      // unmount would otherwise register a native webview this destroy already
      // missed, orphaning a content process nothing tears down.
      void created
        .catch(() => {})
        .then(() => void invoke("browser_destroy", { tabId }).catch(() => {}));
      useBrowserUiStore.getState().clearForTab(tabId);
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

  // Track native-driven navigation (redirects, AI clicks, reload) so the omnibox
  // (reading browserUiStore) reflects where the WKWebView actually is — the
  // delegate (nav_delegate_macos.rs) is the source of truth once a load is underway.
  useBrowserNavEvents(tabId, {
    onNavigated: (next, generation) => {
      const ui = useBrowserUiStore.getState();
      ui.setUrlInput(tabId, next);
      ui.setLoading(tabId, true);
      // Record the generation with the URL: driver operations are stamped with it,
      // so one authorized against the previous page is refused by the Rust gate.
      useTabStore.getState().updateBrowserTab(tabId, { url: next, generation });
    },
    onLoaded: (next) => {
      const ui = useBrowserUiStore.getState();
      ui.setUrlInput(tabId, next);
      ui.setLoading(tabId, false);
      // A clean load means the process recovered — reveal the native view again.
      // The thaw is fired here, not inside the `setCrash` updater: React may
      // re-invoke an updater (StrictMode), which would thaw twice.
      if (crash) {
        setCrash(null);
        void invoke("browser_thaw", { tabId }).catch(() => {});
      }
      useTabStore.getState().updateBrowserTab(tabId, { url: next });
    },
    // The webview owns the back/forward list; mirror it so the omnibox can disable
    // its history controls instead of offering no-op buttons (WI-S1.6).
    onHistoryChanged: (canGoBack, canGoForward) =>
      useBrowserUiStore.getState().setHistory(tabId, canGoBack, canGoForward),
    onFailed: () => useBrowserUiStore.getState().setLoading(tabId, false),
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

  return (
    <div className="browser-surface">
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
                  reloadBrowser(tabId);
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
