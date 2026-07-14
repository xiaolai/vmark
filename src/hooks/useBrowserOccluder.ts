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

    /** Every browser tab that currently has a native view. */
    const mounted = () => Object.keys(useBrowserUiStore.getState().entries);

    // Freeze what is mounted now...
    const frozen = new Set<string>();
    const freeze = (tabId: string) => {
      if (frozen.has(tabId)) return;
      frozen.add(tabId);
      browserOcclusion.addOccluder(tabId, occluderId);
    };
    for (const tabId of mounted()) freeze(tabId);

    // ...and keep watching, because the mounted set is NOT fixed for the overlay's
    // lifetime. An earlier version snapshotted it once, which meant a browser tab that
    // mounted while the palette was still open was never frozen — and a native view
    // appearing over an open dialog is the exact failure this hook exists to prevent.
    // (Audit finding, High.) It can happen for real: the palette is how you run
    // "New Browser Tab", so the overlay is open at the moment the surface mounts.
    const unsubscribe = useBrowserUiStore.subscribe((state) => {
      for (const tabId of Object.keys(state.entries)) freeze(tabId);
    });

    return () => {
      unsubscribe();
      // Release exactly what we froze. A tab that has since unmounted had its occlusion
      // state dropped wholesale by `removeTab`, so releasing it again is a harmless no-op;
      // a tab we never froze is not ours to release.
      for (const tabId of frozen) browserOcclusion.removeOccluder(tabId, occluderId);
    };
  }, [active, occluderId]);
}
