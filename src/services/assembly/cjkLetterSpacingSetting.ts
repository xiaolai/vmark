/**
 * cjkLetterSpacingSetting — whether CJK letter spacing is on, as the hosts of
 * the `cjkLetterSpacing` plugin tell it.
 *
 * Key decisions:
 *   - One predicate for both hosts, the WYSIWYG editor and export. The plugin
 *     cannot read the store (ADR-015) and defaults to ON, so a host that does
 *     not pass this decorates every CJK run even with spacing off — the
 *     default — where the decorations change nothing on screen. The editor
 *     host had been missing it (#1565).
 *   - A predicate, asked per transaction: a settings change dispatches a
 *     tagged transaction (`useTiptapSettingsSync`), and the plugin rebuilds
 *     or clears on it.
 *
 * @coordinates-with plugins/cjkLetterSpacing/plugin.ts — the `isEnabled` option it answers
 * @coordinates-with services/assembly/tiptapExtensions.ts — the editor host
 * @coordinates-with export/createExportExtensions.ts — the export host
 * @module services/assembly/cjkLetterSpacingSetting
 */
import { useSettingsStore } from "@/stores/settingsStore";

/** On unless the setting is "0" (off, the default) or missing. */
export function isCjkLetterSpacingOn(): boolean {
  const setting = useSettingsStore.getState().appearance.cjkLetterSpacing;
  return setting !== "0" && setting !== undefined;
}
