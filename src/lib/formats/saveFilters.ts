/**
 * Purpose: resolve a format's save-dialog filters — localized names, registry
 * extension lists — at CALL time.
 *
 * Key decisions:
 *   - `FormatAdapters.saveDialogFilters` carries an i18n KEY, not a display
 *     name. A literal name is evaluated when the adapter module loads, before
 *     i18n is ready and long before the user can change language, so every
 *     consumer of the old shape shipped English. Carrying the key makes the
 *     untranslated state unrepresentable rather than merely discouraged.
 *   - One markdown fallback for the pre-bootstrap path. Four call sites had
 *     open-coded it and drifted: `closeSave` offered only `.md`, `fileOpen`
 *     offered all five spellings, so the same file was visible in one dialog
 *     and not the other.
 *   - Extension arrays are copied out. The registry's config objects are
 *     shared, and Tauri's dialog plugin has no reason to be handed a live
 *     reference into them.
 *
 * @coordinates-with lib/formats/registry.ts — the source of the configs
 * @coordinates-with stores/tabStoreHelpers.ts — reuses localizedFormatName
 * @module lib/formats/saveFilters
 */
import i18n from "@/i18n";
import { getFormatById } from "./registry";
import type { FormatConfig } from "./types";

/** Every markdown spelling the app opens. Used only before bootstrap. */
export const MARKDOWN_EXTENSIONS_FALLBACK = [
  "md",
  "markdown",
  "mdown",
  "mkd",
  "mdx",
] as const;

const MARKDOWN_ID = "markdown";
const MARKDOWN_NAME_KEY = "format.markdown";

/**
 * Translate a format name key, falling back to `fallback` when the lookup
 * fails.
 *
 * i18next echoes a missing key back, and it echoes the BARE key
 * (`"format.json"`), not the namespaced one it was asked for
 * (`"common:format.json"`). Guarding only the namespaced spelling let the raw
 * key leak into user-visible dialog text.
 */
export function localizedFormatName(nameI18nKey: string, fallback: string): string {
  if (!nameI18nKey) return fallback;
  const namespaced = `common:${nameI18nKey}`;
  const translated = i18n.t(namespaced);
  if (!translated || translated === namespaced || translated === nameI18nKey) {
    return fallback;
  }
  return translated;
}

/** A format's save-dialog filters, names resolved against the active locale. */
export function resolveSaveFilters(
  config: FormatConfig
): { name: string; extensions: string[] }[] {
  return config.adapters.saveDialogFilters.map((filter) => ({
    name: localizedFormatName(filter.nameI18nKey, config.id),
    extensions: [...filter.extensions],
  }));
}

/**
 * The Markdown filter, for callers with no format in hand — a null path, or a
 * registry that has not been bootstrapped yet (tests, early startup).
 */
export function markdownSaveFilters(): { name: string; extensions: string[] }[] {
  const config = getFormatById(MARKDOWN_ID);
  if (config) return resolveSaveFilters(config);
  return [
    {
      name: localizedFormatName(MARKDOWN_NAME_KEY, "Markdown"),
      extensions: [...MARKDOWN_EXTENSIONS_FALLBACK],
    },
  ];
}

/** Every markdown extension, registry-backed when available. */
export function markdownExtensions(): string[] {
  return [...(getFormatById(MARKDOWN_ID)?.extensions ?? MARKDOWN_EXTENSIONS_FALLBACK)];
}
