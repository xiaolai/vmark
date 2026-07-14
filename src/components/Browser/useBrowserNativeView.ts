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
import { clearNavIntent } from "@/services/browser/navIntent";
import { errorMessage } from "@/utils/errorMessage";

/** The mount that currently owns each tab's native webview — see hazard 1 above. */
const mountTokens = new Map<string, number>();
let nextMountToken = 0;

export function useBrowserNativeView(
  tabId: string,
  url: string,
  layoutVersion: string,
  viewportRef: RefObject<HTMLDivElement | null>,
): void {
  // Create on mount; destroy on unmount. Seed/clear the transient omnibox state (ADR-5)
  // alongside the native view's lifecycle so the bottom bar has this tab's url the moment
  // it renders.
  useEffect(() => {
    let active = true;
    const token = ++nextMountToken;
    mountTokens.set(tabId, token);
    useBrowserUiStore.getState().ensureEntry(tabId, url);
    // The window is derived Rust-side from the invoking WebviewWindow (a caller can't
    // assert a label), so we pass only tabId + url.
    const created = invoke("browser_create", { tabId, url });
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
