/**
 * Content Search Navigation
 *
 * Purpose: Pending-scroll bridge between "Find in Files" and the editor.
 * When a user selects a search result, we store the target line and query
 * so the editor can scroll to it on mount/activation and pre-fill the FindBar.
 *
 * Follows the same pattern as lintNavigation.ts — a simple in-memory map
 * consumed by Source/WYSIWYG editors on mount.
 *
 * @coordinates-with contentSearchStore.ts — sets pending nav on result selection
 * @coordinates-with SourceEditor.tsx — consumes pending nav on mount
 * @coordinates-with searchStore.ts — receives pre-filled query
 * @coordinates-with useSearchCommands.ts — opens FindBar with mutual exclusion
 * @module hooks/contentSearchNavigation
 */

import { useSearchStore } from "@/stores/searchStore";
import { useUIStore } from "@/stores/uiStore";

interface PendingNav {
  /** 1-indexed line number to scroll to. */
  line: number;
  /** Search query to pre-fill in FindBar. */
  query: string;
}

/** Pending navigation targets keyed by tab ID. */
const pendingNavByTab: Record<string, PendingNav> = {};

/** Store a pending navigation target for a tab (called after file open). */
export function setPendingContentSearchNav(
  tabId: string,
  line: number,
  query: string
): void {
  pendingNavByTab[tabId] = { line, query };
}

/**
 * Consume pending navigation for a tab. Called by the editor on mount/activation.
 * Returns the pending nav and removes it, or undefined if none.
 */
export function consumePendingContentSearchNav(
  tabId: string
): PendingNav | undefined {
  const nav = pendingNavByTab[tabId];
  if (nav !== undefined) {
    delete pendingNavByTab[tabId];
  }
  return nav;
}

/**
 * Open FindBar with a pre-filled query, handling mutual exclusion with
 * StatusBar and UniversalToolbar (same logic as useSearchCommands.ts).
 */
export function openFindBarWithQuery(query: string): void {
  const search = useSearchStore.getState();
  if (!search.isOpen) {
    useUIStore.getState().setStatusBarVisible(false);
    useUIStore.getState().setUniversalToolbarVisible(false);
  }
  useSearchStore.getState().setQuery(query);
  if (!search.isOpen) {
    useSearchStore.getState().open();
  }
}
