/**
 * Pane Store — per-window editor split layout (#1081).
 *
 * VMark shows one document per window by default. This store adds an optional
 * SECOND pane so two different documents can sit side-by-side. It is purely
 * additive: when a window has no entry (or `enabled: false`) the app behaves
 * exactly as single-pane, and `tabStore.activeTabId[windowLabel]` remains the
 * primary pane's active tab. The secondary pane's tab lives here.
 *
 * The "focused pane" decides which document window-global surfaces (toolbar,
 * find bar, menu commands) act on — see `useActiveTabId()` which resolves the
 * focused pane's tab when not rendered inside a specific pane.
 *
 * Max two panes for v1 (see dev-docs/plans/20260701-split-documents.md, ADR-1).
 *
 * @coordinates-with stores/tabStore.ts — primary pane's active tab
 * @coordinates-with contexts/PaneContext.tsx — provides each pane's tabId
 * @coordinates-with hooks/useDocumentState.ts — focused-pane resolution
 * @module stores/paneStore
 */
import { create } from "zustand";

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
  /** The document shown in the secondary pane (null ⇒ empty pane). */
  secondaryTabId: string | null;
  /** Which pane window-global surfaces (toolbar/find/menus) target. */
  focusedPane: PaneId;
  /** Synchronize scrolling between the two panes (off by default). */
  syncScroll: boolean;
}

export const DEFAULT_SPLIT: WindowSplit = {
  enabled: false,
  orientation: "horizontal",
  fraction: 0.5,
  secondaryTabId: null,
  focusedPane: "primary",
  syncScroll: false,
};

interface PaneState {
  byWindow: Record<string, WindowSplit>;
  /** Read a window's split, falling back to DEFAULT_SPLIT when absent. */
  getSplit: (windowLabel: string) => WindowSplit;
  /** Open the split with `tabId` in the secondary pane and focus it. */
  openSplit: (windowLabel: string, secondaryTabId: string | null) => void;
  /** Collapse back to single pane (clears the secondary tab + focus). */
  closeSplit: (windowLabel: string) => void;
  setSecondaryTab: (windowLabel: string, tabId: string | null) => void;
  setFocusedPane: (windowLabel: string, pane: PaneId) => void;
  setFraction: (windowLabel: string, fraction: number) => void;
  setOrientation: (windowLabel: string, orientation: SplitOrientation) => void;
  toggleSyncScroll: (windowLabel: string) => void;
  /** Drop all state for a window (window closed). */
  removeWindow: (windowLabel: string) => void;
}

function clampFraction(fraction: number): number {
  if (Number.isNaN(fraction)) return DEFAULT_SPLIT.fraction;
  return Math.min(MAX_PANE_FRACTION, Math.max(MIN_PANE_FRACTION, fraction));
}

/** Apply `updater` to a window's split, seeding from DEFAULT_SPLIT if absent. */
function patch(
  state: PaneState,
  windowLabel: string,
  updater: (s: WindowSplit) => WindowSplit,
): Pick<PaneState, "byWindow"> {
  const current = state.byWindow[windowLabel] ?? DEFAULT_SPLIT;
  return { byWindow: { ...state.byWindow, [windowLabel]: updater(current) } };
}

export const usePaneStore = create<PaneState>((set, get) => ({
  byWindow: {},

  getSplit: (windowLabel) => get().byWindow[windowLabel] ?? DEFAULT_SPLIT,

  openSplit: (windowLabel, secondaryTabId) =>
    set((s) =>
      patch(s, windowLabel, (split) => ({
        ...split,
        enabled: true,
        secondaryTabId,
        focusedPane: "secondary",
      })),
    ),

  closeSplit: (windowLabel) =>
    set((s) =>
      patch(s, windowLabel, (split) => ({
        ...split,
        enabled: false,
        secondaryTabId: null,
        focusedPane: "primary",
      })),
    ),

  setSecondaryTab: (windowLabel, tabId) =>
    set((s) => patch(s, windowLabel, (split) => ({ ...split, secondaryTabId: tabId }))),

  setFocusedPane: (windowLabel, pane) =>
    set((s) => patch(s, windowLabel, (split) => ({ ...split, focusedPane: pane }))),

  setFraction: (windowLabel, fraction) =>
    set((s) => patch(s, windowLabel, (split) => ({ ...split, fraction: clampFraction(fraction) }))),

  setOrientation: (windowLabel, orientation) =>
    set((s) => patch(s, windowLabel, (split) => ({ ...split, orientation }))),

  toggleSyncScroll: (windowLabel) =>
    set((s) => patch(s, windowLabel, (split) => ({ ...split, syncScroll: !split.syncScroll }))),

  removeWindow: (windowLabel) =>
    set((s) => {
      if (!(windowLabel in s.byWindow)) return s;
      const next = { ...s.byWindow };
      delete next[windowLabel];
      return { byWindow: next };
    }),
}));
