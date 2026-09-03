/**
 * useBrowserNativeView — the React adapter over one browser tab's native WKWebView
 * (WI-1.3 / WI-S0.10).
 *
 * Purpose: on mount, make sure the tab's view exists and is visible; keep it aligned
 * under the reserved rect while mounted; on unmount, hide it. The registry itself —
 * create once, show/hide, destroy on tab close — is `services/browser/browserNativeViews`
 * (audit 2026-09-03 L-01: views are kept alive across tab switches), re-exported here
 * so existing importers keep their path.
 *
 * Hazard handled here: **the rect can MOVE without resizing.** A ResizeObserver fires
 * on size. A terminal switching sides, or a bar appearing above the viewport, changes
 * the rect's x/y silently — and the native view would stay where it used to be,
 * painting over unrelated UI. `layoutVersion` re-runs the report whenever the shell
 * reflows.
 *
 * @coordinates-with services/browser/browserNativeViews — the registry
 * @coordinates-with stores/browserUiStore — seeds the tab's omnibox entry
 * @module components/Browser/useBrowserNativeView
 */
import { useEffect, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { browserWarn } from "@/utils/debug";
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
import type { BrowserAutomationMode } from "@/stores/tabStoreTypes";

/** A rejected bounds report is retried this many times, spaced by the delay. */
const BOUNDS_RETRIES = 3;
const BOUNDS_RETRY_MS = 150;

export function useBrowserNativeView(
  tabId: string,
  url: string,
  layoutVersion: string,
  viewportRef: RefObject<HTMLDivElement | null>,
  automationMode: BrowserAutomationMode = "human",
): void {
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
      markSurfaceUnmounted(tabId);
    };
    // `url` is the initial navigation target only; navigation is explicit after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Keep the native view aligned under the reserved rect — on resize AND on reflow.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    // Bounds are coalesced (only the latest rect is ever sent) and a rejection is
    // retried once the view can exist: a create/layout race used to drop the rect
    // silently and leave the native view misaligned over unrelated UI for good.
    let latest: DOMRect | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const send = (attempt: number) => {
      const r = latest;
      if (!r) return;
      void invoke("browser_set_bounds", { tabId, x: r.x, y: r.y, width: r.width, height: r.height }).catch(
        (error: unknown) => {
          if (attempt < BOUNDS_RETRIES) {
            retry = setTimeout(() => send(attempt + 1), BOUNDS_RETRY_MS * (attempt + 1));
            return;
          }
          browserWarn("browser_set_bounds kept failing; the native view may be misaligned", { tabId, error });
        },
      );
    };
    const report = () => {
      latest = el.getBoundingClientRect();
      if (retry !== null) {
        clearTimeout(retry);
        retry = null;
      }
      send(0);
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => {
      observer.disconnect();
      if (retry !== null) clearTimeout(retry);
    };
  }, [tabId, layoutVersion, viewportRef]);
}
