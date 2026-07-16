/**
 * useBrowserNativeView — owns one browser tab's native WKWebView (WI-1.3 / WI-S0.10).
 *
 * Purpose: create the native view on mount, keep it aligned under the reserved rect, and
 * destroy it on unmount. Split out of `BrowserSurface` so that component is what its name
 * says — a surface — and so this lifecycle, which is where the subtle native races live,
 * is testable on its own.
 *
 * Three hazards it exists to handle:
 *
 *  1. **A deferred destroy must not kill a newer view.** A rapid switch away and back
 *     remounts the surface while the first mount's `browser_create` is still in flight.
 *     That mount's destroy is deferred until its create settles — by which time the SECOND
 *     mount may already own a fresh native view for the same tab id. So each mount takes a
 *     token and only the newest one may destroy. (Rust evicts a superseded view on its
 *     side too: the native map is keyed by tab id, so an insert would otherwise orphan the
 *     old subview — a live, invisible page painting over the UI.)
 *
 *  2. **Occlusion must be enforced against the view that exists, not the one we intend.**
 *     The store entry is seeded before `browser_create` is invoked, and `useBrowserOccluder`
 *     watches the store — so an overlay already on screen freezes a tab with no native view
 *     yet, Rust refuses it, and nothing retries. `resync` once the create resolves is what
 *     makes the controller's "the next reconcile retries it" actually arrive.
 *
 *  3. **The rect can MOVE without resizing.** A ResizeObserver fires on size. A terminal
 *     switching sides, or a bar appearing above the viewport, changes the rect's x/y
 *     silently — and the native view would stay where it used to be, painting over
 *     unrelated UI. `layoutVersion` re-runs the report whenever the shell reflows.
 *
 * @coordinates-with src-tauri browser commands — browser_create / set_bounds / destroy
 * @coordinates-with services/browser/browserOcclusion — resync once the view is real
 * @coordinates-with stores/browserUiStore — seeds/clears the tab's omnibox entry
 * @module components/Browser/useBrowserNativeView
 */
import { useEffect, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { browserOcclusion } from "@/services/browser/browserOcclusion";
import { browserEventBroker } from "@/services/browser/browserEventBroker";
import { clearNavIntent } from "@/services/browser/navIntent";
import { errorMessage } from "@/utils/errorMessage";
import type { BrowserAutomationMode } from "@/stores/tabStoreTypes";

/** The mount that currently owns each tab's native webview — see hazard 1 above. */
const mountTokens = new Map<string, number>();
let nextMountToken = 0;
const nativeReady = new Map<string, Promise<void>>();
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
      if (activeMounts.has(tabId)) browserOcclusion.resync(tabId);
    })
    .catch((error: unknown) => {
      if (nativeReady.get(tabId) === created) nativeReady.delete(tabId);
      throw error;
    });
  nativeReady.set(tabId, created);
  return created;
}

/** Wait until an activated tab's React surface has registered its native view. */
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

export function useBrowserNativeView(
  tabId: string,
  url: string,
  layoutVersion: string,
  viewportRef: RefObject<HTMLDivElement | null>,
  automationMode: BrowserAutomationMode = "human",
): void {
  // Create on mount; destroy on unmount. Seed/clear the transient omnibox state (ADR-5)
  // alongside the native view's lifecycle so the bottom bar has this tab's url the moment
  // it renders.
  useEffect(() => {
    let active = true;
    const token = ++nextMountToken;
    mountTokens.set(tabId, token);
    activeMounts.add(tabId);
    useBrowserUiStore.getState().ensureEntry(tabId, url);
    const created = ensureBrowserNativeView(tabId, url, automationMode);
    void created
      .then(() => {
        // The native view exists NOW — not when the store entry above was seeded. Hazard 2.
        if (active) browserOcclusion.resync(tabId);
      })
      .catch((e: unknown) => {
        // A create that fails leaves NO native view at all — the tab would sit there as an
        // empty rect forever. Say so (WI-S0.9).
        if (active) useBrowserUiStore.getState().setError(tabId, errorMessage(e));
      })
      .finally(() => active && useBrowserUiStore.getState().setLoading(tabId, false));

    return () => {
      active = false;
      if (mountTokens.get(tabId) === token) activeMounts.delete(tabId);
      if (nativeReady.get(tabId) === created) nativeReady.delete(tabId);
      // Destroy only AFTER create settles: a create that resolves after this unmount would
      // otherwise register a native webview this destroy already missed, orphaning a
      // content process nothing tears down.
      void created
        .catch(() => {})
        .then(() => {
          if (mountTokens.get(tabId) !== token) return; // hazard 1
          mountTokens.delete(tabId);
          void invoke("browser_destroy", { tabId }).catch(() => {});
        });
      useBrowserUiStore.getState().clearForTab(tabId);
      // The native view is going away, so drop its occlusion bookkeeping outright — no
      // thaw, there is nothing left to show. A stale occluder left behind would freeze the
      // NEXT view created for this tab id.
      browserOcclusion.removeTab(tabId);
      if (mountTokens.get(tabId) === token) browserEventBroker.cancelTab(tabId);
      // Any prompt raised against this tab describes a page that is being destroyed.
      useBrowserApprovalStore.getState().dismissForNavigation(tabId);
      clearNavIntent(tabId);
    };
    // `url` is the initial navigation target only; navigation is explicit after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Keep the native view aligned under the reserved rect — on resize AND on reflow (hazard 3).
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
  }, [tabId, layoutVersion, viewportRef]);
}
