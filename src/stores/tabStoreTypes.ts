/**
 * tabStore shared types.
 *
 * Purpose: the `Tab` discriminated union, split out so both tabStore.ts and its
 * pure helpers (tabStoreHelpers.ts) can import it without a circular
 * dependency. Re-exported from tabStore.ts for backward-compatible
 * `import { Tab } from "@/stores/tabStore"`.
 *
 * A tab is either a `DocumentTab` (an editable file — the historical shape, kept
 * bit-for-bit unchanged aside from the added `kind` discriminant) or a
 * `BrowserTab` (an embedded web page — WI-1.1 / R1). The two are discriminated
 * on `kind`. `BrowserTab` has NO `filePath`/`formatId`; consumers that touch
 * those fields must narrow with `isDocumentTab` first — `Editor.tsx` MUST branch
 * on `tab.kind` before calling `dispatchEditor(filePath)`, or a browser tab
 * (which has no path) would resolve as an untitled markdown document.
 *
 * @module stores/tabStoreTypes
 */

import type { SplitViewMode } from "@/lib/formats/types";

/** What every tab has, whatever it holds. Kept in one place so the shared fields
 *  can't drift between the two union members. */
interface BaseTab {
  id: string;
  title: string;
  /** Pinned tabs form a contiguous zone at the LEFT of the strip (tabStore's
   *  pin/reorder/transfer paths all maintain that) and refuse to close. */
  isPinned: boolean;
}

/** A single editor tab backed by a document (file or untitled). Carries the
 *  format adapter id (derived from filePath via dispatchEditor) and the WI-4.3
 *  per-tab editingEnabled override. This is the historical `Tab` contract. */
export interface DocumentTab extends BaseTab {
  /** R1 discriminant — a document tab, editable via the format registry. */
  kind: "document";
  filePath: string | null; // null = untitled
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

/** A single tab backed by an embedded web page (WI-1.1 / R1). Carries only the
 *  minimal session-restorable state; the live native webview and its transient
 *  state (loading, favicon, snapshot) are owned by the browser surface, not the
 *  tab record. Browser tabs do NOT participate in workspace transfer in v1. */
export interface BrowserTab extends BaseTab {
  /** R1 discriminant — a browser tab; has no document path or format. */
  kind: "browser";
  /** Current URL (canonicalized for dedup on create; updated on navigation). */
  url: string;
  /** Last known scroll offset, persisted for restore. */
  scrollY?: number;
  /**
   * Navigation generation of the currently committed page (WI-2.1 / R4).
   * Driver operations are stamped with it, so one authorized against this page is
   * rejected by the Rust gate once the page navigates away. `0` until the first
   * commit — a value the driver will refuse, which is the correct default.
   */
  generation?: number;
}

/** A tab is a document or a browser page, discriminated on `kind`. */
export type Tab = DocumentTab | BrowserTab;

/** True when `tab` is a document tab (narrows to `DocumentTab`). */
export function isDocumentTab(tab: Tab): tab is DocumentTab {
  return tab.kind === "document";
}

/** True when `tab` is a browser tab (narrows to `BrowserTab`). */
export function isBrowserTab(tab: Tab): tab is BrowserTab {
  return tab.kind === "browser";
}

/** A tab's document file path, or `null` for untitled/browser tabs. Ergonomic
 *  accessor for the many call sites that only want "the path if there is one". */
export function tabFilePath(tab: Tab): string | null {
  return tab.kind === "document" ? tab.filePath : null;
}
