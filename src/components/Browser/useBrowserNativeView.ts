/**
 * useBrowserNativeView — the React adapter over one browser tab's native WKWebView
 * (WI-1.3 / WI-S0.10).
 *
 * Purpose: on mount, make sure the tab's view exists and is visible; keep it aligned
 * under the reserved rect while mounted; on unmount, hide it. The registry itself —
 * create once, show/hide, destroy on tab close — is `services/browser/browserNativeViews`
 * (audit 2026-09-03 L-01: views are kept alive across tab switches).
 *
 * Hazard handled here: **the rect can MOVE without resizing.** A ResizeObserver fires
 * on size. A terminal switching sides, or a bar appearing above the viewport, changes
 * the rect's x/y silently — and the native view would stay where it used to be,
 * painting over unrelated UI. `layoutVersion` re-runs the report whenever the shell
 * reflows.
 *
 * Bounds go through ONE `browserBounds` channel for the tab's whole mount (audit round
 * 3, #167): resize, reflow and retry all feed the same serialized, latest-wins pusher,
 * so an older rect can never land after a newer one, and the first send waits for the
 * create to settle instead of spending retries against a view that does not exist yet.
 * Unmount disposes the channel, which ends its retry loop.
 *
 * @coordinates-with services/browser/browserNativeViews — the registry
 * @coordinates-with components/Browser/browserBounds — the bounds channel
 * @coordinates-with stores/browserUiStore — seeds the tab's omnibox entry
 * @module components/Browser/useBrowserNativeView
 */
import { useEffect, useRef, type RefObject } from "react";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import {
  ensureBrowserNativeView,
  markSurfaceMounted,
  markSurfaceUnmounted,
} from "@/services/browser/browserNativeViews";
import {
  classifyCommandError,
  commandErrorMessage,
} from "@/services/commands/commandError";
import type { SerializedPusher } from "@/services/browser/serializedPusher";
import type { BrowserAutomationMode } from "@/stores/tabStoreTypes";
import { makeBoundsPusher, type BoundsRect } from "./browserBounds";

export function useBrowserNativeView(
  tabId: string,
  url: string,
  layoutVersion: string,
  viewportRef: RefObject<HTMLDivElement | null>,
  automationMode: BrowserAutomationMode = "human",
): void {
  // The tab's bounds channel — alive for exactly this mount, shared with the bounds
  // effect below through a ref because that effect re-runs on every reflow while the
  // channel must not (two channels would let an older in-flight rect land last).
  const boundsRef = useRef<SerializedPusher<BoundsRect> | null>(null);

  // Create on first mount; show on every mount; hide on unmount. Seed the transient
  // omnibox state (ADR-5) alongside so the bottom bar has this tab's url the moment it
  // renders. The destroy lives in `destroyBrowserNativeView` (tab close), not here.
  useEffect(() => {
    let active = true;
    useBrowserUiStore.getState().ensureEntry(tabId, url);
    markSurfaceMounted(tabId);
    // `ensureBrowserNativeView` re-drives occlusion itself once the view exists; a
    // second resync here was the same work twice.
    const created = ensureBrowserNativeView(tabId, url, automationMode);
    const bounds = makeBoundsPusher(tabId, created);
    boundsRef.current = bounds;
    void created
      .catch((e: unknown) => {
        // A create that fails leaves NO native view at all — the tab would sit there as an
        // empty rect forever. Say so (WI-S0.9).
        //
        // Except when it is only awaiting approval (WI-14): the approval prompt
        // owns that interaction and the MCP handler retries once the user
        // decides, so a persistent error under the prompt is a second, wrong
        // story about the same event — and before the error was typed it read
        // as the raw token "APPROVAL_REQUIRED".
        if (!active || classifyCommandError(e) === "needs-approval") return;
        useBrowserUiStore.getState().setError(tabId, commandErrorMessage(e));
      })
      .finally(() => active && useBrowserUiStore.getState().setLoading(tabId, false));

    return () => {
      active = false;
      bounds.dispose();
      boundsRef.current = null;
      markSurfaceUnmounted(tabId);
    };
    // `url` is the initial navigation target only; navigation is explicit after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Keep the native view aligned under the reserved rect — on resize AND on reflow.
  // Every report is a push into the tab's channel: coalesced, ordered, retried there.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const report = () => boundsRef.current?.push(el.getBoundingClientRect());
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => observer.disconnect();
  }, [tabId, layoutVersion, viewportRef]);
}
