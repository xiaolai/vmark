/**
 * Purpose: map the user's markdown settings onto what the paste plugins accept.
 *
 * The boundary between the app's settings vocabulary and the plugins' own.
 * `codePaste` and `htmlPaste` used to read `useSettingsStore` directly, which
 * is the coupling that stops a plugin shipping as a standalone extension
 * (ADR-015).
 *
 * Read per paste, not once at construction, so changing paste mode takes
 * effect without rebuilding the editor.
 *
 * @coordinates-with plugins/shared/pasteSettings.ts — the plugins' vocabulary
 * @module services/assembly/pasteOptions
 */

import type { PasteSettings } from "@/plugins/shared/pasteSettings";
import { useSettingsStore } from "@/stores/settingsStore";

/** The live paste settings, translated for the plugins. */
export function currentPasteSettings(): PasteSettings {
  const markdown = useSettingsStore.getState().markdown;
  return {
    pasteMode: markdown.pasteMode ?? "smart",
    preserveLineBreaks: markdown.preserveLineBreaks ?? false,
  };
}
