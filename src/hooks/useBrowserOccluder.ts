/**
 * useBrowserOccluder — freeze the browser while an overlay covers it (WI-SOC.1).
 *
 * The native `WKWebView` is added ABOVE the Tauri webview, so it paints over all React
 * DOM inside its rect; z-index cannot reach it. Any overlay that can land in that rect
 * calls this hook, which hides the native view for as long as it is up. The vacated
 * rect is not left blank — `BrowserSurface` paints an opaque placeholder there
 * (WI-SOC.1b) — so even a translucent backdrop composites over a real surface.
 *
 * Which overlays must call this, and why the ones that don't are safe, is declared in
 * `services/browser/overlayPolicies.ts`, and a test fails the build if an overlay in
 * `App.tsx` has no policy or declares `freeze` without calling this hook.
 *
 * Lives in `hooks/` rather than beside the policies because it is React (ADR-013:
 * `services/` may not import React).
 *
 * @coordinates-with services/browser/overlayPolicies — the declared policies
 * @coordinates-with services/browser/browserOcclusion — the reference-counted driver
 * @module hooks/useBrowserOccluder
 */
import { useEffect } from "react";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { browserOcclusion } from "@/services/browser/browserOcclusion";

/**
 * Freeze every **mounted** browser tab while `active` is true.
 *
 * Every mounted tab, not just the focused one: in split view a browser can be mounted
 * in an *unfocused* pane while a document pane has focus, and its native view still
 * paints over anything drawn on top of it. Keying occlusion off the focused tab's kind
 * is exactly the bug the cross-model review caught (v3, D2#2).
 *
 * The mounted set is `browserUiStore`'s keys: `BrowserSurface` seeds an entry on mount
 * and drops it on unmount, so it is the live register of native views that exist.
 */
export function useBrowserOccluder(active: boolean, occluderId: string): void {
  useEffect(() => {
    if (!active) return;
    // Snapshot the tabs at freeze time and release exactly those: a tab that unmounts
    // meanwhile has its occlusion state dropped wholesale by `removeTab`, and a tab
    // that mounts meanwhile was never frozen by us, so releasing it would be wrong.
    const tabs = Object.keys(useBrowserUiStore.getState().entries);
    if (tabs.length === 0) return;
    for (const tabId of tabs) browserOcclusion.addOccluder(tabId, occluderId);
    return () => {
      for (const tabId of tabs) browserOcclusion.removeOccluder(tabId, occluderId);
    };
  }, [active, occluderId]);
}
