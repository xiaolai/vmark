/**
 * Settings search context.
 *
 * Purpose: broadcast the active settings-search query (lowercased, trimmed)
 *   to every `SettingRow` so each can decide whether it matches. Keeping the
 *   filter in the rows themselves means the rendered panels stay the single
 *   source of truth — there is no parallel searchable index to drift from the
 *   UI (D2).
 *
 * Empty string = not searching (rows always render). Non-empty = the dialog
 * stacks all panels and rows hide themselves when neither their label nor
 * description contains the query.
 *
 * @module pages/settings/SettingsSearchContext
 */

import { createContext, useContext } from "react";

export const SettingsSearchContext = createContext<string>("");

/** The current lowercased/trimmed settings-search query ("" when not searching). */
export function useSettingsSearchQuery(): string {
  return useContext(SettingsSearchContext);
}

/**
 * True when `query` is empty (not searching) or when either the label or the
 * description contains it. Used by `SettingRow` to decide visibility.
 */
export function matchesSettingsQuery(
  query: string,
  label: string,
  description?: string
): boolean {
  if (!query) return true;
  return `${label} ${description ?? ""}`.toLowerCase().includes(query);
}
