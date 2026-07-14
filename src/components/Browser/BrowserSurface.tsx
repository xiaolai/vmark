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
 * Freezing goes through `browserOcclusion` (WI-S0.8), never a raw `browser_freeze`:
 * occluders are reference-counted, so a crash overlay, a page dialog and an approval
 * prompt can be up at once without one thawing the view out from under another.
 *
 * A navigation (or the surface unmounting) also dismisses any approval prompt raised
 * against this tab — R7a: authority and prompts lapse with the page they described.
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
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { reloadBrowser } from "@/services/browser/browserNavigation";
import { errorMessage } from "@/utils/errorMessage";
import { browserOcclusion, OCCLUDER } from "@/services/browser/browserOcclusion";
import {
  useBrowserNavEvents,
  type BrowserDialog,
  type CrashAction,
} from "./useBrowserNavEvents";
import { BrowserOverlays } from "./BrowserOverlays";
import "./browser-surface.css";
import { useUIStore } from "@/stores/uiStore";

/**
 * The mount that currently owns each tab's native webview (WI-S0.10).
 *
 * A rapid switch away and back remounts the surface while the first mount's
 * `browser_create` is still in flight. That mount's `destroy` is deferred until its
 * create settles — and by then the SECOND mount may already own a fresh native view
 * for the same tab id. Firing the stale destroy then would tear down the live view and
 * leave the tab blank. So each mount takes a token, and only the newest one may
 * destroy. (Rust evicts a superseded view on its side too — belt and braces, since the
 * native map is keyed by tab id and an insert would otherwise orphan the old subview.)
 */
const mountTokens = new Map<string, number>();
let nextMountToken = 0;

export function BrowserSurface({ tabId }: { tabId: string }): React.ReactElement {
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
  // True while an occluder has the native view hidden (WI-SOC.1b). Owned by
  // `browserOcclusion`, which is the only writer.
  const frozen = useBrowserUiStore((s) => s.entries[tabId]?.frozen ?? false);
  // The last failure on this tab, surfaced rather than swallowed (WI-S0.9).
  const error = useBrowserUiStore((s) => s.entries[tabId]?.error ?? null);
  // Any layout state that can MOVE the reserved rect without resizing it (WI-S0.3b).
  // Cheap boolean join: it changes only when the shell actually reflows.
  const layoutVersion = useUIStore(
    (s) =>
      `${s.sidebarVisible}|${s.terminalVisible}|${s.statusBarVisible}|${s.universalToolbarVisible}`,
  );

  // Create the native webview on mount; destroy it on unmount. Seed/clear the
  // transient omnibox UI state (ADR-5) alongside the native view's lifecycle so
  // the bottom-bar omnibox has this tab's url the moment it renders.
  useEffect(() => {
    let active = true;
    const token = ++nextMountToken;
    mountTokens.set(tabId, token);
    useBrowserUiStore.getState().ensureEntry(tabId, url);
    // The window is derived Rust-side from the invoking WebviewWindow (a caller
    // can't assert a label), so we pass only tabId + url.
    const created = invoke("browser_create", { tabId, url });
    void created
      .catch((e: unknown) => {
        // A create that fails leaves NO native view at all — the tab would sit there
        // as an empty rect forever. Say so (WI-S0.9).
        if (active) useBrowserUiStore.getState().setError(tabId, errorMessage(e));
      })
      .finally(() => active && useBrowserUiStore.getState().setLoading(tabId, false));
    return () => {
      active = false;
      // Destroy only AFTER create settles: a create that resolves after this
      // unmount would otherwise register a native webview this destroy already
      // missed, orphaning a content process nothing tears down.
      void created
        .catch(() => {})
        .then(() => {
          // Only the mount that still owns this tab may destroy it (WI-S0.10).
          if (mountTokens.get(tabId) !== token) return;
          mountTokens.delete(tabId);
          void invoke("browser_destroy", { tabId }).catch(() => {});
        });
      useBrowserUiStore.getState().clearForTab(tabId);
      // The native view is going away, so drop its occlusion bookkeeping outright —
      // no thaw, there is nothing left to show. Leaving a stale occluder behind would
      // freeze the NEXT view created for this tab id.
      browserOcclusion.removeTab(tabId);
      // Any prompt raised against this tab describes a page that is being destroyed.
      useBrowserApprovalStore.getState().dismissForNavigation(tabId);
    };
    // `url` is the initial navigation target only; navigation is explicit after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Report the reserved rect's viewport bounds to Rust on layout/resize so the
  // native view stays aligned under the placeholder.
  //
  // `layoutVersion` is why this is not a ResizeObserver alone (WI-S0.3b): the observer
  // fires on SIZE. A panel that moves the rect without resizing it — a terminal
  // switching sides, a bar appearing above it, a split pane rebalancing — changes the
  // rect's x/y silently, and the native view would sit where it used to be, painting
  // over unrelated UI. Re-run whenever the layout state that can move us changes.
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
  }, [tabId, layoutVersion]);

  // Track native-driven navigation (redirects, AI clicks, reload) so the omnibox
  // (reading browserUiStore) reflects where the WKWebView actually is — the
  // delegate (nav_delegate_macos.rs) is the source of truth once a load is underway.
  useBrowserNavEvents(tabId, {
    onNavigated: (next, generation) => {
      const ui = useBrowserUiStore.getState();
      ui.setUrlInput(tabId, next);
      ui.setLoading(tabId, true);
      ui.setError(tabId, null); // a fresh load supersedes the previous failure
      // R7a: authority and prompts lapse with the page. A pending approval describes
      // an action on the page we just left — answering it would authorize that action
      // against whatever loaded instead. The driver clears its own one-shots on
      // navigation-start; this keeps the frontend's copy in step.
      useBrowserApprovalStore.getState().dismissForNavigation(tabId);
      // Record the generation with the URL: driver operations are stamped with it,
      // so one authorized against the previous page is refused by the Rust gate.
      useTabStore.getState().updateBrowserTab(tabId, { url: next, generation });
    },
    onLoaded: (next) => {
      const ui = useBrowserUiStore.getState();
      ui.setUrlInput(tabId, next);
      ui.setLoading(tabId, false);
      // A clean load means the process recovered — release the crash occluder. The
      // release is fired here, not inside the `setCrash` updater: React may re-invoke
      // an updater (StrictMode), which would release twice.
      if (crash) {
        setCrash(null);
        browserOcclusion.removeOccluder(tabId, OCCLUDER.crash);
      }
      useTabStore.getState().updateBrowserTab(tabId, { url: next });
    },
    // The webview owns the back/forward list; mirror it so the omnibox can disable
    // its history controls instead of offering no-op buttons (WI-S1.6).
    onHistoryChanged: (canGoBack, canGoForward) =>
      useBrowserUiStore.getState().setHistory(tabId, canGoBack, canGoForward),
    onFailed: (message) => {
      // Offline, DNS failure, TLS rejection, a refused connection: the native side knows
      // exactly what went wrong and used to tell nobody (WI-S0.9).
      useBrowserUiStore.getState().setError(tabId, message);
    },
    onCrashed: (action) => {
      // The native view still paints over the DOM after a crash; freeze it so the
      // recovery overlay is visible in its place (WI-1.4 occlusion / WI-1.8). Via the
      // reference-counted controller, so a page dialog or approval prompt already
      // freezing this tab is not disturbed — and neither can thaw the view out from
      // under the other (WI-S0.8).
      setCrash({ action });
      browserOcclusion.addOccluder(tabId, OCCLUDER.crash);
    },
    onDialog: (d) => {
      // Same occlusion story: freeze the native view so the DOM dialog shows.
      setDialog(d);
      browserOcclusion.addOccluder(tabId, OCCLUDER.dialog);
    },
  });

  // Answer (or dismiss) the open page dialog, then release its occluder. Only a
  // `confirm` can be answered — the type carries the completion-handler id, so
  // there is no unanswerable-confirm case to guard against here.
  const closeDialog = (accepted: boolean) => {
    const current = dialog;
    setDialog(null);
    browserOcclusion.removeOccluder(tabId, OCCLUDER.dialog);
    if (current?.kind === "confirm") {
      void invoke("browser_dialog_respond", { id: current.id, accepted }).catch(() => {});
    }
  };

  return (
    <div className="browser-surface">
      {/* The viewport is a placeholder the native view paints over, so it is
          hidden from a11y — except when an overlay (crash / dialog) is the real content. */}
      <div ref={viewportRef} className="browser-viewport" aria-hidden={crash || dialog || error ? undefined : true}>
        <BrowserOverlays
          frozen={frozen}
          error={error}
          crash={crash}
          dialog={dialog}
          onRetry={() => reloadBrowser(tabId)}
          onCloseDialog={closeDialog}
          onRecover={() => {
            setCrash(null);
            browserOcclusion.removeOccluder(tabId, OCCLUDER.crash);
            reloadBrowser(tabId);
          }}
        />
      </div>
    </div>
  );
}
