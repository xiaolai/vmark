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
import { rebootstrapFormats } from "@/lib/formats";
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
 */
export function installFormatSettingsSubscription(): () => void {
  let last = snapshot(useSettingsStore.getState().formats);

  return useSettingsStore.subscribe((state) => {
    const next = snapshot(state.formats);
    if (togglesEqual(last, next)) return;
    last = next;
    rebootstrapFormats(next);
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
