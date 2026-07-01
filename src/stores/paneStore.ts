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
 * focused, and its actions mirror the focused pane's tab into
 * `tabStore.activeTabId`. That way every reader of `activeTabId` (the dozens of
 * direct readers, the service resolver, and the hooks) targets the focused
 * pane with no per-call-site changes.
 *
 * Max two panes for v1 (see dev-docs/plans/20260701-split-documents.md).
 *
 * @coordinates-with stores/tabStore.ts — activeTabId is the focused-pane alias
 * @coordinates-with contexts/PaneContext.tsx — provides each pane's tabId
 * @coordinates-with stores/tabRemovalBus.ts — subscribes to onTabRemoved so any
 *   close/detach path collapses a split whose pane held the removed tab
 * @module stores/paneStore
 */
import { create } from "zustand";
import { useTabStore } from "@/stores/tabStore";
import { onTabRemoved } from "@/stores/tabRemovalBus";

export type PaneId = "primary" | "secondary";
export type SplitOrientation = "horizontal" | "vertical";

/** Resize clamp shared with the divider (mirrors SplitPaneEditor's [0.2, 0.8]). */
export const MIN_PANE_FRACTION = 0.2;
export const MAX_PANE_FRACTION = 0.8;

export interface WindowSplit {
  /** false ⇒ single pane (default); the secondary pane is not rendered. */
  enabled: boolean;
  orientation: SplitOrientation;
  /** Primary pane's size as a fraction of the split axis, in [0.2, 0.8]. */
  fraction: number;
  /** The document in the primary (left/top) pane. */
  primaryTabId: string | null;
  /** The document in the secondary (right/bottom) pane. */
  secondaryTabId: string | null;
  /** Which pane is focused (its tab is mirrored into tabStore.activeTabId). */
  focusedPane: PaneId;
  /** Synchronize scrolling between the two panes (off by default). */
  syncScroll: boolean;
}

export const DEFAULT_SPLIT: WindowSplit = {
  enabled: false,
  orientation: "horizontal",
  fraction: 0.5,
  primaryTabId: null,
  secondaryTabId: null,
  focusedPane: "primary",
  syncScroll: false,
};

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
  setFraction: (windowLabel: string, fraction: number) => void;
  setOrientation: (windowLabel: string, orientation: SplitOrientation) => void;
  toggleSyncScroll: (windowLabel: string) => void;
  /** Reconcile when a tab closes: collapse the split if it held the tab (#1081 H1). */
  handleTabClosed: (windowLabel: string, closedTabId: string) => void;
  /** Drop all state for a window (window closed). */
  removeWindow: (windowLabel: string) => void;
}

function clampFraction(fraction: number): number {
  if (Number.isNaN(fraction)) return DEFAULT_SPLIT.fraction;
  return Math.min(MAX_PANE_FRACTION, Math.max(MIN_PANE_FRACTION, fraction));
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
    // The closed tab was shown in a pane: collapse to single. tabStore selects
    // the new activeTabId itself, so we don't touch it here.
    set((s) =>
      patch(s, windowLabel, (sp) => ({
        ...sp,
        enabled: false,
        primaryTabId: null,
        secondaryTabId: null,
        focusedPane: "primary",
      })),
    );
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
