/**
 * Pure helpers for tabStore.
 *
 * Purpose: the store's stateless helpers, extracted from tabStore.ts so it stays
 * under its size baseline — field updates (updateTabById), format derivation
 * (deriveFormatId), tab titles + localized format names (getTabTitle,
 * getLocalizedFormatName), path re-derivation (applyPathUpdate), tab removal +
 * post-removal active-tab selection (removeTabAt), and pinned-zone placement
 * (insertTabForPin, repositionForPin). No store access.
 *
 * Key decisions:
 *   - `mapDocumentTabById` preserves object identity wherever nothing changed,
 *     so a no-op setter doesn't wake every `state.tabs` subscriber.
 *   - Pinned tabs are a contiguous zone at the LEFT of the strip. Every
 *     placement helper here maintains that; the drag plan relies on it.
 *
 * @coordinates-with tabStore.ts — sole caller
 * @module stores/tabStoreHelpers
 */

import { dispatchEditor, getFormatById } from "@/lib/formats/registry";
import i18n from "@/i18n";
import { getFileName } from "@/utils/paths";
import { stripSupportedExtension } from "@/utils/dropPaths";
import type { Tab, DocumentTab } from "./tabStoreTypes";

/** Generate a process-unique tab id. Shared by the general store and the
 *  browser-workspace actions so the id format cannot drift between them. */
export const generateTabId = (): string =>
  `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

/** Tab display title from a file path (or a numbered "Untitled" for null). */
export function getTabTitle(filePath: string | null, untitledNum?: number): string {
  if (!filePath) {
    // Translated "Untitled" — `common:untitled`. The numbered suffix stays a
    // plain "-N" because file names don't carry locale formatting.
    const base = i18n.t("common:untitled");
    return untitledNum ? `${base}-${untitledNum}` : base;
  }
  return stripSupportedExtension(getFileName(filePath) || filePath);
}

/** Localized display name for a format id, falling back to the id when the
 *  format is unregistered or its translation key is missing — never throws. */
export function getLocalizedFormatName(formatId: string): string {
  const config = getFormatById(formatId);
  if (!config) return formatId;
  const namespaced = `common:${config.nameI18nKey}`;
  const translated = i18n.t(namespaced);
  // i18next echoes the key back when the translation is missing, and it echoes
  // it WITHOUT the namespace ("format.json", not "common:format.json") — so
  // guarding only the namespaced form lets the raw key leak into the toast.
  // Reject both echo forms.
  if (!translated || translated === namespaced || translated === config.nameI18nKey) {
    return formatId;
  }
  return translated;
}

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
 * The one immutable cross-window "find the document tab with this id and
 * replace it" primitive. `update` runs on the matching document tab; returning
 * the same object means "no change".
 *
 * Object identity is preserved wherever nothing changed: untouched windows keep
 * their array reference and an unknown id returns the ORIGINAL map. That is
 * what makes a no-op setter a true no-op — cloning the whole map would hand
 * every `state.tabs` subscriber a fresh reference and re-render the tab strip
 * for nothing.
 */
function mapDocumentTabById(
  tabs: Record<string, Tab[]>,
  tabId: string,
  update: (tab: DocumentTab) => DocumentTab,
): Record<string, Tab[]> {
  let changed = false;
  const next: Record<string, Tab[]> = {};
  for (const [windowLabel, windowTabs] of Object.entries(tabs)) {
    let windowChanged = false;
    const mapped = windowTabs.map((t) => {
      if (t.id !== tabId || t.kind !== "document") return t;
      const updated = update(t);
      if (updated === t) return t;
      windowChanged = true;
      return updated;
    });
    next[windowLabel] = windowChanged ? mapped : windowTabs;
    changed ||= windowChanged;
  }
  return changed ? next : tabs;
}

/**
 * Shared update helper for keyed-by-id tab field mutations.
 *
 * The per-field setters (setTabEditingEnabled, setTabActiveSchemaId,
 * setTabFormatId, setTabViewMode) share the same scan-and-map pattern.
 * Factoring this out keeps the setters thin and prevents drift (e.g., one
 * setter forgetting to clone state.tabs).
 *
 * Returns a partial state slice for direct return from Zustand's `set`. An
 * unknown id — or a patch that changes nothing — returns the original `tabs`
 * reference, so subscribers stay asleep.
 *
 * The patch is restricted to the per-tab document settings these setters own.
 * Path/title/pin state have their own actions (updateTabPath, updateTabTitle,
 * togglePin) that maintain invariants this helper knows nothing about.
 */
export function updateTabById(
  state: { tabs: Record<string, Tab[]> },
  tabId: string,
  patch: Partial<Pick<DocumentTab, "editingEnabled" | "activeSchemaId" | "formatId" | "viewMode">>,
): { tabs: Record<string, Tab[]> } {
  const entries = Object.entries(patch) as [keyof DocumentTab, unknown][];
  return {
    tabs: mapDocumentTabById(state.tabs, tabId, (tab) => {
      const unchanged = entries.every(([key, value]) => tab[key] === value);
      return unchanged ? tab : { ...tab, ...patch };
    }),
  };
}

/**
 * Re-path a document tab (and re-derive its title + formatId). Browser tabs and
 * non-matching ids pass through untouched. Returns the new tabs map plus the new
 * formatId when it changed (so the caller can fire the one-time format toast).
 */
export function applyPathUpdate(
  tabs: Record<string, Tab[]>,
  tabId: string,
  filePath: string,
): { tabs: Record<string, Tab[]>; formatChange: string | null } {
  let formatChange: string | null = null;
  const next = mapDocumentTabById(tabs, tabId, (tab) => {
    const nextFormatId = deriveFormatId(filePath);
    if (nextFormatId !== tab.formatId) formatChange = nextFormatId;
    return { ...tab, filePath, title: getTabTitle(filePath), formatId: nextFormatId };
  });
  return { tabs: next, formatChange };
}

/** Active tab after removing `removedId` at `removedIndex`: keep current if not
 *  active, else the right neighbor, then left, then null (shared, no drift). */
function nextActiveAfterRemoval(
  current: string | null,
  removedId: string,
  removedIndex: number,
  remaining: Tab[],
): string | null {
  if (current !== removedId) return current;
  if (remaining.length === 0) return null;
  return remaining[Math.min(removedIndex, remaining.length - 1)].id;
}

/** State slice both removal paths (close, detach) rewrite. */
type RemovalSlice = {
  tabs: Record<string, Tab[]>;
  activeTabId: Record<string, string | null>;
  lastActiveBrowserPageId?: Record<string, string | null>;
};

/**
 * Drop the tab at `index` from `windowLabel` and re-pick the active tab. The one
 * removal implementation — closeTab and detachTab differ only in whether they
 * also record the tab in `closedTabs`, so they cannot drift apart here.
 */
/**
 * Set a window's active tab, but only to null or an id the window actually contains.
 *
 * A foreign id — a stale reopen, an id from another window mid-drag — would otherwise
 * become `activeTabId` and every downstream lookup (getActiveTab, editor dispatch) would
 * resolve to a tab that is not in this window. Guard the keyed write rather than trust the
 * caller; returns the state unchanged when the id is not a member. (Audit, High.)
 */
export function setActiveTabGuarded<
  S extends { tabs: Record<string, { id: string }[]>; activeTabId: Record<string, string | null> },
>(state: S, windowLabel: string, tabId: string | null): S {
  if (tabId !== null && !state.tabs[windowLabel]?.some((t) => t.id === tabId)) {
    return state;
  }
  return { ...state, activeTabId: { ...state.activeTabId, [windowLabel]: tabId } };
}

export function removeTabAt(state: RemovalSlice, windowLabel: string, index: number): RemovalSlice {
  const windowTabs = state.tabs[windowLabel] ?? [];
  // Out of range (or a missing window) is a no-op, not a crash: `windowTabs[index]` would
  // otherwise be `undefined` and `.id` would throw. Callers guard today, but the helper is
  // exported and must not depend on that — the project rule is to guard keyed access here.
  // (Audit, Medium.)
  const removed = windowTabs[index];
  if (!removed) return state;
  const removedId = removed.id;
  const remaining = windowTabs.filter((_, i) => i !== index);
  const nextActive = nextActiveAfterRemoval(state.activeTabId[windowLabel] ?? null, removedId, index, remaining);
  // If the successor is a browser page, it becomes the workspace's reopen target
  // (closing the active page bypasses setActiveTab, which would otherwise track it).
  const trackBrowser =
    state.lastActiveBrowserPageId !== undefined &&
    !!nextActive &&
    remaining.some((t) => t.id === nextActive && t.kind === "browser");
  return {
    tabs: { ...state.tabs, [windowLabel]: remaining },
    activeTabId: { ...state.activeTabId, [windowLabel]: nextActive },
    ...(trackBrowser
      ? { lastActiveBrowserPageId: { ...state.lastActiveBrowserPageId, [windowLabel]: nextActive } }
      : {}),
  };
}

/** Index just past the last pinned tab — pinned tabs form a contiguous zone at
 *  the left of the strip, which is where a pinned tab must be (re)inserted. */
function pinnedZoneEnd(tabs: Tab[]): number {
  let end = 0;
  while (end < tabs.length && tabs[end].isPinned) end++;
  return end;
}

/** Insert `tab` at the position its pin state requires: pinned tabs join the end
 *  of the pinned zone, unpinned tabs go to the end of the strip. */
export function insertTabForPin(tabs: Tab[], tab: Tab): Tab[] {
  if (!tab.isPinned) return [...tabs, tab];
  const next = [...tabs];
  next.splice(pinnedZoneEnd(next), 0, tab);
  return next;
}

/** Reposition the tab at `index` after its pin state flipped. Either way it lands
 *  at the pinned/unpinned boundary: pinning appends it to the pinned zone,
 *  unpinning moves it to the head of the unpinned zone. Unpinning in place would
 *  strand the remaining pinned tabs to the RIGHT of an unpinned one and break the
 *  contiguity the drag plan assumes. */
export function repositionForPin(tabs: Tab[], index: number, updated: Tab): Tab[] {
  const remaining = tabs.filter((_, i) => i !== index);
  const next = [...remaining];
  next.splice(pinnedZoneEnd(remaining), 0, updated);
  return next;
}
