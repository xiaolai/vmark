/**
 * tabDragRules
 *
 * Purpose: Pure functions for tab reorder policy. Determines whether a
 * drag-and-drop reorder is allowed and computes the final insertion index.
 *
 * Key decisions:
 *   - Pinned tabs form a contiguous zone at the left — unpinned tabs cannot
 *     be dropped into the pinned zone and vice versa.
 *   - normalizeInsertionIndex converts the visual drop position (between tabs)
 *     to an array insertion index, accounting for the source tab being removed.
 *   - All functions are side-effect-free, making them easy to test and reuse
 *     from both pointer-drag and keyboard-reorder code paths.
 *
 * @coordinates-with useStatusBarTabDrag.ts — calls planReorder during drag
 * @coordinates-with tabKeyboard.ts — calls planReorder for Alt+Shift+Arrow
 * @module components/StatusBar/tabDragRules
 */
import type { Tab } from "@/stores/tabStore";

/** Result of a tab reorder validity check. */
export interface ReorderPlan {
  allowed: boolean;
  toIndex: number;
  blockedReason: "none" | "pinned-zone";
}

/**
 * Convert visual insertion index (0..N) into array insertion index after removing the source.
 */
export function normalizeInsertionIndex(fromIndex: number, dropIndex: number, tabCount: number): number {
  let toIndex = dropIndex;
  if (fromIndex < dropIndex) {
    toIndex = dropIndex - 1;
  }
  return Math.max(0, Math.min(toIndex, tabCount - 1));
}

/** Return the index of the last pinned tab, or -1 if none are pinned. */
export function getLastPinnedIndex(tabs: Tab[]): number {
  return tabs.reduce((last, tab, index) => (tab.isPinned ? index : last), -1);
}

/**
 * Reorder policy:
 * - Pinned tabs are non-draggable in UI, but if requested, they must stay in pinned zone.
 * - Unpinned tabs cannot move into pinned zone.
 */
export function planReorder(tabs: Tab[], fromIndex: number, visualDropIndex: number): ReorderPlan {
  if (fromIndex < 0 || fromIndex >= tabs.length) {
    return { allowed: false, toIndex: fromIndex, blockedReason: "none" };
  }
  const toIndex = normalizeInsertionIndex(fromIndex, visualDropIndex, tabs.length);
  const tab = tabs[fromIndex];

  const lastPinnedIndex = getLastPinnedIndex(tabs);
  if (!tab.isPinned && toIndex <= lastPinnedIndex) {
    return { allowed: false, toIndex: Math.max(lastPinnedIndex + 1, 0), blockedReason: "pinned-zone" };
  }

  if (tab.isPinned && toIndex > lastPinnedIndex) {
    return { allowed: false, toIndex: Math.max(lastPinnedIndex, 0), blockedReason: "pinned-zone" };
  }

  return { allowed: true, toIndex, blockedReason: "none" };
}

/** A document-tab reorder resolved to FLAT store indices for `reorderTabs`. */
export interface DocumentReorderPlan {
  allowed: boolean;
  blockedReason: "none" | "pinned-zone";
  /** Flat index of the dragged tab in the window's tab array. */
  fromFlat: number;
  /** Flat insertion index; equals `fromFlat` when the move is a no-op/blocked. */
  toFlat: number;
}

/**
 * Plan a document-tab reorder given the window's FLAT tab array and a drop index
 * in *document* (strip) space.
 *
 * The status-bar strip renders document tabs only — browser pages collapse into
 * a single trailing "workspace" tab — so the drop index counts document tabs
 * (plus that synthetic tab), NOT flat store positions. Planning in the flat
 * space directly would move the wrong tab whenever a browser page is interleaved
 * among documents. This plans the reorder among document tabs (so pinned-zone
 * rules apply to what the user actually sees), then translates the target back
 * to a flat index for `reorderTabs`.
 */
export function planDocumentReorder(
  windowTabs: Tab[],
  tabId: string,
  documentDropIndex: number,
): DocumentReorderPlan {
  const documentFlatIndices: number[] = [];
  for (let i = 0; i < windowTabs.length; i++) {
    if (windowTabs[i].kind !== "browser") documentFlatIndices.push(i);
  }

  const fromFlat = windowTabs.findIndex((t) => t.id === tabId);
  const docFrom = documentFlatIndices.indexOf(fromFlat);
  // Not a document tab (or unknown id) — the strip never drag-reorders browser pages.
  if (docFrom === -1) {
    return { allowed: false, blockedReason: "none", fromFlat, toFlat: fromFlat };
  }

  const documentTabs = documentFlatIndices.map((i) => windowTabs[i]);
  const plan = planReorder(documentTabs, docFrom, documentDropIndex);
  if (!plan.allowed || docFrom === plan.toIndex) {
    return { allowed: false, blockedReason: plan.blockedReason, fromFlat, toFlat: fromFlat };
  }

  return {
    allowed: true,
    blockedReason: "none",
    fromFlat,
    toFlat: documentFlatIndices[plan.toIndex],
  };
}
