/**
 * Tab MRU — most-recently-used order per window (WI-TNAV2.1).
 *
 * Purpose: F3. `tab.next`/`tab.prev` are positional, so nothing in VMark could
 * answer "the document I was just in". This store keeps that order.
 *
 * Key decisions:
 *   - **Move-to-front, not append.** That is what makes `tab.lastUsed` a
 *     toggle: activating MRU[1] demotes the old front to index 1, so pressing
 *     twice returns to the origin (D2, under its stated preconditions).
 *   - **Only `origin: "user"` counts.** Hot-exit restore activates every tab as
 *     it recreates it, and MCP background opens activate a tab and then restore
 *     the previous one — recording either fabricates a history the user never
 *     produced (D4, D5).
 *   - **The browser workspace is ONE entry, not one per page (D6).** The strip
 *     renders a single synthetic pill with pages nested inside it, so a
 *     page-level MRU would let `Ctrl-Tab` cycle within the browser and never
 *     leave it — which reads as a dead key.
 *   - **Window teardown is projected at read time, not pushed or subscribed.**
 *     `tabStore.removeWindow` goes through neither bus, and `tabStore.ts` sits
 *     exactly on its file-size baseline so it cannot push. Subscribing at
 *     module load was the first attempt and it coupled every test that mocks
 *     `tabStore` with a `getState`-only double. Reading through the live store
 *     makes a removed window's MRU empty by construction.
 *
 * @coordinates-with stores/tabActivationBus.ts — the seam every activation crosses
 * @coordinates-with stores/tabRemovalBus.ts — prune on close/detach
 * @module stores/tabMruStore
 */
import { create } from "zustand";
import { onTabActivated, type ActivationOrigin } from "@/stores/tabActivationBus";
import { onTabRemoved } from "@/stores/tabRemovalBus";
import { useTabStore } from "@/stores/tabStore";

/** The single MRU key standing for the whole browser workspace (D6). */
export const BROWSER_MRU_KEY = "__browser-workspace__";

/**
 * The origin vocabulary, as a value. `ActivationOrigin` is a bare type union
 * with no runtime form, so parity is asserted at COMPILE time in both
 * directions — a new member added to the type without being added here fails
 * `pnpm lint:test-types`, and vice versa.
 */
export const ACTIVATION_ORIGINS = ["user", "restore", "background"] as const satisfies readonly ActivationOrigin[];
type _MissingOrigin = Exclude<ActivationOrigin, (typeof ACTIVATION_ORIGINS)[number]>;
const _originParity: _MissingOrigin extends never ? true : never = true;
void _originParity;

interface TabMruState {
  lists: Record<string, string[]>;
  /** The window's MRU keys, most recent first. */
  keys: (windowLabel: string) => string[];
  /** Test seam — never called in production. */
  reset: () => void;
}

const moveToFront = (list: string[], key: string): string[] => {
  if (list[0] === key) return list; // already front: a TRUE no-op, not a rewrite
  return [key, ...list.filter((k) => k !== key)];
};

export const useTabMruStore = create<TabMruState>((set, get) => ({
  lists: {},
  keys: (windowLabel) => {
    // Projected at READ time against the live tab store. `removeWindow` goes
    // through neither bus, and subscribing to `tabStore` at module load would
    // couple every test that mocks it with a getState-only double — three broke
    // that way. A window the store no longer holds has no reachable tabs, so
    // its MRU is empty by construction rather than by bookkeeping.
    const tabs = useTabStore.getState().tabs[windowLabel];
    if (tabs === undefined) return [];
    // Project against LIVE tabs, not just live windows. `removeWindow` bypasses
    // both buses, so a retained list would come back if its label were ever
    // reused — and a key that resolves to nothing is precisely the dead key
    // `tab.lastUsed` must never hand out.
    const live = new Set(tabs.map((t) => t.id));
    const hasBrowser = tabs.some((t) => t.kind === "browser");
    return (get().lists[windowLabel] ?? []).filter((k) =>
      k === BROWSER_MRU_KEY ? hasBrowser : live.has(k),
    );
  },
  reset: () => set({ lists: {} }),
}));

/**
 * The MRU key a tab id maps to — browser pages all collapse onto one (D6).
 * `null` when the window has no such tab: an announcement for a tab this window
 * does not hold is not a real activation, and seating it would put a key in the
 * MRU that resolves to nothing. That is precisely the dead-key class
 * `tab.lastUsed` must never hit, so it is refused at WRITE time, where it costs
 * one lookup, rather than filtered at every read.
 */
export function mruKeyOf(windowLabel: string, tabId: string): string | null {
  const tab = (useTabStore.getState().tabs[windowLabel] ?? []).find((t) => t.id === tabId);
  if (!tab) return null;
  return tab.kind === "browser" ? BROWSER_MRU_KEY : tabId;
}

/**
 * Collapse a window's MRU to exactly the tab that is active (WI-TNAV2.5).
 *
 * Hot-exit restore recreates each tab with an ACTIVATING `createTab`
 * (`restoreHelpers.ts:212`) and then activates the persisted one, so a naive
 * MRU records `[A, C, B]` — an order the user never produced, from which
 * `tab.lastUsed` would jump somewhere arbitrary on the first press of a
 * session.
 *
 * Stated declaratively rather than by threading a `restore` origin through the
 * restore path: that loop `await`s per tab, so a dynamic origin scope would
 * leak across the await and mislabel any genuine activation that interleaved
 * with it. "Restore leaves exactly one entry" is the law the matrix states, and
 * it is checkable in one line.
 */
export function collapseMruToActive(windowLabel: string): void {
  const activeId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  const key = activeId ? mruKeyOf(windowLabel, activeId) : null;
  useTabMruStore.setState((s) => ({ lists: { ...s.lists, [windowLabel]: key ? [key] : [] } }));
}

onTabActivated((windowLabel, tabId, origin) => {
  if (origin !== "user" || !tabId) return;
  const key = mruKeyOf(windowLabel, tabId);
  if (!key) return;
  const current = useTabMruStore.getState().lists[windowLabel] ?? [];
  const next = moveToFront(current, key);
  if (next === current) return; // no store write at all, so no subscriber fires
  useTabMruStore.setState((s) => ({ lists: { ...s.lists, [windowLabel]: next } }));
});

onTabRemoved((windowLabel, tabId, info) => {
  const current = useTabMruStore.getState().lists[windowLabel];
  if (!current) return;
  // A browser page's key is shared, so it only leaves when the LAST page goes.
  const wasBrowser = info?.tab.kind === "browser";
  const key = wasBrowser ? BROWSER_MRU_KEY : tabId;
  if (wasBrowser) {
    const pagesLeft = (useTabStore.getState().tabs[windowLabel] ?? []).some((t) => t.kind === "browser");
    if (pagesLeft) return;
  }
  const next = current.filter((k) => k !== key);
  if (next.length === current.length) return;
  useTabMruStore.setState((s) => {
    // Drop the key entirely once the window has nothing left, rather than
    // retaining an empty array per window ever opened. Correctness does not
    // depend on this — `keys()` projects against the live store — but
    // `paneStore` and `workspacePaneLayoutsStore` both prune explicitly and
    // this should not be the one that leaks.
    const lists = { ...s.lists };
    if (next.length === 0) delete lists[windowLabel];
    else lists[windowLabel] = next;
    return { lists };
  });
});
