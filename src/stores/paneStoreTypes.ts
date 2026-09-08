/**
 * Pane split shapes and constants (#1081).
 *
 * A leaf module, imported by BOTH `paneStore.ts` and `paneStoreHelpers.ts`.
 * Without it the two form a cycle — helpers need `DEFAULT_SPLIT` and the
 * `WindowSplit` type, the store needs `resolveWindowSplit` — which
 * dependency-cruiser's `no-circular` rule refuses. Mirrors the existing
 * `tabStore` / `tabStoreTypes` split, which exists for exactly this reason.
 *
 * A split is always side-by-side. The stacked (top/bottom) orientation the
 * shape once carried had no writer — nothing ever set it but a session-restore
 * replay — and was removed (feature-ledger plan, WI-FL3.10); a persisted
 * `orientation` is dropped on load (splitLayoutPersistence.ts).
 *
 * @module stores/paneStoreTypes
 */

export type PaneId = "primary" | "secondary";

/** Resize clamp shared with the divider (mirrors SplitPaneEditor's [0.2, 0.8]). */
export const MIN_PANE_FRACTION = 0.2;
export const MAX_PANE_FRACTION = 0.8;

export interface WindowSplit {
  /** false ⇒ single pane (default); the secondary pane is not rendered. */
  enabled: boolean;
  /** Primary pane's width as a fraction of the split, in [0.2, 0.8]. */
  fraction: number;
  /** The document in the primary (left) pane. */
  primaryTabId: string | null;
  /** The document in the secondary (right) pane. */
  secondaryTabId: string | null;
  /** Which pane is focused (its tab is mirrored into tabStore.activeTabId). */
  focusedPane: PaneId;
  /** Synchronize scrolling between the two panes (off by default). */
  syncScroll: boolean;
}

/**
 * Frozen (audit #490): `getSplit` hands this very object to every window
 * without state, so a consumer mutating "its" split would have corrupted the
 * default for every window with no store update to notice. Updaters spread it.
 */
export const DEFAULT_SPLIT: Readonly<WindowSplit> = Object.freeze({
  enabled: false,
  fraction: 0.5,
  primaryTabId: null,
  secondaryTabId: null,
  focusedPane: "primary",
  syncScroll: false,
});
