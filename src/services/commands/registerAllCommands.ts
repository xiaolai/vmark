/**
 * registerAllCommands — every command-group registration, in one unit (round 3).
 *
 * Purpose: the bootstrap hook used to list the `register*` calls inline; this is
 * that list, returning ONE disposer.
 *
 * The count is deliberately NOT stated here (audit #940): the header said
 * "thirteen" while the body called fifteen registrars, and a number in prose
 * beside the list it describes can only ever go stale. Nor are the non-editor
 * registrations "second-call no-ops" any more — every one of them is an OWNER
 * BATCH (`registerCommands`), which is REPLACE-OWN: a second call preflights
 * every id, removes that owner's previous batch and installs this one, so a
 * partial batch from a failed first attempt converges rather than being skipped
 * (#459/#514). Only `registerEditorCommands` returns a disposer, because its
 * batch is the one that owns resources.
 *
 * The sequence is atomic (audit #453): a registrar that throws part-way — a
 * foreign id collision, a module failing at first call — used to leave every
 * command registered before it on the bus, and the sentinel-guarded registrars
 * then saw their first command on the retry and skipped the rest, a permanently
 * partial registry. The bus is now RESTORED to the snapshot taken before the
 * batch, so the retry the bootstrap effect makes on remount starts clean.
 *
 * A snapshot, not a set of added ids: `registerCommands` replaces its owner's
 * previous batch, so a failure after that point left the failed attempt's
 * definitions in place under a fresh generation token — invisible to an id
 * diff, and no longer removable by the disposer the earlier batch handed out.
 *
 * @coordinates-with hooks/useCommandBootstrap — the composition root that calls this
 * @module services/commands/registerAllCommands
 */
import { registerExportCommands } from "./exportCommands";
import { registerMiscCommands } from "./miscCommands";
import { registerClipboardCommands } from "./clipboardCommands";
import { registerRecentFilesCommands } from "./recentFilesCommands";
import { registerRecentWorkspacesCommands } from "./recentWorkspacesCommands";
import { registerClaimCommands } from "./claimCommands";
import { registerViewCommands } from "./viewCommands";
import { registerWorkspaceCommands } from "./workspaceCommands";
import { registerFormatCommands } from "./formatCommands";
import { registerBrowserCommands } from "./browserCommands";
import { registerEditorCommands } from "./editorCommandBridge";
import { registerTabCommands } from "./tabCommands";
import { registerFileCommands } from "./fileCommands";
import { registerGenieCommands } from "./genieCommands";
import { registerWindowCommands } from "./windowCommands";
import { restoreCommandRegistry, snapshotCommandRegistry } from "./CommandBus";

/** Register every command group; returns the disposer of the editor batch. */
export function registerAllCommands(): () => void {
  const before = snapshotCommandRegistry();
  try {
    registerMiscCommands();
    registerWindowCommands();
    registerClipboardCommands();
    registerExportCommands();
    registerWorkspaceCommands();
    registerRecentFilesCommands();
    registerRecentWorkspacesCommands();
    registerViewCommands();
    registerClaimCommands();
    registerFormatCommands();
    registerBrowserCommands();
    registerTabCommands();
    registerFileCommands();
    registerGenieCommands();
    // Lift every editor ActionId into the bus so the palette can find them
    // (WI-3.4). Owner-based batch registration is HMR-safe (replace-own).
    return registerEditorCommands();
  } catch (error) {
    // Restore the snapshot exactly — definitions, owner claims and generation
    // tokens. Deleting "what this batch added" is not the inverse of what it
    // does: an owner batch REPLACES its predecessor, and an id set cannot see
    // that (audit #453, round 3).
    restoreCommandRegistry(before);
    throw error;
  }
}
