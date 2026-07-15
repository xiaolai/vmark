/**
 * BrowserSurface — the React surface for an embedded browser tab (WI-1.3, chrome
 * relocated in WI-S1.4).
 *
 * Purpose: a reserved viewport rect for one browser tab, plus the full-cover overlays
 * that can replace it. The native WKWebView's own lifecycle — create, align, destroy,
 * and the races around all three — belongs to `useBrowserNativeView`; this component
 * reserves the rect and hands it over. It listens (via `useBrowserNavEvents`) to the native
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
 * @coordinates-with components/Browser/useBrowserNativeView — the native view's lifecycle
 * @coordinates-with components/Browser/useBrowserNavEvents — native nav-delegate events
 * @coordinates-with stores/browserUiStore — writes urlInput/loading; seeds/clears the entry
 * @coordinates-with services/browser/browserNavigation — reloadBrowser for the crash overlay
 * @coordinates-with stores/tabStore.ts — reads the BrowserTab url, updates it on navigate
 * @module components/Browser/BrowserSurface
 */

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useBrowserNativeView } from "./useBrowserNativeView";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { reloadBrowser } from "@/services/browser/browserNavigation";
import { browserOcclusion, OCCLUDER } from "@/services/browser/browserOcclusion";
import { takeNavIntent } from "@/services/browser/navIntent";
import { useBrowserHistoryStore } from "@/stores/browserHistoryStore";
import { useWindowLabel } from "@/contexts/WindowContext";
import {
  useBrowserNavEvents,
  type BrowserDialog,
  type CrashAction,
} from "./useBrowserNavEvents";
import { BrowserOverlays } from "./BrowserOverlays";
import "./browser-surface.css";
import { useUIStore } from "@/stores/uiStore";

export function BrowserSurface({ tabId }: { tabId: string }): React.ReactElement {
  const windowLabel = useWindowLabel();
  const url = useTabStore((s) => {
    const tab = s.findTabById(tabId);
    return tab && isBrowserTab(tab) ? tab.url : "";
  });
  const automationMode = useTabStore((s) => {
    const tab = s.findTabById(tabId);
    return tab && isBrowserTab(tab) ? tab.automationMode ?? "human" : "human";
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
  // `effectiveTerminalPosition` matters as much as `terminalVisible`: moving the terminal
  // from the bottom to the side changes the rect's x/y WITHOUT changing its size or the
  // visible flag, so neither the ResizeObserver nor a visibility-only signal would notice,
  // and the native view would stay where the terminal used to be. (Audit finding, High.)
  const layoutVersion = useUIStore(
    (s) =>
      `${s.sidebarVisible}|${s.terminalVisible}|${s.effectiveTerminalPosition}` +
      `|${s.statusBarVisible}|${s.universalToolbarVisible}`,
  );

  // The native view itself: create, keep aligned, destroy — plus the create/destroy race,
  // the post-create occlusion resync, and reflow-driven bounds. See useBrowserNativeView.
  useBrowserNativeView(tabId, url, layoutVersion, viewportRef, automationMode);

  // An error overlay is DOM, and the native view paints over all DOM in its rect — so a
  // load failure used to render the message underneath a live (or blank) web page, where
  // nobody could see it. Freeze the view for as long as there is an error to show.
  // (Audit finding, High.) Covers a failed create too: the surface has an error and no
  // native view, and freezing a tab with no view is a harmless no-op.
  // Keyed on WHETHER there is an error, not on WHICH error. Depending on the message
  // string meant that one failure replacing another (a retry that fails differently) tore
  // the occluder down and put it back, opening an asynchronous thaw-then-freeze window in
  // which the page was visible again with the error overlay still on screen. Nothing about
  // the freeze depends on the text. (Audit verification, PARTIAL.)
  const hasError = error !== null;
  useEffect(() => {
    if (!hasError) return;
    browserOcclusion.addOccluder(tabId, OCCLUDER.error);
    return () => browserOcclusion.removeOccluder(tabId, OCCLUDER.error);
  }, [tabId, hasError]);

  // Track native-driven navigation (redirects, AI clicks, reload) so the omnibox
  // (reading browserUiStore) reflects where the WKWebView actually is — the
  // delegate (nav_delegate_macos.rs) is the source of truth once a load is underway.
  useBrowserNavEvents(tabId, {
    onNavigated: (next, generation, redirected) => {
      const ui = useBrowserUiStore.getState();
      ui.setUrlInput(tabId, next);
      ui.setLoading(tabId, true);
      ui.setError(tabId, null); // a fresh load supersedes the previous failure
      // Record where the user went, and how they set off (WI-S2.2). A redirect is
      // something the SITE did — it folds into the entry rather than becoming its own.
      useBrowserHistoryStore.getState().record(windowLabel, {
        tabId,
        url: next,
        transitionKind: redirected ? "redirect" : takeNavIntent(tabId),
      });
      // R7a: authority and prompts lapse with the page. A pending approval describes
      // an action on the page we just left — answering it would authorize that action
      // against whatever loaded instead. The driver clears its own one-shots on
      // navigation-start; this keeps the frontend's copy in step.
      useBrowserApprovalStore.getState().dismissForNavigation(tabId);
      // Record the generation with the URL: driver operations are stamped with it,
      // so one authorized against the previous page is refused by the Rust gate.
      useTabStore.getState().updateBrowserTab(tabId, { url: next, generation });
    },
    onLoaded: (next, title, generation) => {
      const ui = useBrowserUiStore.getState();
      ui.setUrlInput(tabId, next);
      ui.setLoading(tabId, false);
      // The title only exists once the page finished. It is attached to the entry it
      // belongs to — a slow finish for a page we already left must not retitle this one.
      if (title) useBrowserHistoryStore.getState().setTitle(windowLabel, tabId, next, title);
      // A clean load means the process recovered — release the crash occluder. The
      // release is fired here, not inside the `setCrash` updater: React may re-invoke
      // an updater (StrictMode), which would release twice.
      if (crash) {
        setCrash(null);
        browserOcclusion.removeOccluder(tabId, OCCLUDER.crash);
      }
      // Stamped with the generation of the page that finished: a late `loaded` for a page
      // this tab has already left carries an older generation, and the store drops it
      // rather than regress the url/title (audit, Medium).
      useTabStore.getState().updateBrowserTab(tabId, { url: next, generation });
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
