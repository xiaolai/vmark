/**
 * Genie Shortcuts Hook
 *
 * - Cmd+Y keyboard shortcut opens the genie picker
 * - Loads genies on mount and syncs to native menu
 * - Handles direct genie invocation from the Genies menu
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useShortcutsStore } from "@/stores/shortcutsStore";
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

/** Load genies from disk and refresh the native Genies menu. */
async function loadAndSyncMenu(): Promise<void> {
  await useGeniesStore.getState().loadGenies();
  await invoke("refresh_genies_menu");
}

/** Detect scope from current editor selection state. */
function detectScope(): GenieScope | undefined {
  if (useEditorStore.getState().sourceMode) return undefined;
  const editor = useTiptapEditorStore.getState().editor;
  if (!editor) return undefined;
  return editor.state.selection.empty ? undefined : "selection";
}

export function useGenieShortcuts() {
  const { invokeGenie } = useGenieInvocation();

  // Keyboard shortcut (Cmd+Y) — opens the genie picker
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;

      const aiGeniesKey = useShortcutsStore.getState().getShortcut("aiPrompts");
      if (matchesShortcutEvent(e, aiGeniesKey)) {
        e.preventDefault();
        useGeniePickerStore.getState().openPicker({ filterScope: detectScope() });
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
      console.error("[useGenieShortcuts] Failed to load genies:", e)
    );
    initSuggestionTabWatcher(useTabStore.subscribe);
    return () => {
      invoke("hide_genies_menu").catch(() => {});
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
          try {
            invokeGenie(genie);
          } catch (invokeErr) {
            console.error("[useGenieShortcuts] Failed to invoke genie:", invokeErr);
          }
        } catch (e) {
          console.error("[useGenieShortcuts] Failed to read genie:", e);
        }
      }
    );

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [invokeGenie]);

  // "Search Genies…" menu item opens the picker (same as Cmd+Y)
  useEffect(() => {
    const unlisten = listen("menu:search-genies", () => {
      useGeniePickerStore.getState().openPicker({ filterScope: detectScope() });
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  // "Reload Genies" menu item re-scans the genies folder
  useEffect(() => {
    const unlisten = listen("menu:reload-genies", () => {
      loadAndSyncMenu().catch((e) =>
        console.error("[useGenieShortcuts] Failed to reload genies:", e)
      );
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);
}
