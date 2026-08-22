/**
 * Pane split shapes and constants (#1081).
 *
 * A leaf module, imported by BOTH `paneStore.ts` and `paneStoreHelpers.ts`.
 * Without it the two form a cycle — helpers need `DEFAULT_SPLIT` and the
 * `WindowSplit` type, the store needs `resolveWindowSplit` — which
 * dependency-cruiser's `no-circular` rule refuses. Mirrors the existing
 * `tabStore` / `tabStoreTypes` split, which exists for exactly this reason.
 *
 * @module stores/paneStoreTypes
 */

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
