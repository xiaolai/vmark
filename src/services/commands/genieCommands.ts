/**
 * Genie picker commands — CommandBus registration for opening/toggling the AI
 * genie picker (keybinding Phase 3, migrated from useGenieShortcuts' Cmd+Y
 * keydown handler and menu:search-genies listener).
 *
 * `genies.togglePicker` is the keyboard entry (Cmd+Y toggles); `genies.openPicker`
 * is the menu entry (Search Genies… always opens). Both derive the scope filter
 * from the current selection via `detectScope`. The picker state lives in the
 * per-window geniePickerStore, so both commands are safe per document window.
 *
 * @coordinates-with geniePickerStore.ts — opens/closes the genie picker
 * @coordinates-with keybindingDefinitions.ts — genies.togglePicker binding (aiPrompts)
 * @module services/commands/genieCommands
 */

import i18n from "@/i18n";
import { registerCommands, type CommandDefinition } from "./CommandBus";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import type { GenieScope } from "@/types/aiGenies";

/** Owner token the whole genie-command batch registers under (HMR-safe, atomic). */
const GENIE_COMMANDS_OWNER = "genie-commands";

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

/** Build the genie picker command specs (pure — no registration). */
function buildGenieCommandSpecs(): CommandDefinition[] {
  return [
    {
      id: "genies.togglePicker",
      title: () => i18n.t("commands:genies.togglePicker"),
      category: "ai",
      run: () => {
        const store = useGeniePickerStore.getState();
        if (store.isOpen) store.closePicker();
        else store.openPicker({ filterScope: detectScope() });
      },
    },
    {
      id: "genies.openPicker",
      title: () => i18n.t("commands:genies.openPicker"),
      category: "ai",
      run: () => useGeniePickerStore.getState().openPicker({ filterScope: detectScope() }),
    },
  ];
}

/**
 * Register the genie picker commands as ONE atomic batch under the owner token.
 * HMR-safe (replace-own) and partial-batch-proof: a mid-batch id collision throws
 * before anything registers, and a re-mount replaces the whole batch rather than
 * early-returning on a stale first-id guard.
 */
export function registerGenieCommands(): void {
  registerCommands(GENIE_COMMANDS_OWNER, buildGenieCommandSpecs());
}
