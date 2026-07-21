/**
 * reconcile — the single settings trust boundary.
 *
 * Purpose: settings arrive from outside this window's typed store by exactly
 * two routes — hydration from localStorage, and a cross-window `storage` event
 * carrying another window's blob. Both are untrusted (a corrupt or
 * hand-edited localStorage value; a blob from a different build). They must
 * therefore pass the SAME guards.
 *
 * They previously did not: hydration ran sanitize → deepMerge → clamp →
 * normalizeBrowser, while useSettingsSync did a raw `setState` of whatever it
 * parsed. That left the D4 defence ("a corrupt persisted value can't render the
 * editor broken") with a hole exactly one code path wide — `appearance.fontSize:
 * 9999` was rejected at startup but accepted live from another window. Sharing
 * one implementation is what stops the two paths drifting again.
 *
 * @coordinates-with settingsStore.ts — persist `merge` (hydration route)
 * @coordinates-with hooks/useSettingsSync.ts — storage-event route
 * @module stores/settingsStore/reconcile
 */

import { deepMerge } from "@/utils/deepMerge";
import { clampMergedSettings } from "./clamp";
import { normalizeBrowserSettings, sanitizePersistedSettings } from "./persistGuards";

/**
 * Drop non-string elements from `advanced.customLinkProtocols`. sanitize
 * validates the field IS an array but not that its ELEMENTS are strings, so a
 * cross-window `[42, null, {}]` would otherwise reach the link-scheme allowlist
 * and the settings UI. Hydration filters these separately during its
 * default-union; doing it here means the storage-event route gets the same
 * guard (audit Medium-10). Mutates `merged` in place — it is freshly built by
 * deepMerge, so this touches no shared object.
 */
function filterCustomLinkProtocols(merged: Record<string, unknown>): void {
  const advanced = merged.advanced;
  if (!advanced || typeof advanced !== "object") return;
  const protocols = (advanced as Record<string, unknown>).customLinkProtocols;
  if (!Array.isArray(protocols)) return;
  const strings = protocols.filter((p): p is string => typeof p === "string");
  if (strings.length !== protocols.length) {
    (advanced as Record<string, unknown>).customLinkProtocols = strings;
  }
}

/**
 * Merge an untrusted settings blob onto a trusted base, applying every guard.
 *
 * @param base     Trusted current state (live store state, or the defaults).
 * @param incoming Untrusted partial settings blob.
 * @returns A NEW top-level object. Sections that came from `incoming` are
 *          freshly built by deepMerge; sections present only in `base` are
 *          shared by reference (deepMerge shallow-copies the top level). clamp
 *          and normalize mutate in place, so `base` must not be frozen — but in
 *          practice they only alter out-of-range/invalid values, and live
 *          state is already valid, so no shared `base` section is changed.
 */
export function reconcileSettings<T extends Record<string, unknown>>(
  base: T,
  incoming: Record<string, unknown>,
): T {
  // Shape-validate before merging: deepMerge OVERWRITES rather than recurses
  // when a value is a non-object, so an unsanitized `appearance: "evil"` would
  // replace a settings group with a primitive and crash its consumers.
  const sanitized = sanitizePersistedSettings(incoming, base);
  const merged = deepMerge(base, sanitized as Partial<T>) as T;

  // Bounded numeric fields, then enum-like browser posture values, then
  // string-array element hygiene.
  clampMergedSettings(merged as Record<string, unknown>);
  const browser = (merged as Record<string, unknown>).browser;
  if (browser && typeof browser === "object") {
    normalizeBrowserSettings(browser as Record<string, unknown>);
  }
  filterCustomLinkProtocols(merged as Record<string, unknown>);

  return merged;
}
