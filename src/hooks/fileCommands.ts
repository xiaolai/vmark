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

import { registerCommand, hasCommand } from "@/services/commands/CommandBus";
import { handleSave, handleSaveAs, handleMoveTo, handleSaveAllQuit } from "@/hooks/useFileSave";
import { handleNew, handleOpen } from "@/services/navigation/fileOpen";
import i18n from "@/i18n";

type Ctx = { windowLabel?: string };
const wl = (ctx: Ctx): string => ctx.windowLabel ?? "main";

/** Register the file lifecycle commands (idempotent, HMR-safe). */
export function registerFileCommands(): void {
  if (hasCommand("file.save")) return;

  const defs: Array<[string, (windowLabel: string) => void | Promise<void>]> = [
    ["file.save", handleSave],
    ["file.saveAs", handleSaveAs],
    ["file.moveTo", handleMoveTo],
    ["file.saveAllQuit", handleSaveAllQuit],
    ["file.new", handleNew],
    ["file.open", handleOpen],
  ];

  for (const [id, handler] of defs) {
    registerCommand({
      id,
      title: () => i18n.t(`commands:${id}`),
      category: "file",
      run: (_a, ctx: Ctx) => handler(wl(ctx)),
    });
  }
}
