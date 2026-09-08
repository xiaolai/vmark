/**
 * Purpose: Edit → Use Selection for Find (Mod+E). Seeds the find bar's query
 *   from the focused editor's selection and opens the bar.
 *
 *   `hooks/useSearchCommands.ts` relays the native menu event as the DOM
 *   CustomEvent `use-selection-for-find`; `FindBar` listens and calls this. The
 *   binding was a no-op for months because nothing listened (feature-ledger
 *   plan, WI-FL3.4).
 *
 * Key decisions:
 *   - Only the FIRST LINE of the selection becomes the query: the bar matches
 *     within a block (`findMatches.ts`), so a selection spanning a line break
 *     could never match as written.
 *   - An empty selection still opens the bar and leaves the query alone — the
 *     user asked for find, not for a cleared query.
 *   - Opening mirrors `menu:find-replace` in useSearchCommands: the status bar
 *     is displaced and the universal toolbar hidden so the bars never stack.
 *     An already-open bar only takes the new query; its chrome is left alone.
 *
 * @coordinates-with services/editor/activeSelectionText.ts — where the text comes from
 * @coordinates-with stores/uiStore/searchSlice.ts — the search state
 * @coordinates-with hooks/useSearchCommands.ts — the menu-event producer
 * @module services/search/seedFindFromSelection
 */
import { useUIStore } from "@/stores/uiStore";
import { readActiveSelectionText } from "@/services/editor/activeSelectionText";

/** The find query a selection yields: its first line, verbatim ("" if none). */
export function findQueryFromSelection(selected: string): string {
  return selected.split(/\r?\n/, 1)[0] ?? "";
}

/** Seed the find query from the focused editor's selection and open the bar. */
export function seedFindFromSelection(): void {
  const query = findQueryFromSelection(readActiveSelectionText());
  const ui = useUIStore.getState();
  if (query) ui.searchSetQuery(query);
  if (!ui.search.isOpen) {
    ui.displaceStatusBar();
    ui.setUniversalToolbarVisible(false);
    ui.searchOpen();
  }
}
