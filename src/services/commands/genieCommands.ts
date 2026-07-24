/**
 * Genie picker commands — CommandBus registration for opening/toggling the AI
 * genie picker (keybinding Phase 3, migrated from useGenieShortcuts' Cmd+Y
 * keydown handler and menu:search-genies listener).
 *
 * `genies.togglePicker` is the keyboard entry (Cmd+Y toggles); `genies.openPicker`
 * is the menu entry (Search Genies… always opens). Both derive the scope filter
 * from the current selection via `detectScope`. The picker state lives in the
 * per-window popupStore slice, so both commands are safe per document window.
 *
 * @coordinates-with geniePickerStore.ts — opens/closes the genie picker
 * @coordinates-with keybindingDefinitions.ts — genies.togglePicker binding (aiPrompts)
 * @module services/commands/genieCommands
 */

import i18n from "@/i18n";
import { hasCommand, registerCommand } from "./CommandBus";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import type { GenieScope } from "@/types/aiGenies";

/**
 * Detect the genie scope from the current editor selection. Source mode and the
 * absence of a selection both yield `undefined` (whole-document scope); a
 * non-empty WYSIWYG selection yields `"selection"`.
 */
export function detectScope(): GenieScope | undefined {
  if (useUIStore.getState().sourceMode) return undefined;
  const editor = useEditorStore.getState().tiptap.editor;
  if (!editor) return undefined;
  return editor.state.selection.empty ? undefined : "selection";
}

/** Register the genie picker commands (idempotent, HMR-safe). */
export function registerGenieCommands(): void {
  if (hasCommand("genies.togglePicker")) return;

  registerCommand({
    id: "genies.togglePicker",
    title: () => i18n.t("commands:genies.togglePicker"),
    category: "ai",
    run: () => {
      const store = useGeniePickerStore.getState();
      if (store.isOpen) store.closePicker();
      else store.openPicker({ filterScope: detectScope() });
    },
  });

  registerCommand({
    id: "genies.openPicker",
    title: () => i18n.t("commands:genies.openPicker"),
    category: "ai",
    run: () => useGeniePickerStore.getState().openPicker({ filterScope: detectScope() }),
  });
}
