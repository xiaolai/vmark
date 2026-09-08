/**
 * Explorer commands — the file-tree visibility toggles, split out of
 * viewCommands.ts for the file-size gate. Registered by
 * `registerViewCommands()`, so callers and tests keep a single entry point
 * (the same arrangement as paneCommands.ts and lintCommands.ts).
 */

import { registerCommands, type CommandDefinition } from "./CommandBus";
import { toggleShowHiddenFiles, toggleShowAllFiles } from "@/services/workspaces/workspaceConfig";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import i18n from "@/i18n";

/** Owner token this batch registers under (HMR-safe, atomic — see viewCommands). */
const EXPLORER_COMMANDS_OWNER = "explorer-commands";

/**
 * Whether a workspace is open enough for its config to be writable (audit #944).
 *
 * `updateWorkspaceConfig` refuses without all three and returns `false` with no
 * message — deliberately, because a write that FAILED already toasts there.
 * What it cannot report is "there is nothing to configure": both toggles then
 * did nothing at all, silently, while still listed in the palette and still
 * executable from a keybinding. A `when` answers the click instead of leaving
 * it unanswered — the palette hides them and the dispatch is refused.
 */
function hasWorkspaceConfig(): boolean {
  const { isWorkspaceMode, rootPath, config } = useWorkspaceStore.getState();
  return isWorkspaceMode && Boolean(rootPath) && config !== null;
}

/** Build the explorer command specs (pure — no registration). */
function buildExplorerCommandSpecs(): CommandDefinition[] {
  return [
    {
      id: "explorer.toggleHiddenFiles",
      title: () => i18n.t("commands:explorer.toggleHiddenFiles"),
      category: "view",
      when: hasWorkspaceConfig,
      run: async () => {
        await toggleShowHiddenFiles();
      },
    },
    {
      id: "explorer.toggleAllFiles",
      title: () => i18n.t("commands:explorer.toggleAllFiles"),
      category: "view",
      when: hasWorkspaceConfig,
      run: async () => {
        await toggleShowAllFiles();
      },
    },
  ];
}

/** Register the explorer command set as one owner batch (audit #459). */
export function registerExplorerCommands(): void {
  registerCommands(EXPLORER_COMMANDS_OWNER, buildExplorerCommandSpecs());
}
