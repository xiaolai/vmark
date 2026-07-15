/**
 * Browser hibernation store — live-webview LRU policy (WI-1.6 / R6).
 *
 * ⚠️ **NOT WIRED. This store has no production consumers.** Nothing calls `activate`,
 * `hibernate`, `setKeepAlive`, `removeTab` or `removeWindow`, so the live-webview cap
 * below is not in force: every browser tab keeps a full content process alive, without
 * bound. The policy is correct and unit-tested; it is simply not connected to anything.
 *
 * Do not read the cap as a guarantee. (Audit, High.)
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
  /** Protect (or unprotect) a tab from eviction — set true while the AI drives
   *  it. Unprotecting rebalances every over-cap window immediately (protection is
   *  what let them exceed the cap) and returns the ids that were evicted, in the
   *  same contract as `activate`. Protecting never evicts. */
  setKeepAlive: (tabId: string, keep: boolean) => string[];
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

/**
 * Bring one window's live list down to the cap, in place. Evicts the front-most
 * (LRU) tab that is neither protected nor `pinned` (the tab just activated), and
 * stops early when every remaining tab is protected — the cap is exceeded rather
 * than tearing down a page the AI is acting on. Returns the evicted ids.
 *
 * The single eviction rule, shared by `activate` (a tab arrived) and
 * `setKeepAlive` (protection lifted): the two must not drift.
 */
function evictOverCap(
  live: string[],
  keepAlive: Record<string, boolean>,
  maxLive: number,
  pinned?: string,
): string[] {
  const evicted: string[] = [];
  while (live.length > maxLive) {
    const victimIndex = live.findIndex((id) => id !== pinned && !keepAlive[id]);
    if (victimIndex === -1) break; // all protected → exceed the cap
    evicted.push(live[victimIndex]);
    live.splice(victimIndex, 1);
  }
  return evicted;
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

    const evicted = evictOverCap(live, keepAlive, maxLive, tabId);

    set({ liveTabs: { ...liveTabs, [windowLabel]: live } });
    return evicted;
  },

  setKeepAlive: (tabId, keep) => {
    const { liveTabs, maxLive } = get();
    const keepAlive = { ...get().keepAlive };

    // Protecting can only ever exceed the cap, never breach it — nothing to do.
    if (keep) {
      keepAlive[tabId] = true;
      set({ keepAlive });
      return [];
    }

    // Releasing a tab that was never protected changes nothing. An idempotent or
    // stale release must NOT rebalance: another window could be legitimately over
    // its cap (its own protections), and a spurious rebalance would evict its
    // just-activated tab. Only a real protection lift can push a window over cap.
    if (!keepAlive[tabId]) return [];
    delete keepAlive[tabId];

    // Unprotecting may leave a window over its cap with no further activation
    // coming; rebalance now so the excess webviews are actually torn down.
    const evicted: string[] = [];
    const nextLive: Record<string, string[]> = {};
    for (const [windowLabel, live] of Object.entries(liveTabs)) {
      const next = [...live];
      evicted.push(...evictOverCap(next, keepAlive, maxLive));
      nextLive[windowLabel] = next;
    }

    set({ keepAlive, liveTabs: nextLive });
    return evicted;
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
      const { [windowLabel]: closed = [], ...rest } = state.liveTabs;
      // Drop the closed window's protections too — a keep-alive entry for a tab
      // that no longer exists anywhere would protect a phantom forever (and, on
      // id reuse, the wrong tab).
      const keepAlive = { ...state.keepAlive };
      const stillLive = new Set(Object.values(rest).flat());
      for (const tabId of closed) {
        if (!stillLive.has(tabId)) delete keepAlive[tabId];
      }
      return { liveTabs: rest, keepAlive };
    });
  },
}));
