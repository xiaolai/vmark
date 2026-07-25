/**
 * Genie Lifecycle Hook
 *
 * Purpose: Loads genie definitions on mount, syncs them to the native menu,
 *   and handles the payload-carrying genie menu events (direct invocation and
 *   reload). The Cmd+Y picker toggle and the "Search Genies…" menu event now
 *   flow through the CommandBus / keybinding registry (genies.togglePicker /
 *   genies.openPicker) — see genieCommands.ts.
 *
 * @coordinates-with geniesStore.ts — loads genie definitions
 * @coordinates-with genieCommands.ts — picker toggle/open commands
 * @coordinates-with useGenieInvocation.ts — invokeGenie for menu:invoke-genie
 * @module hooks/useGenieShortcuts
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";
import { useShortcutsStore, prosemirrorToTauri } from "@/stores/settingsStore";
import { useGeniesStore } from "@/stores/aiStore";
import { useTabStore } from "@/stores/tabStore";
import { initSuggestionTabWatcher } from "@/stores/aiStore";
import { useGenieInvocation } from "@/hooks/useGenieInvocation";
import type { GenieDefinition, GenieMetadata } from "@/types/aiGenies";
import { genieWarn, genieError } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

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

/** Hook that loads genie definitions, syncs the native menu, and handles the payload-carrying genie menu events. */
export function useGenieShortcuts() {
  const { invokeGenie } = useGenieInvocation();

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
        genieWarn("Failed to hide genies menu:", errorMessage(error));
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
            // Derive the kind discriminator from the file extension — the
            // same rule the Rust scanner uses for GenieEntry.kind. Without
            // it, a workflow genie (.yml/.yaml — read_genie returns raw YAML
            // as `template`) would take the PROMPT path in useGenieInvocation
            // and send the YAML to the AI as a whole-document replacement.
            kind: /\.ya?ml$/i.test(geniePath) ? "workflow" : "markdown",
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
