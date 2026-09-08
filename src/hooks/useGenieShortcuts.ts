/**
 * Genie Lifecycle Hook
 *
 * Purpose: Loads genie definitions on mount, syncs them to the native menu,
 *   and handles the payload-carrying genie menu events (direct invocation and
 *   reload). The Cmd+Y picker toggle and the "Search Genies…" menu event now
 *   flow through the CommandBus / keybinding registry (genies.togglePicker /
 *   genies.openPicker) — see genieCommands.ts.
 *
 * Every async step here is UNMOUNT-AWARE (audit #736). The cleanup hides the
 * native Genies submenu, and a menu refresh still in flight when it ran used to
 * land afterwards and put the submenu back — for a feature the user had just
 * switched off. Loading genies reads from disk, so that window is real.
 *
 * Residual, stated rather than hidden: a REMOUNT still issues its refresh with
 * the old mount's hide already on the wire, and nothing on this side orders two
 * IPC commands against each other. Closing that needs a sequence number the
 * Rust menu code honours, not a frontend change.
 *
 * @coordinates-with stores/aiStore/genies.ts — loads genie definitions
 * @coordinates-with genieCommands.ts — picker toggle/open commands
 * @coordinates-with useGenieInvocation.ts — invokeGenie for menu:invoke-genie
 * @module hooks/useGenieShortcuts
 */

import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";
import { useShortcutsStore, prosemirrorToTauri } from "@/stores/settingsStore";
import { useGeniesStore } from "@/stores/aiStore";
import { useTabStore } from "@/stores/tabStore";
import { initSuggestionTabWatcher } from "@/stores/aiStore";
import { useGenieInvocation } from "@/hooks/useGenieInvocation";
import type { GenieDefinition, GenieMetadata } from "@/types/aiGenies";
import { genieWarn, genieError } from "@/utils/debug";
import { commandErrorMessage } from "@/services/commands/commandError";
import { voidAsync } from "@/utils/voidAsync";

/** Build menu-id → accelerator map for the genies menu. */
export function getMenuShortcuts(): Record<string, string> | null {
  try {
    const all = useShortcutsStore.getState().getAllShortcuts();
    const key = all["aiPrompts"];
    // null/undefined = not in store, use backend default; empty = explicitly unbound
    if (key == null) return null;
    return { "search-genies": prosemirrorToTauri(key) };
  } catch (error) {
    // Same VERDICT as an absent binding — the backend default is the only safe
    // fallback — but not the same EVENT (audit #734). A store read or a key
    // conversion that throws is a defect, and swallowing it silently made a
    // shortcut quietly revert to the default with nothing anywhere to say why.
    genieWarn("Could not derive the genies menu shortcut; using the backend default:", error);
    return null;
  }
}

/**
 * Load genies from disk and refresh the native Genies menu.
 *
 * `isDisposed` is checked after the disk read (audit #736): the hook's cleanup
 * hides the submenu, and a refresh that resolves after it would show the menu
 * again for an unmounted feature.
 */
async function loadAndSyncMenu(isDisposed: () => boolean = () => false): Promise<void> {
  await useGeniesStore.getState().loadGenies();
  if (isDisposed()) return;
  const shortcuts = getMenuShortcuts();
  await invoke("refresh_genies_menu", { shortcuts });
}

/**
 * Handle a listener registration's own failure, at the moment it fails (audit
 * #738), and hand back a promise that always resolves — so the cleanup path
 * has exactly one shape whether or not the listener was ever installed.
 */
function registerOrWarn(
  registration: Promise<UnlistenFn>,
  event: string,
): Promise<UnlistenFn> {
  return registration.catch((error: unknown) => {
    genieWarn(`Failed to listen for ${event}:`, error);
    return () => {};
  });
}

/** Hook that loads genie definitions, syncs the native menu, and handles the payload-carrying genie menu events. */
export function useGenieShortcuts() {
  const { invokeGenie } = useGenieInvocation();

  // Load genies + sync menu on mount; init tab watcher.
  // Env API keys are loaded by aiProviderStore's onRehydrateStorage.
  // On unmount (feature disabled), remove the Genies submenu from the native menu
  useEffect(() => {
    let disposed = false;
    loadAndSyncMenu(() => disposed).catch((e) =>
      genieError("Failed to load genies:", e)
    );
    initSuggestionTabWatcher(useTabStore.subscribe);
    return () => {
      disposed = true;
      invoke("hide_genies_menu").catch((error: unknown) => {
        genieWarn("Failed to hide genies menu:", commandErrorMessage(error));
      });
    };
  }, []);

  // Direct genie invocation from Genies menu — reads from disk directly
  // to avoid name-collision issues with the deduplicated store.
  useEffect(() => {
    // The registration's OWN rejection handler (audit #738). `listen()` returns
    // a promise, and until this hook unmounts nothing else looks at it — so a
    // failed registration was an unhandled rejection at mount, and the cleanup
    // path (`safeUnlistenAsync`) only ever saw it much later, if at all. The
    // handled promise is what cleanup then gets, and its no-op unlisten keeps
    // that path uniform.
    const unlisten = registerOrWarn(listen<[string, string]>(
      "menu:invoke-genie",
      voidAsync(async (event) => {
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
      }, (err) => genieWarn("Genie shortcut handler failed:", err))
    ), "menu:invoke-genie");

    return () => safeUnlistenAsync(unlisten);
  }, [invokeGenie]);

  // "Reload Genies" menu item re-scans the genies folder
  useEffect(() => {
    let disposed = false;
    const unlisten = registerOrWarn(
      listen("menu:reload-genies", () => {
        loadAndSyncMenu(() => disposed).catch((e) =>
          genieError("Failed to reload genies:", e)
        );
      }),
      "menu:reload-genies",
    );
    return () => {
      disposed = true;
      safeUnlistenAsync(unlisten);
    };
  }, []);
}
