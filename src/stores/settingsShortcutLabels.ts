/**
 * Shortcut label translation helpers.
 *
 * Extracted from settingsStore.ts so settingsStore stays free of `i18n`
 * imports — `i18n.ts` imports settingsStore at module top, so importing
 * i18n back into settingsStore would create a circular dependency.
 *
 * @module stores/settingsShortcutLabels
 */
import i18n from "@/i18n";
import {
  CATEGORY_LABELS,
  type ShortcutCategory,
  type ShortcutDefinition,
} from "./settingsStore";

/**
 * Returns the translated label for a shortcut category.
 * Falls back to CATEGORY_LABELS[category] if the translation key is missing.
 */
export function getCategoryLabel(category: ShortcutCategory): string {
  const translated = i18n.t(`settings:shortcuts.category.${category}`);
  if (
    translated === `settings:shortcuts.category.${category}` ||
    translated === `shortcuts.category.${category}`
  ) {
    return CATEGORY_LABELS[category];
  }
  return translated;
}

/**
 * Returns the translated label for a shortcut by its ID.
 * Falls back to the shortcut's `label` field if the translation key is missing.
 */
export function getShortcutLabel(shortcut: ShortcutDefinition): string {
  return translateOrFall(`shortcuts.label.${shortcut.id}`, shortcut.label);
}

/**
 * Returns the translated description for a shortcut, or undefined when it has
 * none. Descriptions were rendered straight from the registry's hardcoded
 * English, so a localized settings panel showed 44 English subtitles under
 * translated labels.
 */
export function getShortcutDescription(shortcut: ShortcutDefinition): string | undefined {
  if (!shortcut.description) return undefined;
  return translateOrFall(`shortcuts.description.${shortcut.id}`, shortcut.description);
}

/**
 * i18next echoes a missing key back — sometimes namespaced, sometimes not — so
 * both echo forms have to be rejected before falling back to the English in
 * the registry.
 */
function translateOrFall(bareKey: string, fallback: string): string {
  const namespaced = `settings:${bareKey}`;
  const translated = i18n.t(namespaced);
  if (translated === namespaced || translated === bareKey) return fallback;
  return translated;
}
