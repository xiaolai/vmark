/**
 * tabStore shared types.
 *
 * Purpose: the `Tab` shape, split out so both tabStore.ts and its pure helpers
 * (tabStoreHelpers.ts) can import it without a circular dependency. Re-exported
 * from tabStore.ts for backward-compatible `import { Tab } from "@/stores/tabStore"`.
 *
 * @module stores/tabStoreTypes
 */

import type { SplitViewMode } from "@/lib/formats/types";

/** A single editor tab with ID, optional file path, display title, pin state,
 *  the format adapter id (derived from filePath via dispatchEditor), and the
 *  WI-4.3 per-tab editingEnabled override. */
export interface Tab {
  id: string;
  filePath: string | null; // null = untitled
  title: string;
  isPinned: boolean;
  /** WI-1A.12 — format registry id (e.g. "markdown", "txt"). Derived from filePath
   *  on createTab/createTransferredTab/updateTabPath. The Editor surface keys on
   *  this; a kind change triggers remount + undo reset + toast (ADR-10). */
  formatId: string;
  /** WI-4.3 — per-tab override of `formatConfig.adapters.readOnlyDefault`.
   *  When true, the editor mounts read-write even for kind="viewer"
   *  formats. Persists across tab switches; resets on tab close. */
  editingEnabled?: boolean;
  /** WI-1A.13 — active schemaRenderer id for formats that ship multiple
   *  (e.g. yaml-gha-workflow vs generic yaml tree). `undefined`/`null` means
   *  "let the schemaDetector decide on each render". Persisted directly
   *  in hot-exit so restore is deterministic and does not re-run pure
   *  detectors against possibly-edited content. */
  activeSchemaId?: string | null;
  /** Per-tab Source/Split/Preview view mode for split-pane / viewer formats.
   *  `undefined` means "use the global `formats.defaultViewMode` setting".
   *  Inert for formats without a preview (they always render source-only).
   *  See dev-docs/plans/20260703-split-pane-view-modes.md. */
  viewMode?: SplitViewMode;
}
