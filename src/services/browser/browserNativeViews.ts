/**
 * browserNativeViews — the per-window registry of native browser views (WI-1.3 /
 * WI-S0.10 / audit 2026-09-03 L-01).
 *
 * Purpose: one place knows which tabs own a live WKWebView, creates a view once per
 * tab, hides/shows it as its surface leaves and re-enters the screen, and destroys
 * it when the tab is closed. It lives in `services/` because services (the MCP
 * handlers, the policy sync, the tab lifecycle) drive it and ADR-013 forbids a
 * service importing a component; `components/Browser/useBrowserNativeView` is the
 * React adapter over it.
 *
 * **Keep-alive, not destroy-on-unmount.** The surface is mounted for the ACTIVE page
 * only, and unmount used to destroy the webview: a glance at a document reloaded the
 * page, lost its in-page state, and made the driver forget the tab — after which its
 * restarted generation collided with the frontend's monotonic guard and every AI
 * operation on the tab was refused as stale. A web page is a document with state;
 * switching tabs must not reload it. So an unmounted tab is merely occluded
 * (`OCCLUDER.background`), its view alive and driveable in the background.
 *
 * Hazard handled here: occlusion must be enforced against the view that EXISTS. The
 * store entry is seeded before `browser_create` is invoked and `useBrowserOccluder`
 * watches the store, so an overlay already on screen freezes a tab with no native
 * view yet; Rust refuses it, and nothing retries. `resync` once the create resolves
 * is what makes the controller's "the next reconcile retries it" actually arrive.
 *
 * @coordinates-with src-tauri browser commands — browser_create / browser_ai_create / browser_destroy
 * @coordinates-with services/browser/browserOcclusion — hide/show + resync
 * @coordinates-with services/browser/browserTabLifecycle — the destroy trigger (tab close)
 * @coordinates-with components/Browser/useBrowserNativeView — the React adapter
 * @module services/browser/browserNativeViews
 */
import { invoke } from "@tauri-apps/api/core";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import type { BrowserAutomationMode } from "@/stores/tabStoreTypes";
import { browserOcclusion, OCCLUDER } from "./browserOcclusion";
import { browserEventBroker } from "./browserEventBroker";
import { clearNavIntent } from "./navIntent";

/** The create promise per tab — present from first creation until destroy. */
const nativeReady = new Map<string, Promise<void>>();
/** Tabs whose surface is currently mounted (visible). */
const activeMounts = new Set<string>();

/**
 * Start native creation once per tab. The hook and MCP handlers can race when
 * an AI tab is first opened; sharing this promise makes one of them the owner
 * without allowing the other to issue a second approval-gated command.
 */
export function ensureBrowserNativeView(
  tabId: string,
  url: string,
  automationMode: BrowserAutomationMode,
  /** Named profile (WI-P6.1): AI-sandbox only — a persistent isolated store so a
   *  login persists for later reuse. Ignored for the human create path. */
  profile?: string,
): Promise<void> {
  const existing = nativeReady.get(tabId);
  if (existing) return existing;
  const command = automationMode === "human" ? "browser_create" : "browser_ai_create";
  const created = invoke<void>(command, {
    tabId,
    url,
    ...(command === "browser_ai_create" && profile ? { profile } : {}),
  })
    .then(() => {
      // A previous approval denial may have left the tab with a transient
      // error even though this retry now owns a live native view.
      useBrowserUiStore.getState().setError(tabId, null);
      useBrowserUiStore.getState().setLoading(tabId, false);
      // Hazard 1: the view exists NOW. If the surface is not mounted the background
      // occluder is what hides it; either way re-drive the controller.
      if (!activeMounts.has(tabId)) browserOcclusion.addOccluder(tabId, OCCLUDER.background);
      browserOcclusion.resync(tabId);
    })
    .catch((error: unknown) => {
      if (nativeReady.get(tabId) === created) nativeReady.delete(tabId);
      throw error;
    });
  nativeReady.set(tabId, created);
  return created;
}

/** Does the tab have a native view (created, or being created)? */
export function hasBrowserNativeView(tabId: string): boolean {
  return nativeReady.has(tabId);
}

/** Wait until a tab's native view has been registered. */
export async function waitForBrowserNativeView(tabId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let ready = nativeReady.get(tabId);
  while (!ready && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    ready = nativeReady.get(tabId);
  }
  if (!ready) throw new Error("native browser surface unavailable");
  const remaining = Math.max(1, deadline - Date.now());
  await Promise.race([
    ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("native browser surface timed out")), remaining),
    ),
  ]);
}

/**
 * Tear the tab's native view down for good — the tab is CLOSED (or the browser
 * was switched off). Waits for a create still in flight so a view registered after
 * this call cannot be orphaned, then drops every per-tab record: occlusion
 * bookkeeping, pending navigation waiters, prompts raised against the page,
 * navigation intent, the omnibox entry. Idempotent.
 */
export async function destroyBrowserNativeView(tabId: string): Promise<void> {
  const created = nativeReady.get(tabId);
  nativeReady.delete(tabId);
  activeMounts.delete(tabId);
  if (created) await created.catch(() => {});
  await invoke("browser_destroy", { tabId }).catch(() => {});
  browserOcclusion.removeTab(tabId);
  browserEventBroker.cancelTab(tabId);
  // Any prompt raised against this tab describes a page that no longer exists.
  useBrowserApprovalStore.getState().dismissForNavigation(tabId);
  clearNavIntent(tabId);
  useBrowserUiStore.getState().clearForTab(tabId);
}

/** Test-only: forget every native view record without touching the driver. */
export function __resetNativeViews(): void {
  nativeReady.clear();
  activeMounts.clear();
}


/** The tab's surface is on screen: lift the background occluder. */
export function markSurfaceMounted(tabId: string): void {
  activeMounts.add(tabId);
  browserOcclusion.removeOccluder(tabId, OCCLUDER.background);
}

/** The tab's surface left the screen: hide the live view under the background
 *  occluder. Prompts, tickets and the omnibox entry all survive — the page did. */
export function markSurfaceUnmounted(tabId: string): void {
  activeMounts.delete(tabId);
  browserOcclusion.addOccluder(tabId, OCCLUDER.background);
}
