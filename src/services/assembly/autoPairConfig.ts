/**
 * Purpose: map the user's markdown settings onto the auto-pair plugin's config.
 *
 * Host-side glue, deliberately. `src/plugins/autoPair/` used to read
 * `useSettingsStore` itself, which is the coupling that stops a plugin shipping
 * as a standalone extension (ADR-015). The plugin declares the shape it needs;
 * this — which lives in `src/services/` and may reach the store — fills it in.
 *
 * @coordinates-with plugins/autoPair/tiptap.ts — the injected `getConfig`
 * @coordinates-with services/assembly/tiptapExtensions.ts — the registration
 * @module services/assembly/autoPairConfig
 */

import type { AutoPairConfig } from "@/plugins/autoPair/handlers";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Read the live auto-pair config.
 *
 * Called per keystroke rather than once at construction, so a settings change
 * takes effect without rebuilding the editor.
 */
export function currentAutoPairConfig(): AutoPairConfig {
  const settings = useSettingsStore.getState().markdown;
  const includeCJK = settings.autoPairCJKStyle !== "off";
  const includeCurlyQuotes = settings.autoPairCurlyQuotes ?? false;
  return {
    enabled: settings.autoPairEnabled ?? true,
    includeCJK,
    includeCurlyQuotes,
    normalizeRightDoubleQuote:
      includeCJK && includeCurlyQuotes && (settings.autoPairRightDoubleQuote ?? false),
  };
}
