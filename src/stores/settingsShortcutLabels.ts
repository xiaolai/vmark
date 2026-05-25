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
  const key = `settings:shortcuts.label.${shortcut.id}`;
  const translated = i18n.t(key);
  if (translated === key || translated === `shortcuts.label.${shortcut.id}`) {
    return shortcut.label;
  }
  return translated;
}
