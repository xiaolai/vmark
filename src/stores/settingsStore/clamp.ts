/**
 * Settings clamp ranges
 *
 * Purpose: Inclusive [min, max] bounds for numeric settings that render visibly
 * broken when out of range (D4), plus helpers that clamp a single value or every
 * bounded field on a merged object. Split out of settingsStore.ts to keep that
 * file near the ~300-line guideline.
 *
 * @coordinates-with settingsStore.ts — applies clamping on set + at persist boundary
 * @coordinates-with settingsTypes.ts — range comments reference CLAMP_RANGES
 * @module stores/settingsStore/clamp
 */

import { isPlainObject } from "./persistGuards";
import type { ObjectSections } from "./defaults";

/**
 * Inclusive [min, max] bounds for numeric settings that render visibly broken
 * when out of range (D4). The UI only offers bounded presets, so these never
 * fire for normal use — they exist to defend against corrupt persisted state
 * or devtools/localStorage edits (e.g. `appearance.fontSize: 999`). Applied
 * both on every programmatic set (createSectionUpdater) and at the persist
 * boundary (clampMergedSettings in `merge`). Fields not listed are unbounded
 * or non-numeric. Exported for testing.
 */
export const CLAMP_RANGES: Partial<Record<ObjectSections, Record<string, [number, number]>>> = {
  appearance: {
    fontSize: [8, 48],
    lineHeight: [1, 3],
    blockSpacing: [0, 3],
    editorWidth: [0, 200],
  },
  terminal: {
    fontSize: [8, 32],
    lineHeight: [1, 2.5],
    scrollback: [100, 200_000],
    panelRatio: [0.1, 0.8],
    minimumContrastRatio: [1, 21],
  },
  general: {
    autoSaveInterval: [5, 3600],
    historyMaxSnapshots: [1, 1000],
    historyMaxAgeDays: [0, 3650],
    historyMergeWindow: [0, 3600],
    historyMaxFileSize: [0, 1_048_576],
    tabSize: [1, 8],
  },
};

/** Clamp a single value if its (section, key) has a known numeric range. */
export function clampSettingValue<V>(section: ObjectSections, key: PropertyKey, value: V): V {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const range = CLAMP_RANGES[section]?.[key as string];
  if (!range) return value;
  return Math.min(Math.max(value, range[0]), range[1]) as V;
}

/** Clamp every bounded numeric field on a merged settings object in place.
 *  Exported for testing. */
export function clampMergedSettings(merged: Record<string, unknown>): void {
  for (const [section, ranges] of Object.entries(CLAMP_RANGES)) {
    const group = merged[section];
    if (!isPlainObject(group)) continue;
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const v = group[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        group[key] = Math.min(Math.max(v, min), max);
      }
    }
  }
}
