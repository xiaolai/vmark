/**
 * browserOcclusion — the single freeze/thaw authority for every browser tab (WI-S0.8).
 *
 * Purpose: the native `WKWebView` is added as a subview ABOVE the Tauri webview, so
 * it paints over all React DOM inside its rect — z-index cannot reach it. Any overlay
 * covering that rect must therefore *freeze* the native view (hide it) while it is up,
 * and thaw it once the last one goes.
 *
 * `OcclusionController` (occlusion.ts) already implements this correctly —
 * reference-counted occluders, a serialized op loop per tab, desired-vs-confirmed
 * reconciliation — but it was never instantiated. Meanwhile `BrowserSurface` invoked
 * `browser_freeze`/`browser_thaw` **directly**, with no reference counting: with a
 * crash overlay and a JS dialog both up, dismissing either one thawed the view out
 * from under the other and revealed the live page beneath it. This module wires the
 * controller to the real Tauri driver and is the ONLY thing that may call those
 * commands. Every occluder goes through `addOccluder`/`removeOccluder`.
 *
 * @coordinates-with services/browser/occlusion — the controller (pure orchestration)
 * @coordinates-with src-tauri browser_freeze/browser_thaw — the native driver
 * @coordinates-with components/Browser/BrowserApprovalDialog — the approval occluder
 * @coordinates-with components/Browser/BrowserSurface — crash + page-dialog occluders
 * @module services/browser/browserOcclusion
 */
import { invoke } from "@tauri-apps/api/core";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { OcclusionController, type OcclusionDriver } from "./occlusion";

/** The native side. Rejections are the controller's business: a failed freeze leaves
 *  the confirmed state untouched so the next reconcile retries it, and the desired
 *  state never flips — we never show a live frame under an overlay because a native
 *  call happened to fail. */
const tauriDriver: OcclusionDriver = {
  freeze: (tabId) => invoke("browser_freeze", { tabId }),
  thaw: (tabId) => invoke("browser_thaw", { tabId }),
};

/**
 * Stable occluder ids. Reference counting only works if each source uses ONE id, so
 * they are named here rather than spelled inline at each call site.
 */
export const OCCLUDER = {
  /** The page-crashed recovery overlay (WI-1.8). */
  crash: "crash-overlay",
  /** A page `alert()` / `confirm()` (WI-1.7). */
  dialog: "page-dialog",
  /** The AI-action approval prompt (WI-S0.8). */
  approval: "approval-dialog",
} as const;

/** The one controller. Do not construct another — reference counts must be shared. */
const controller = new OcclusionController(tauriDriver);

/**
 * Mirror the controller's *intent* into `browserUiStore` so React can paint an opaque
 * placeholder over the rect while the native view is hidden (WI-SOC.1b).
 *
 * The intent, not the driver's confirmation: the placeholder must be up BEFORE the
 * view goes away, never a frame after it. A freeze that fails still keeps the intent
 * "hidden", and the placeholder stays — which is the safe way round. Showing a live
 * page under an overlay because a native call failed is the failure we refuse.
 */
function syncFrozen(tabId: string): void {
  useBrowserUiStore.getState().setFrozen(tabId, controller.isFrozen(tabId));
}

/**
 * The occlusion facade. Same shape as the controller, plus the store mirror — every
 * caller goes through this, so `frozen` can never drift from the reference counts.
 */
export const browserOcclusion = {
  addOccluder(tabId: string, occluderId: string): void {
    controller.addOccluder(tabId, occluderId);
    syncFrozen(tabId);
  },
  removeOccluder(tabId: string, occluderId: string): void {
    controller.removeOccluder(tabId, occluderId);
    syncFrozen(tabId);
  },
  /** The tab's view is gone: drop the bookkeeping outright (no thaw, nothing to show).
   *  The store entry is dropped by BrowserSurface's own unmount cleanup. */
  removeTab(tabId: string): void {
    controller.removeTab(tabId);
  },
  isFrozen(tabId: string): boolean {
    return controller.isFrozen(tabId);
  },
};
