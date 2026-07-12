/**
 * Pure helpers for tabStore.
 *
 * Purpose: the store's stateless helpers, extracted from tabStore.ts so it stays
 * under its size baseline — field updates (updateTabById), format derivation
 * (deriveFormatId), tab titles + localized format names (getTabTitle,
 * getLocalizedFormatName), path re-derivation (applyPathUpdate), and post-removal
 * active-tab selection. No store access — exercised via tabStore.test.ts through
 * the actions that use them.
 *
 * @coordinates-with tabStore.ts — sole caller
 * @module stores/tabStoreHelpers
 */

import { dispatchEditor, getFormatById } from "@/lib/formats/registry";
import i18n from "@/i18n";
import { getFileName } from "@/utils/paths";
import { stripSupportedExtension } from "@/utils/dropPaths";
import type { Tab, DocumentTab } from "./tabStoreTypes";

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
  const translated = i18n.t(`common:${config.nameI18nKey}`);
  // i18next returns the key string when missing; treat that as a miss.
  return translated && translated !== `common:${config.nameI18nKey}` ? translated : formatId;
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
 *
 * The patch is `Partial<DocumentTab>` because every caller sets a document-only
 * field (editingEnabled, activeSchemaId, formatId, viewMode). Browser tabs pass
 * through untouched — a browser tab can never be the target of these setters.
 */
export function updateTabById(
  state: { tabs: Record<string, Tab[]> },
  tabId: string,
  patch: Partial<Omit<DocumentTab, "kind" | "id">>,
): { tabs: Record<string, Tab[]> } {
  const newTabs = { ...state.tabs };
  for (const windowLabel of Object.keys(newTabs)) {
    newTabs[windowLabel] = newTabs[windowLabel].map((t) =>
      t.id === tabId && t.kind === "document" ? { ...t, ...patch } : t,
    );
  }
  return { tabs: newTabs };
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
  const next = { ...tabs };
  for (const windowLabel of Object.keys(next)) {
    next[windowLabel] = next[windowLabel].map((t) => {
      if (t.id !== tabId || t.kind !== "document") return t;
      const nextFormatId = deriveFormatId(filePath);
      if (nextFormatId !== t.formatId) formatChange = nextFormatId;
      return { ...t, filePath, title: getTabTitle(filePath), formatId: nextFormatId };
    });
  }
  return { tabs: next, formatChange };
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
