/**
 * useFormatSettingsBridge — the React mount wrapper for the format-settings
 * subscription.
 *
 * The subscription logic itself is React-free and lives in
 * `services/formats/formatSettingsBridge.ts` (ADR-013); this hook only owns the
 * mount/unmount lifecycle. Mount inside document windows only (see
 * `DocumentWindowHooks` in App.tsx) — it avoids paying the subscription cost in
 * Settings / PDF-export windows that never carry open tabs.
 *
 * @coordinates-with services/formats/formatSettingsBridge.ts — the subscription
 * @module hooks/useFormatSettingsBridge
 */

import { useEffect } from "react";
import { installFormatSettingsSubscription } from "@/services/formats/formatSettingsBridge";

export function useFormatSettingsBridge(): void {
  useEffect(() => installFormatSettingsSubscription(), []);
}
