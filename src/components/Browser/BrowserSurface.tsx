/**
 * BrowserSurface — the React surface for an embedded browser tab. BrowserChrome
 * owns the webpage tabs and navigation controls.
 *
 * Purpose: a reserved viewport rect for one browser tab, plus the full-cover overlays
 * that can replace it. The native WKWebView's own lifecycle — create, align, hide on
 * unmount, destroy on close, and the races around them — belongs to
 * `useBrowserNativeView`; this component reserves the rect and hands it over.
 *
 * It renders, it does not listen (audit 2026-09-03 L-01). The native nav-delegate
 * events are consumed once per window by `services/browser/browserTabEvents`, which
 * writes url/loading/history/error/crash/dialog/popup into `browserUiStore` for EVERY
 * tab of the window — mounted or not, since native views now stay alive in the
 * background. This surface reads that store for its tab and paints the overlays:
 * the frozen placeholder, a load failure with retry, the crash overlay, a page
 * `alert`/`confirm` (answered via `browser_dialog_respond`), and a blocked-popup
 * notice with "open in new tab".
 *
 * Freezing goes through `browserOcclusion` (WI-S0.8), never a raw `browser_freeze`:
 * occluders are reference-counted, so a crash overlay, a page dialog and an approval
 * prompt can be up at once without one thawing the view out from under another.
 *
 * `Editor.tsx` mounts this for `kind === "browser"` tabs (R1). Store access is via
 * selectors + `getState()` in callbacks (no destructuring).
 *
 * @coordinates-with components/Browser/useBrowserNativeView — the native view's lifecycle
 * @coordinates-with services/browser/browserTabEvents — writes the per-tab state this reads
 * @coordinates-with stores/browserUiStore — the per-tab UI mirror
 * @coordinates-with services/browser/browserNavigation — reloadBrowser for the crash overlay
 * @module components/Browser/BrowserSurface
 */

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useBrowserNativeView } from "./useBrowserNativeView";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { reloadBrowser } from "@/services/browser/browserNavigation";
import { browserOcclusion, OCCLUDER } from "@/services/browser/browserOcclusion";
import { activateTabInFocusedPane } from "@/services/navigation/activateTabInFocusedPane";
import { useWindowLabel } from "@/contexts/WindowContext";
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

  const viewportRef = useRef<HTMLDivElement>(null);
  // Everything painted over the rect comes from the per-tab UI mirror.
  const frozen = useBrowserUiStore((s) => s.entries[tabId]?.frozen ?? false);
  const error = useBrowserUiStore((s) => s.entries[tabId]?.error ?? null);
  const crash = useBrowserUiStore((s) => s.entries[tabId]?.crash ?? null);
  const dialog = useBrowserUiStore((s) => s.entries[tabId]?.dialog ?? null);
  const popup = useBrowserUiStore((s) => s.entries[tabId]?.blockedPopup ?? null);
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

  // The native view itself: create, keep aligned, hide/show — plus the post-create
  // occlusion resync and reflow-driven bounds. See useBrowserNativeView.
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

  // Answer (or dismiss) the open page dialog, then release its occluder. Only a
  // `confirm` can be answered — the type carries the completion-handler id, so
  // there is no unanswerable-confirm case to guard against here.
  const closeDialog = (accepted: boolean) => {
    const current = useBrowserUiStore.getState().entries[tabId]?.dialog ?? null;
    useBrowserUiStore.getState().setDialog(tabId, null);
    browserOcclusion.removeOccluder(tabId, OCCLUDER.dialog);
    if (current?.kind === "confirm") {
      void invoke("browser_dialog_respond", { id: current.id, accepted }).catch(() => {});
    }
  };

  const recover = () => {
    useBrowserUiStore.getState().setCrash(tabId, null);
    browserOcclusion.removeOccluder(tabId, OCCLUDER.crash);
    reloadBrowser(tabId);
  };

  // A blocked popup is offered as a new HUMAN page: the user chose to follow it.
  const openPopup = () => {
    const current = useBrowserUiStore.getState().entries[tabId]?.blockedPopup;
    useBrowserUiStore.getState().setBlockedPopup(tabId, null);
    if (!current) return;
    const id = useTabStore.getState().createBrowserPage(windowLabel, current.url);
    activateTabInFocusedPane(windowLabel, id);
  };
  const dismissPopup = () => useBrowserUiStore.getState().setBlockedPopup(tabId, null);

  return (
    <div className="browser-surface">
      {/* The viewport is a placeholder the native view paints over, so it is
          hidden from a11y — except when an overlay (crash / dialog) is the real content. */}
      <div
        ref={viewportRef}
        className="browser-viewport"
        aria-hidden={crash || dialog || error || popup ? undefined : true}
      >
        <BrowserOverlays
          frozen={frozen}
          error={error}
          crash={crash}
          dialog={dialog}
          popup={popup}
          onRetry={() => reloadBrowser(tabId)}
          onCloseDialog={closeDialog}
          onRecover={recover}
          onOpenPopup={openPopup}
          onDismissPopup={dismissPopup}
        />
      </div>
    </div>
  );
}
