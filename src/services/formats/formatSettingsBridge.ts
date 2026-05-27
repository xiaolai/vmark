/**
 * Format-settings bridge.
 *
 * Wires the user's `settings.formats.*` toggles to the format registry.
 * On mount it subscribes to the settings store; whenever any of the four
 * category toggles flips, the registry rebuilds and every open tab's
 * `formatId` is recomputed so newly-disabled formats fall back to txt
 * and newly-enabled formats remount via the Editor's `${tabId}-${formatId}`
 * remount key.
 *
 * Lives in utils/ rather than stores/ because it only orchestrates —
 * no state of its own.
 *
 * @coordinates-with stores/settingsStore.ts — reads `formats.*` toggles
 * @coordinates-with lib/formats/index.ts — calls rebootstrapFormats
 * @coordinates-with stores/tabStore.ts — calls recomputeAllFormatIds
 * @module utils/formatSettingsBridge
 */

import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { rebootstrapFormats, setFormatAssociationsProvider } from "@/lib/formats";
import type { FormatsSettings } from "@/stores/settingsTypes";

type ToggleSnapshot = Pick<
  FormatsSettings,
  "dataFormats" | "diagrams" | "htmlPreview" | "codeViewers"
>;

function snapshot(formats: FormatsSettings): ToggleSnapshot {
  return {
    dataFormats: formats.dataFormats,
    diagrams: formats.diagrams,
    htmlPreview: formats.htmlPreview,
    codeViewers: formats.codeViewers,
  };
}

function togglesEqual(a: ToggleSnapshot, b: ToggleSnapshot): boolean {
  return (
    a.dataFormats === b.dataFormats &&
    a.diagrams === b.diagrams &&
    a.htmlPreview === b.htmlPreview &&
    a.codeViewers === b.codeViewers
  );
}

/**
 * Install the subscription. Returns an unsubscribe fn — call from
 * tests; production callers can ignore (lifetime is the app process).
 *
 * Two distinct concerns ride this one subscription:
 *   - Category toggles flipping → the registry must rebuild
 *     (`rebootstrapFormats`), then every tab re-derives its formatId.
 *   - Associations changing → the registry is unchanged (same formats
 *     registered), but tabs must re-derive so the new association takes
 *     effect. The registry reads associations live via the provider
 *     installed below, so no rebuild is needed.
 */
export function installFormatSettingsSubscription(): () => void {
  // The registry resolves associations lazily through this provider, so
  // it always sees the current settings without importing the store.
  setFormatAssociationsProvider(
    () => useSettingsStore.getState().formats.associations ?? {},
  );

  // Recompute every open tab's formatId NOW. Hot-exit-restored tabs are
  // created during a child component's effect (DocumentWindowMount), which
  // by React's bottom-up effect order runs BEFORE this hook's effect — so
  // any restored tab had its formatId derived against an empty associations
  // map. Without this one-shot recompute the user's persisted overrides
  // would be silently ignored on every cold start until they touched a
  // setting. (Audit finding H1.)
  useTabStore.getState().recomputeAllFormatIds();

  let lastToggles = snapshot(useSettingsStore.getState().formats);
  let lastAssociations = useSettingsStore.getState().formats.associations;

  return useSettingsStore.subscribe((state) => {
    const nextToggles = snapshot(state.formats);
    const nextAssociations = state.formats.associations;

    const togglesChanged = !togglesEqual(lastToggles, nextToggles);
    // Reference comparison is sufficient: updateFormatsSetting replaces the
    // whole object, so a real change always yields a new reference.
    const associationsChanged = lastAssociations !== nextAssociations;
    if (!togglesChanged && !associationsChanged) return;

    lastToggles = nextToggles;
    lastAssociations = nextAssociations;

    if (togglesChanged) rebootstrapFormats(nextToggles);
    useTabStore.getState().recomputeAllFormatIds();
  });
}

/**
 * React hook variant — mount inside document windows only (see
 * `DocumentWindowHooks` in App.tsx). Avoids paying the subscription
 * cost in Settings / PDF-export windows that never carry open tabs.
 */
export function useFormatSettingsBridge(): void {
  useEffect(() => installFormatSettingsSubscription(), []);
}
