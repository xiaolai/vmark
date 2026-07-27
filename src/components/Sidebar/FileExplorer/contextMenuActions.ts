/**
 * contextMenuActions
 *
 * Purpose: The file-explorer context menu's action dispatcher — the mapping
 * from a menu-item id to a filesystem or app operation. Extracted from
 * FileExplorer.tsx, which had grown past its size baseline; that file now owns
 * layout and wiring, and this one owns "what each menu item does".
 *
 * Key decisions:
 *   - **Every collaborator is injected**, including the terminal service and
 *     the failure notifier. Reaching for a module-level import would make the
 *     "pure dispatch" claim false and force module mocks in tests.
 *   - The mapping is a **handler table keyed by a typed id**, not a `switch`.
 *     Each handler declares what target it needs (`file`, `folder`, `any`,
 *     `optional`), so the presence/type guard is written once instead of
 *     repeated in every branch. The id is a typed union shared with the menu,
 *     so an item with no handler fails to compile rather than shipping as a
 *     menu entry that silently does nothing.
 *   - Rejections are contained here. The caller is a click handler that cannot
 *     await, so an escaping rejection would become an unhandled promise.
 *
 * @coordinates-with FileExplorer.tsx — sole caller, supplies the deps
 * @coordinates-with ContextMenu.tsx — owns the ContextMenuActionId union
 * @coordinates-with services/terminal/openTerminalHere.ts — "Open Terminal Here" (WI-4.2)
 * @module components/Sidebar/FileExplorer/contextMenuActions
 */
import type { ContextMenuActionId } from "./ContextMenu";
import type { OpenTerminalHereResult } from "@/services/terminal/openTerminalHere";

/** Everything the dispatcher needs from the explorer and its services. */
export interface ContextMenuActionDeps {
  /* Async operations are typed `Promise<unknown>`: the explorer's helpers
     return their own results (a created path, a moved path), and the
     dispatcher only awaits them. */
  targetPath: string | null;
  targetIsFolder: boolean;
  openFileByType: (path: string) => void;
  /** Put the tree row into inline-rename mode. */
  editNode: (path: string) => void;
  duplicateFile: (path: string) => Promise<unknown>;
  /** Ask the user for a destination folder; null when they cancel. */
  pickMoveDestination: (path: string) => Promise<string | null>;
  moveItem: (path: string, dest: string) => Promise<unknown>;
  deleteItem: (path: string, isFolder: boolean) => Promise<unknown>;
  copyPath: (path: string) => Promise<unknown>;
  revealInFinder: (path: string) => Promise<unknown>;
  newFile: (parentPath?: string | null) => Promise<unknown>;
  newFolder: (parentPath?: string | null) => Promise<unknown>;
  /** Open a terminal session in a directory (WI-4.2). */
  openTerminalHere: (dirPath: string) => OpenTerminalHereResult;
  /** Surface a failure to the user. */
  notifyError: (messageKey: string) => void;
}

/** What a handler needs from the click target before it can run. */
type TargetRequirement = "file" | "folder" | "any" | "optional";

interface Handler {
  requires: TargetRequirement;
  run: (deps: ContextMenuActionDeps, targetPath: string) => void | Promise<unknown>;
}

/**
 * The action table. `requires` is checked once by the dispatcher, so a handler
 * body only ever contains the operation itself.
 */
const HANDLERS: Record<ContextMenuActionId, Handler> = {
  open: { requires: "file", run: (d, path) => d.openFileByType(path) },
  rename: { requires: "any", run: (d, path) => d.editNode(path) },
  duplicate: { requires: "file", run: (d, path) => d.duplicateFile(path) },
  moveTo: {
    requires: "file",
    run: async (d, path) => {
      const dest = await d.pickMoveDestination(path);
      if (dest) await d.moveItem(path, dest);
    },
  },
  delete: { requires: "any", run: (d, path) => d.deleteItem(path, d.targetIsFolder) },
  copyPath: { requires: "any", run: (d, path) => d.copyPath(path) },
  revealInFinder: { requires: "any", run: (d, path) => d.revealInFinder(path) },
  newFile: { requires: "optional", run: (d, path) => d.newFile(path || null) },
  newFolder: { requires: "optional", run: (d, path) => d.newFolder(path || null) },
  // Folders only — "here" has no meaning for a file, and offering it on one
  // would just open the parent, which is not what was clicked (WI-4.2).
  openTerminalHere: {
    requires: "folder",
    run: (d, path) => {
      const result = d.openTerminalHere(path);
      // The menu already disables the item at the cap; this covers the race
      // where another session was created while the menu was open.
      if (!result.ok && result.reason === "max-sessions") {
        d.notifyError("statusbar:terminal.maxSessions");
      }
    },
  },
};

/** True when the click target satisfies what the handler needs. */
function targetSatisfies(
  requirement: TargetRequirement,
  targetPath: string | null,
  targetIsFolder: boolean,
): boolean {
  if (requirement === "optional") return true;
  if (!targetPath) return false;
  if (requirement === "file") return !targetIsFolder;
  if (requirement === "folder") return targetIsFolder;
  return true;
}

/**
 * Run the operation behind a context-menu item id. Never rejects: the caller
 * is a click handler that cannot await, so a failing operation is reported
 * through `notifyError` rather than escaping as an unhandled rejection.
 */
export async function runContextMenuAction(
  action: ContextMenuActionId,
  deps: ContextMenuActionDeps,
): Promise<void> {
  // The parameter is typed, so an id the menu can emit always has a handler.
  // The runtime check remains for the untyped edges (a hand-dispatched string,
  // a future JS caller) and uses `Object.hasOwn` rather than a bare lookup:
  // an inherited key like "constructor" would otherwise resolve to a truthy
  // non-handler and blow up below.
  if (!Object.hasOwn(HANDLERS, action)) return;
  const handler = HANDLERS[action];
  if (!targetSatisfies(handler.requires, deps.targetPath, deps.targetIsFolder)) return;

  try {
    await handler.run(deps, deps.targetPath ?? "");
  } catch {
    // The individual operations already toast their own specific failures;
    // this is the backstop that keeps a rejection out of the event loop.
    deps.notifyError("dialog:toast.operationFailed");
  }
}

/** The ids this module knows how to run — used to keep the menu honest. */
export const HANDLED_ACTION_IDS = Object.keys(HANDLERS) as ContextMenuActionId[];
