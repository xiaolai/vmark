/**
 * Toggle the two-documents side-by-side split for a window (#1081).
 *
 * Shared by the `view.toggleSplitDocuments` command and the keyboard shortcut
 * so they cannot drift.
 *
 * D9 — **an A/A split is illegal.** The shipped version seeded the secondary
 * pane with the ACTIVE tab, so the toggle showed one document twice. That state
 * was legal live, rejected by `replaceWindowSplit`, and dropped by
 * `workspaceSession` persistence — so a toggle plus a workspace round-trip
 * silently collapsed it. Opening now uses the NEXT document instead, which also
 * makes the shortcut do something useful.
 *
 * R4 — **the guards sit on the OPEN path only.** Putting the two-document check
 * at the top would trap the user inside a split with no way out: open a split,
 * hide one document via a workspace-instance switch, and the toggle that would
 * collapse it returns early instead.
 *
 * R6 — the count is of VISIBLE document tabs. A tab hidden by a workspace
 * instance is unreachable, so splitting onto it would show a document the user
 * has no way to focus.
 *
 * @coordinates-with stores/paneStore.ts — split state
 * @coordinates-with services/tabs/lastUsedTab.ts — which document to open beside
 * @module services/navigation/toggleSplitDocuments
 */
import { usePaneStore } from "@/stores/paneStore";
import { useTabStore } from "@/stores/tabStore";
import { visibleWindowTabs } from "@/services/tabs/visibleWindowTabs";
import { mruDocumentIds } from "@/services/tabs/lastUsedTab";

export function toggleSplitDocuments(windowLabel: string): void {
  // CLOSE FIRST, unguarded (R4). Collapsing must always be reachable.
  if (usePaneStore.getState().byWindow[windowLabel]?.enabled) {
    usePaneStore.getState().closeSplit(windowLabel);
    return;
  }

  const activeTabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  if (!activeTabId) return; // empty Welcome screen

  const documents = visibleWindowTabs(windowLabel).filter((t) => t.kind === "document");
  // Panes never hold a browser tab, so with one active there is nothing to split.
  if (!documents.some((t) => t.id === activeTabId)) return;
  if (documents.length < 2) return;

  // Prefer the most-recently-used other DOCUMENT. `lastUsedTabId` can return a
  // browser page (it is MRU over everything in the strip), and treating that as
  // "no MRU answer" abandoned the order entirely and grabbed whatever sat first
  // in strip order — so a browser page ahead of the real answer silently
  // changed which document you got.
  const documentIds = new Set(documents.map((t) => t.id));
  const mruTarget = mruDocumentIds(windowLabel).find(
    (id) => id !== activeTabId && documentIds.has(id),
  );
  // Cold start (D4: the MRU is not persisted) falls back to an adjacent one.
  const secondary = mruTarget ?? documents.find((t) => t.id !== activeTabId)?.id ?? null;
  if (!secondary || secondary === activeTabId) return;

  usePaneStore.getState().openSplit(windowLabel, secondary);
}
