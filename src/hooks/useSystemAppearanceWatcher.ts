/**
 * System Appearance Watcher
 *
 * Purpose: Subscribes the current window to the OS light/dark preference via
 * `matchMedia("(prefers-color-scheme: dark)")` and mirrors it into
 * `systemAppearanceStore`. Mounted from `useTheme`, so every window that
 * themes itself (document, settings, PDF export) tracks the OS automatically.
 *
 * Key decisions:
 *   - Feature-detects `addEventListener` on the MediaQueryList and falls back
 *     to the legacy `addListener` API (older WebKit) — no-ops entirely when
 *     matchMedia is unavailable (jsdom, SSR).
 *   - Re-seeds the store on mount, not only on change events, so a window
 *     opened after an OS flip starts correct.
 *
 * @coordinates-with stores/systemAppearanceStore.ts — the store being fed
 * @coordinates-with hooks/useTheme.ts — sole mount point
 * @module hooks/useSystemAppearanceWatcher
 */

import { useEffect } from "react";
import { useSystemAppearanceStore } from "@/stores/systemAppearanceStore";

export function useSystemAppearanceWatcher(): void {
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }

    const { setPrefersDark } = useSystemAppearanceStore.getState();
    setPrefersDark(mql.matches);

    const onChange = (e: { matches: boolean }) => setPrefersDark(e.matches);

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    // Legacy WebKit MediaQueryList (no EventTarget interface)
    if (typeof mql.addListener === "function") {
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
  }, []);
}
