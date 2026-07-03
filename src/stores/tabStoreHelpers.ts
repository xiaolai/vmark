/**
 * Pure helpers for tabStore.
 *
 * Purpose: the store's stateless field-update / format-derivation / active-tab
 * helpers, extracted from tabStore.ts so it stays under its size baseline. No
 * store access — exercised via tabStore.test.ts through the actions that use
 * them.
 *
 * @coordinates-with tabStore.ts — sole caller
 * @module stores/tabStoreHelpers
 */

import { dispatchEditor } from "@/lib/formats/registry";
import type { Tab } from "./tabStoreTypes";

/** Derive a tab's format id from its path, defaulting to markdown. */
export function deriveFormatId(filePath: string | null): string {
  // dispatchEditor throws only when no formats are registered (test-only edge);
  // production bootstraps markdown + txt + stubs at app start. Defensive try
  // keeps the store usable in any code path that runs before bootstrap.
  /* v8 ignore next 5 -- @preserve defensive fallback for unbootstrapped registry */
  try {
    return dispatchEditor(filePath).id;
  } catch {
    return "markdown";
  }
}

/**
 * Shared update helper for keyed-by-id tab field mutations.
 *
 * The per-field setters (setTabEditingEnabled, setTabActiveSchemaId,
 * setTabFormatId, setTabViewMode) share the same scan-and-map pattern: walk
 * every window's tab array, replace exactly one tab (by id) with a
 * shallow-merged copy. Factoring this out keeps the setters thin and prevents
 * drift (e.g., one setter forgetting to clone state.tabs).
 *
 * Returns a partial state slice for direct return from Zustand's `set`.
 * Unknown ids result in a no-op clone (same shape, same data) — safe.
 */
export function updateTabById(
  state: { tabs: Record<string, Tab[]> },
  tabId: string,
  patch: Partial<Tab>,
): { tabs: Record<string, Tab[]> } {
  const newTabs = { ...state.tabs };
  for (const windowLabel of Object.keys(newTabs)) {
    newTabs[windowLabel] = newTabs[windowLabel].map((t) =>
      t.id === tabId ? { ...t, ...patch } : t,
    );
  }
  return { tabs: newTabs };
}

/** Active tab after removing `removedId` at `removedIndex`: keep current if not
 *  active, else the right neighbor, then left, then null (shared, no drift). */
export function nextActiveAfterRemoval(
  current: string | null,
  removedId: string,
  removedIndex: number,
  remaining: Tab[],
): string | null {
  if (current !== removedId) return current;
  if (remaining.length === 0) return null;
  return remaining[Math.min(removedIndex, remaining.length - 1)].id;
}
