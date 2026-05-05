/**
 * Genie Shortcuts Hook
 *
 * Purpose: Keyboard shortcut (Cmd+Y) to toggle the genie picker, loads
 *   genie definitions on mount, syncs to native menu, and handles
 *   direct genie invocation from the Genies menu.
 *
 * @coordinates-with geniePickerStore.ts — opens/closes the genie picker
 * @coordinates-with geniesStore.ts — loads genie definitions
 * @module hooks/useGenieShortcuts
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";
import { useShortcutsStore, prosemirrorToTauri } from "@/stores/shortcutsStore";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { useGeniesStore } from "@/stores/geniesStore";
import { useTabStore } from "@/stores/tabStore";
import { useTiptapEditorStore } from "@/stores/tiptapEditorStore";
import { useEditorStore } from "@/stores/editorStore";
import { initSuggestionTabWatcher } from "@/stores/aiSuggestionStore";
import { useGenieInvocation } from "@/hooks/useGenieInvocation";
import { matchesShortcutEvent } from "@/utils/shortcutMatch";
import { isImeKeyEvent } from "@/utils/imeGuard";
import type { GenieDefinition, GenieMetadata, GenieScope } from "@/types/aiGenies";
import { genieWarn, genieError } from "@/utils/debug";

/** Build menu-id → accelerator map for the genies menu. */
export function getMenuShortcuts(): Record<string, string> | null {
  try {
    const all = useShortcutsStore.getState().getAllShortcuts();
    const key = all["aiPrompts"];
    // null/undefined = not in store, use backend default; empty = explicitly unbound
    if (key == null) return null;
    return { "search-genies": prosemirrorToTauri(key) };
  } catch {
    return null;
  }
}

/** Load genies from disk and refresh the native Genies menu. */
async function loadAndSyncMenu(): Promise<void> {
  await useGeniesStore.getState().loadGenies();
  const shortcuts = getMenuShortcuts();
  await invoke("refresh_genies_menu", { shortcuts });
}

/** Detect scope from current editor selection state. */
export function detectScope(): GenieScope | undefined {
  if (useEditorStore.getState().sourceMode) return undefined;
  const editor = useTiptapEditorStore.getState().editor;
  if (!editor) return undefined;
  return editor.state.selection.empty ? undefined : "selection";
}

/** Hook that manages the AI Genie keyboard shortcut, loads genie definitions, and handles direct genie invocation from the menu. */
export function useGenieShortcuts() {
  const { invokeGenie } = useGenieInvocation();

  // Keyboard shortcut (Cmd+Y) — toggles the genie picker
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isImeKeyEvent(e)) return;

      const aiGeniesKey = useShortcutsStore.getState().getShortcut("aiPrompts");
      if (matchesShortcutEvent(e, aiGeniesKey)) {
        e.preventDefault();
        const store = useGeniePickerStore.getState();
        if (store.isOpen) {
          store.closePicker();
        } else {
          store.openPicker({ filterScope: detectScope() });
        }
      }
    };

    // Must fire before INPUT/TEXTAREA guard (global shortcut)
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Load genies + sync menu on mount; init tab watcher.
  // Env API keys are loaded by aiProviderStore's onRehydrateStorage.
  // On unmount (feature disabled), remove the Genies submenu from the native menu
  useEffect(() => {
    loadAndSyncMenu().catch((e) =>
      genieError("Failed to load genies:", e)
    );
    initSuggestionTabWatcher(useTabStore.subscribe);
    return () => {
      invoke("hide_genies_menu").catch((error: unknown) => {
        genieWarn("Failed to hide genies menu:", error instanceof Error ? error.message : String(error));
      });
    };
  }, []);

  // Direct genie invocation from Genies menu — reads from disk directly
  // to avoid name-collision issues with the deduplicated store.
  useEffect(() => {
    const unlisten = listen<[string, string]>(
      "menu:invoke-genie",
      async (event) => {
        const [geniePath] = event.payload;
        try {
          const result = await invoke<{ metadata: GenieMetadata; template: string }>(
            "read_genie",
            { path: geniePath },
          );
          const genie: GenieDefinition = {
            metadata: result.metadata,
            template: result.template,
            filePath: geniePath,
            source: "global",
          };
          void invokeGenie(genie).catch((invokeErr: unknown) => {
            genieError("Failed to invoke genie:", invokeErr);
          });
        } catch (e) {
          genieError("Failed to read genie:", e);
        }
      }
    );

    return () => safeUnlistenAsync(unlisten);
  }, [invokeGenie]);

  // "Search Genies…" menu item opens the picker (same as Cmd+Y)
  useEffect(() => {
    const unlisten = listen("menu:search-genies", () => {
      useGeniePickerStore.getState().openPicker({ filterScope: detectScope() });
    });
    return () => safeUnlistenAsync(unlisten);
  }, []);

  // "Reload Genies" menu item re-scans the genies folder
  useEffect(() => {
    const unlisten = listen("menu:reload-genies", () => {
      loadAndSyncMenu().catch((e) =>
        genieError("Failed to reload genies:", e)
      );
    });
    return () => safeUnlistenAsync(unlisten);
  }, []);
}
