/**
 * Browser hibernation store — live-webview LRU policy (WI-1.6 / R6).
 *
 * Purpose: a native webview is expensive (a full content process), so only a
 * bounded number of browser tabs keep a *live* webview per window; the rest
 * hibernate to their persisted `{url, title, scrollY, snapshot}` (held on the
 * BrowserTab record + snapshot cache) and re-navigate on reactivation. This
 * store owns the pure liveness *policy*: which tabs are live, the LRU eviction
 * order, and the keep-alive exemption for AI-driven tabs. The native surface
 * (WI-1.2) performs the actual freeze/thaw against the ids this store returns.
 *
 * Keep-alive wins over the cap: an AI-driven tab (its lease held by "ai") is
 * never evicted mid-automation — if every live tab is protected, the cap is
 * exceeded rather than tearing down a page the AI is acting on.
 *
 * @coordinates-with services/browser/lease.ts — AI-held tabs are marked keep-alive
 * @coordinates-with (future) src-tauri browser surface — freeze/thaw the evicted ids
 * @module stores/browserStore
 */

import { create } from "zustand";

/** Default cap on live webviews per window. */
export const DEFAULT_MAX_LIVE = 3;

interface BrowserState {
  /** Live browser-tab ids per window, ordered LRU (front) → MRU (back). */
  liveTabs: Record<string, string[]>;
  /** Tabs exempt from eviction (AI is driving them). */
  keepAlive: Record<string, boolean>;
  /** Max live webviews per window. */
  maxLive: number;
}

interface BrowserActions {
  /** Mark `tabId` active/live in `windowLabel` (moves it to MRU). Evicts the
   *  least-recently-used non-protected tab(s) when over the cap. Returns the ids
   *  that were evicted (the caller hibernates their webviews). */
  activate: (windowLabel: string, tabId: string) => string[];
  /** Protect (or unprotect) a tab from eviction — set true while the AI drives it. */
  setKeepAlive: (tabId: string, keep: boolean) => void;
  /** Force-hibernate a live tab. Returns whether it was live. */
  hibernate: (windowLabel: string, tabId: string) => boolean;
  /** Whether `tabId` currently has a live webview in `windowLabel`. */
  isLive: (windowLabel: string, tabId: string) => boolean;
  /** Number of live webviews in `windowLabel`. */
  liveCount: (windowLabel: string) => number;
  /** Whether `tabId` is keep-alive protected. */
  isKeptAlive: (tabId: string) => boolean;
  /** Drop liveness + keep-alive for a closed tab. */
  removeTab: (windowLabel: string, tabId: string) => void;
  /** Drop all live state for a closed window. */
  removeWindow: (windowLabel: string) => void;
}

/** Manages which browser tabs keep a live webview (LRU cap + keep-alive). Use selectors, not destructuring. */
export const useBrowserStore = create<BrowserState & BrowserActions>((set, get) => ({
  liveTabs: {},
  keepAlive: {},
  maxLive: DEFAULT_MAX_LIVE,

  activate: (windowLabel, tabId) => {
    const { liveTabs, keepAlive, maxLive } = get();
    // Move tabId to MRU (remove any prior position, append at the back).
    const live = (liveTabs[windowLabel] ?? []).filter((id) => id !== tabId);
    live.push(tabId);

    const evicted: string[] = [];
    while (live.length > maxLive) {
      // Evict the front-most (LRU) tab that is neither protected nor the tab we
      // just activated. If none qualifies (all protected), exceed the cap.
      const victimIndex = live.findIndex((id) => id !== tabId && !keepAlive[id]);
      if (victimIndex === -1) break;
      evicted.push(live[victimIndex]);
      live.splice(victimIndex, 1);
    }

    set({ liveTabs: { ...liveTabs, [windowLabel]: live } });
    return evicted;
  },

  setKeepAlive: (tabId, keep) => {
    set((state) => {
      const next = { ...state.keepAlive };
      if (keep) next[tabId] = true;
      else delete next[tabId];
      return { keepAlive: next };
    });
  },

  hibernate: (windowLabel, tabId) => {
    const live = get().liveTabs[windowLabel] ?? [];
    if (!live.includes(tabId)) return false;
    set((state) => ({
      liveTabs: { ...state.liveTabs, [windowLabel]: live.filter((id) => id !== tabId) },
    }));
    return true;
  },

  isLive: (windowLabel, tabId) => (get().liveTabs[windowLabel] ?? []).includes(tabId),

  liveCount: (windowLabel) => (get().liveTabs[windowLabel] ?? []).length,

  isKeptAlive: (tabId) => Boolean(get().keepAlive[tabId]),

  removeTab: (windowLabel, tabId) => {
    set((state) => {
      const live = (state.liveTabs[windowLabel] ?? []).filter((id) => id !== tabId);
      const keepAlive = { ...state.keepAlive };
      delete keepAlive[tabId];
      return { liveTabs: { ...state.liveTabs, [windowLabel]: live }, keepAlive };
    });
  },

  removeWindow: (windowLabel) => {
    set((state) => {
      const { [windowLabel]: _drop, ...rest } = state.liveTabs;
      return { liveTabs: rest };
    });
  },
}));
