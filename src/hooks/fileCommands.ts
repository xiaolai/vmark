/**
 * File commands — CommandBus registration for save/save-as/move-to/save-all-quit/
 * new/open (keybinding Phase 3, migrated from useFileShortcuts).
 *
 * Registered from the hooks tier (like tabCommands): the save handlers live in
 * `hooks/useFileSave`, so a services/commands module could not import them. Each
 * command calls the EXACT existing handler (behavior-neutral). The keyboard
 * save/save-as route here via the registry; the menu:{id} events route here via
 * useCommandBootstrap's MenuCommandBinding list.
 *
 * @coordinates-with useFileSave.ts — save/saveAs/moveTo/saveAllQuit handlers
 * @coordinates-with services/navigation/fileOpen.ts — new/open handlers
 * @module hooks/fileCommands
 */

import { registerCommands, type CommandDefinition } from "@/services/commands/CommandBus";
import { handleSave, handleSaveAs, handleMoveTo, handleSaveAllQuit } from "@/hooks/useFileSave";
import { handleNew, handleOpen } from "@/services/navigation/fileOpen";
import i18n from "@/i18n";

/** Owner token the whole file-command batch registers under (HMR-safe, atomic). */
const FILE_COMMANDS_OWNER = "file-commands";

type Ctx = { windowLabel?: string };
const wl = (ctx: Ctx): string => ctx.windowLabel ?? "main";

/** Build the file lifecycle command specs (pure — no registration). */
function buildFileCommandSpecs(): CommandDefinition[] {
  const defs: Array<[string, (windowLabel: string) => void | Promise<void>]> = [
    ["file.save", handleSave],
    ["file.saveAs", handleSaveAs],
    ["file.moveTo", handleMoveTo],
    ["file.saveAllQuit", handleSaveAllQuit],
    ["file.new", handleNew],
    ["file.open", handleOpen],
  ];

  return defs.map(([id, handler]) => ({
    id,
    title: () => i18n.t(`commands:${id}`),
    category: "file",
    run: (_a, ctx: Ctx) => handler(wl(ctx)),
  }));
}

/**
 * Register the file lifecycle commands as ONE atomic batch under the owner token.
 * HMR-safe (replace-own) and partial-batch-proof: a mid-batch id collision throws
 * before anything registers, and a re-mount replaces the whole batch rather than
 * early-returning on a stale first-id guard.
 */
export function registerFileCommands(): void {
  registerCommands(FILE_COMMANDS_OWNER, buildFileCommandSpecs());
}
