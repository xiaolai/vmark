/**
 * registerAllCommands — every command-group registration, in one unit (round 3).
 *
 * Purpose: the bootstrap hook used to list thirteen `register*` calls inline; this
 * is that list, returning ONE disposer (the editor batch is the only registration
 * that owns resources — the others are idempotent no-ops on a second call).
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

/** Register every command group; returns the disposer of the editor batch. */
export function registerAllCommands(): () => void {
  registerMiscCommands();
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
}
