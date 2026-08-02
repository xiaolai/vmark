/**
 * Purpose: map the user's markdown settings onto what the paste and copy
 * plugins accept.
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
import type { MarkdownPasteMode } from "@/plugins/markdownPaste/tiptap";
import type { CopyFormat } from "@/plugins/markdownCopy/tiptap";
import { useSettingsStore } from "@/stores/settingsStore";

/** The live paste settings, translated for the plugins. */
export function currentPasteSettings(): PasteSettings {
  const markdown = useSettingsStore.getState().markdown;
  return {
    pasteMode: markdown.pasteMode ?? "smart",
    preserveLineBreaks: markdown.preserveLineBreaks ?? false,
  };
}

/** How pasted markdown should be interpreted in WYSIWYG. */
export function currentMarkdownPasteMode(): MarkdownPasteMode {
  return useSettingsStore.getState().markdown.pasteMarkdownInWysiwyg ?? "auto";
}

/** Whether soft breaks survive a paste. */
export function currentPreserveLineBreaks(): boolean {
  return useSettingsStore.getState().markdown.preserveLineBreaks ?? false;
}

/** How copied content is placed on the clipboard. */
function currentCopyFormat(): CopyFormat {
  return useSettingsStore.getState().markdown.copyFormat ?? "default";
}

/** Whether selecting text copies it. */
function currentCopyOnSelect(): boolean {
  return useSettingsStore.getState().markdown.copyOnSelect ?? false;
}

/** Options binding markdown paste to the settings store. */
export const markdownPasteHostOptions = {
  getMode: currentMarkdownPasteMode,
  getPreserveLineBreaks: currentPreserveLineBreaks,
};

/** Options binding markdown copy to the settings store. */
export const copyHostOptions = {
  getCopyFormat: currentCopyFormat,
  getCopyOnSelect: currentCopyOnSelect,
};
