/**
 * Pane Store — per-window editor split layout (#1081).
 *
 * VMark shows one document per window by default. This store adds an optional
 * SECOND pane so two different documents sit side-by-side. It is purely
 * additive: with no entry (or `enabled: false`) the app behaves exactly as
 * single-pane.
 *
 * ADR-1: `tabStore.activeTabId[windowLabel]` is kept as a **derived alias of
 * the focused pane's tab**. This store owns both panes' tabs by position
 * (`primaryTabId`, left/top — `secondaryTabId`, right/bottom) plus which is
 * focused. Reconciliation runs BOTH ways (WI-2): pane actions mirror the
 * focused pane's tab into `tabStore.activeTabId` (syncActiveTab), and every
 * tabStore activation converges the split back through the tabActivationBus
 * (decision D2: focus follows a paned tab; an unpaned document lands in the
 * focused pane; browser tabs never touch panes). `assertPaneTabInvariant`
 * fails loud in DEV when the two ever disagree.
 *
 * Max two panes for v1 (see dev-docs/plans/20260701-split-documents.md).
 *
 * @coordinates-with stores/tabStore.ts — activeTabId is the focused-pane alias
 * @coordinates-with contexts/PaneContext.tsx — provides each pane's tabId
 * @coordinates-with stores/tabRemovalBus.ts — subscribes to onTabRemoved so any
 *   close/detach path collapses a split whose pane held the removed tab
 * @coordinates-with stores/tabActivationBus.ts — subscribes to onTabActivated to
 *   converge the split on every activation (WI-2, D2)
 * @module stores/paneStore
 */
import { create } from "zustand";
import { useTabStore } from "@/stores/tabStore";
import { onTabRemoved } from "@/stores/tabRemovalBus";
import { onTabActivated } from "@/stores/tabActivationBus";
import { DEFAULT_SPLIT } from "@/stores/paneStoreTypes";
import type { PaneId, SplitOrientation, WindowSplit } from "@/stores/paneStoreTypes";
import { resolveWindowSplit, clampFraction } from "@/stores/paneStoreHelpers";

// Shapes live in a leaf module so `paneStoreHelpers` can import them without
// forming a cycle with this file (dep-cruiser `no-circular`). Re-exported so
// existing `from "@/stores/paneStore"` imports keep working.
export { DEFAULT_SPLIT, MIN_PANE_FRACTION, MAX_PANE_FRACTION } from "@/stores/paneStoreTypes";
export type { PaneId, SplitOrientation, WindowSplit } from "@/stores/paneStoreTypes";

interface PaneState {
  byWindow: Record<string, WindowSplit>;
  getSplit: (windowLabel: string) => WindowSplit;
  /** Open the split with `tabId` in the secondary pane and focus it. */
  openSplit: (windowLabel: string, secondaryTabId: string | null) => void;
  /** Collapse back to single pane (the primary pane's tab becomes active). */
  closeSplit: (windowLabel: string) => void;
  setFocusedPane: (windowLabel: string, pane: PaneId) => void;
  /** Set the focused pane's document (e.g. clicking a tab while it's focused). */
  setFocusedPaneTab: (windowLabel: string, tabId: string) => void;
  /** Put `tabId` in `pane` and focus it, as ONE write with ONE announcement. */
  showTabInPane: (windowLabel: string, pane: PaneId, tabId: string) => void;
  setFraction: (windowLabel: string, fraction: number) => void;
  setOrientation: (windowLabel: string, orientation: SplitOrientation) => void;
  toggleSyncScroll: (windowLabel: string) => void;
  /** Reconcile when a tab closes: collapse the split if it held the tab (#1081 H1). */
  handleTabClosed: (windowLabel: string, closedTabId: string) => void;
  /**
   * WI-10.1 — atomically replace the window's split with a validated layout
   * and perform the ONE final activeTabId sync (ADR-1). Pane tab ids that are
   * not live DOCUMENT tabs of the window are dropped: both survive → split;
   * one survives → single pane on it; none (or `split` null/disabled) →
   * single pane with `fallbackActiveTabId` as the alias.
   */
  replaceWindowSplit: (
    windowLabel: string,
    split: WindowSplit | null,
    fallbackActiveTabId: string | null,
  ) => void;
  /** Drop all state for a window (window closed). */
  removeWindow: (windowLabel: string) => void;
}

function patch(
  state: PaneState,
  windowLabel: string,
  updater: (s: WindowSplit) => WindowSplit,
): Pick<PaneState, "byWindow"> {
  const current = state.byWindow[windowLabel] ?? DEFAULT_SPLIT;
  return { byWindow: { ...state.byWindow, [windowLabel]: updater(current) } };
}

/**
 * Mirror the focused pane's tab into tabStore.activeTabId — the ADR-1 alias
 * invariant. Mirrors `null` too: if the focused pane has no document the alias
 * must not keep pointing at the other pane's tab.
 */
function syncActiveTab(windowLabel: string, split: WindowSplit): void {
  const tab = split.focusedPane === "primary" ? split.primaryTabId : split.secondaryTabId;
  useTabStore.getState().setActiveTab(windowLabel, tab);
}

export const usePaneStore = create<PaneState>((set, get) => ({
  byWindow: {},

  getSplit: (windowLabel) => get().byWindow[windowLabel] ?? DEFAULT_SPLIT,

  openSplit: (windowLabel, secondaryTabId) => {
    const primaryTabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
    set((s) =>
      patch(s, windowLabel, (split) => ({
        ...split,
        enabled: true,
        primaryTabId,
        secondaryTabId,
        focusedPane: "secondary",
      })),
    );
    syncActiveTab(windowLabel, get().byWindow[windowLabel]);
  },

  closeSplit: (windowLabel) => {
    const primaryTabId = get().byWindow[windowLabel]?.primaryTabId ?? null;
    set((s) =>
      patch(s, windowLabel, (split) => ({
        ...split,
        enabled: false,
        secondaryTabId: null,
        focusedPane: "primary",
      })),
    );
    if (primaryTabId) useTabStore.getState().setActiveTab(windowLabel, primaryTabId);
  },

  setFocusedPane: (windowLabel, pane) => {
    set((s) => patch(s, windowLabel, (split) => ({ ...split, focusedPane: pane })));
    syncActiveTab(windowLabel, get().byWindow[windowLabel]);
  },

  setFocusedPaneTab: (windowLabel, tabId) => {
    set((s) =>
      patch(s, windowLabel, (split) =>
        split.focusedPane === "primary"
          ? { ...split, primaryTabId: tabId }
          : { ...split, secondaryTabId: tabId },
      ),
    );
    useTabStore.getState().setActiveTab(windowLabel, tabId);
  },

  showTabInPane: (windowLabel, pane, tabId) => {
    // ONE write, ONE announcement. Doing this as setFocusedPane +
    // setFocusedPaneTab announces the pane's DISPLACED tab first, recording a
    // phantom user activation for a document nobody chose — which lands at the
    // MRU front and sends `tab.lastUsed` to it.
    set((s) =>
      patch(s, windowLabel, (split) => ({
        ...split,
        focusedPane: pane,
        ...(pane === "primary" ? { primaryTabId: tabId } : { secondaryTabId: tabId }),
      })),
    );
    useTabStore.getState().setActiveTab(windowLabel, tabId);
  },

  setFraction: (windowLabel, fraction) =>
    set((s) => patch(s, windowLabel, (split) => ({ ...split, fraction: clampFraction(fraction) }))),

  setOrientation: (windowLabel, orientation) =>
    set((s) => patch(s, windowLabel, (split) => ({ ...split, orientation }))),

  toggleSyncScroll: (windowLabel) =>
    set((s) => patch(s, windowLabel, (split) => ({ ...split, syncScroll: !split.syncScroll }))),

  handleTabClosed: (windowLabel, closedTabId) => {
    const split = get().byWindow[windowLabel];
    if (!split?.enabled) return;
    if (closedTabId !== split.primaryTabId && closedTabId !== split.secondaryTabId) return;
    // Only collapse if the tab is actually gone from this window. tabStore
    // refuses to close a pinned tab (and this runs from the close/detach choke
    // point regardless), so a still-present tab means the removal was declined.
    if (useTabStore.getState().tabs[windowLabel]?.some((t) => t.id === closedTabId)) return;
    // R2/D10 — collapse onto the SURVIVOR (may be null: an empty secondary is
    // legal, and that case is the old collapse). Letting tabStore pick means
    // closing one of two side-by-side documents discards the layout AND jumps
    // to an unrelated neighbour, since it chooses by raw strip index.
    const survivor =
      closedTabId === split.primaryTabId ? split.secondaryTabId : split.primaryTabId;
    set((s) =>
      patch(s, windowLabel, (sp) => ({
        ...sp,
        enabled: false,
        primaryTabId: survivor,
        secondaryTabId: null,
        focusedPane: "primary",
      })),
    );
    // closeTab announces the alias AFTER this reconciles (tabStore.ts:275).
    if (survivor) useTabStore.getState().setActiveTab(windowLabel, survivor);
  },

  replaceWindowSplit: (windowLabel, split, fallbackActiveTabId) => {
    const liveDocIds = new Set(
      (useTabStore.getState().tabs[windowLabel] ?? [])
        .filter((tab) => tab.kind === "document")
        .map((tab) => tab.id),
    );
    const applied = resolveWindowSplit(split, liveDocIds, fallbackActiveTabId);
    set((s) => ({ byWindow: { ...s.byWindow, [windowLabel]: applied } }));
    // The single alias write (ADR-1): the focused pane's tab, or the collapsed
    // survivor/fallback (possibly null — an empty incoming workspace).
    syncActiveTab(windowLabel, applied);
  },

  removeWindow: (windowLabel) =>
    set((s) => {
      if (!(windowLabel in s.byWindow)) return s;
      const next = { ...s.byWindow };
      delete next[windowLabel];
      return { byWindow: next };
    }),
}));

// Collapse a split whose pane held a tab that was just closed/detached. A split
// can only exist once paneStore has been imported, so this module-load-time
// subscription is always registered before any split needs reconciling.
onTabRemoved((windowLabel, tabId) =>
  usePaneStore.getState().handleTabClosed(windowLabel, tabId),
);

/** WI-2 (D2): converge an enabled split on a tabStore activation. The alias is
 *  already written, so this only patches pane state — never setActiveTab. */
function convergeSplitOnActivation(windowLabel: string, tabId: string | null): void {
  const split = usePaneStore.getState().byWindow[windowLabel];
  if (!split?.enabled || tabId === null) return;
  const tab = useTabStore.getState().tabs[windowLabel]?.find((t) => t.id === tabId);
  if (!tab || tab.kind !== "document") return; // browser tabs overlay; panes hold documents
  const focusedTab = split.focusedPane === "primary" ? split.primaryTabId : split.secondaryTabId;
  if (focusedTab === tabId) return; // already converged
  usePaneStore.setState((s) =>
    patch(s, windowLabel, (sp) => {
      if (!sp.enabled) return sp;
      // Focus FOLLOWS a tab already shown in the other pane (D2) — never
      // duplicate a document across panes.
      if (sp.primaryTabId === tabId) return { ...sp, focusedPane: "primary" };
      if (sp.secondaryTabId === tabId) return { ...sp, focusedPane: "secondary" };
      // An unpaned document lands in the focused pane.
      return sp.focusedPane === "primary"
        ? { ...sp, primaryTabId: tabId }
        : { ...sp, secondaryTabId: tabId };
    }),
  );
}

/**
 * DEV-only ADR-1 invariant check (WI-2): with a split enabled, the focused
 * pane's tab must equal `tabStore.activeTabId` — unless the alias points at a
 * browser tab (browser surfaces overlay the editor; panes hold documents).
 * Throws in DEV, no-op in production; `dev` is injectable for tests.
 */
export function assertPaneTabInvariant(
  windowLabel: string,
  dev: boolean = import.meta.env.DEV,
): void {
  if (!dev) return;
  const split = usePaneStore.getState().byWindow[windowLabel];
  if (!split?.enabled) return;
  const alias = useTabStore.getState().activeTabId[windowLabel] ?? null;
  if (alias !== null) {
    const tab = useTabStore.getState().tabs[windowLabel]?.find((t) => t.id === alias);
    if (tab && tab.kind !== "document") return;
  }
  const focusedTab = split.focusedPane === "primary" ? split.primaryTabId : split.secondaryTabId;
  if (focusedTab !== alias) {
    throw new Error(
      `[paneStore] ADR-1 invariant violated for "${windowLabel}": activeTabId=` +
        `${String(alias)} but the focused (${split.focusedPane}) pane shows ${String(focusedTab)}`,
    );
  }
}

// WI-2: every activation converges the split, then the invariant is asserted
// (DEV only). Registered at module load, like the removal subscription above.
onTabActivated((windowLabel, tabId) => {
  convergeSplitOnActivation(windowLabel, tabId);
  assertPaneTabInvariant(windowLabel);
});
