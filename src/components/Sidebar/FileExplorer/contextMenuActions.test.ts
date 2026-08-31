// @vitest-environment node
// WI-4.2 — the file-explorer context menu's id → operation mapping.
//
// Extracted from FileExplorer.tsx when "Open Terminal Here" pushed that file
// past its size baseline. Every collaborator is injected, so no module mocks
// are needed and every guard branch is reachable without rendering the tree.
import { describe, it, expect, vi } from "vitest";
import {
  runContextMenuAction,
  HANDLED_ACTION_IDS,
  type ContextMenuActionDeps,
} from "./contextMenuActions";
import type { ContextMenuActionId } from "./ContextMenu";

/** Cast for the untyped edges the runtime guard still has to survive. */
const asId = (s: string) => s as ContextMenuActionId;

function makeDeps(overrides: Partial<ContextMenuActionDeps> = {}): ContextMenuActionDeps {
  return {
    targetPath: "/w/notes.md",
    targetIsFolder: false,
    openFileByType: vi.fn(),
    editNode: vi.fn(),
    duplicateFile: vi.fn(() => Promise.resolve()),
    pickMoveDestination: vi.fn(() => Promise.resolve("/w/dest")),
    moveItem: vi.fn(() => Promise.resolve()),
    deleteItem: vi.fn(() => Promise.resolve()),
    copyPath: vi.fn(() => Promise.resolve()),
    revealInFinder: vi.fn(() => Promise.resolve()),
    newFile: vi.fn(() => Promise.resolve()),
    newFolder: vi.fn(() => Promise.resolve()),
    openTerminalHere: vi.fn(() => ({ ok: true as const, sessionId: "term-1" })),
    notifyError: vi.fn(),
    ...overrides,
  };
}

describe("runContextMenuAction", () => {
  it("opens a file", async () => {
    const deps = makeDeps();
    await runContextMenuAction("open", deps);
    expect(deps.openFileByType).toHaveBeenCalledWith("/w/notes.md");
  });

  it("does NOT 'open' a folder", async () => {
    const deps = makeDeps({ targetPath: "/w/src", targetIsFolder: true });
    await runContextMenuAction("open", deps);
    expect(deps.openFileByType).not.toHaveBeenCalled();
  });

  it("renames via the tree's inline editor", async () => {
    const deps = makeDeps();
    await runContextMenuAction("rename", deps);
    expect(deps.editNode).toHaveBeenCalledWith("/w/notes.md");
  });

  it("moves to the picked destination", async () => {
    const deps = makeDeps();
    await runContextMenuAction("moveTo", deps);
    expect(deps.moveItem).toHaveBeenCalledWith("/w/notes.md", "/w/dest");
  });

  it("does not move when the destination picker is cancelled", async () => {
    const deps = makeDeps({ pickMoveDestination: vi.fn(() => Promise.resolve(null)) });
    await runContextMenuAction("moveTo", deps);
    expect(deps.moveItem).not.toHaveBeenCalled();
  });

  it("passes the folder flag through to delete", async () => {
    const deps = makeDeps({ targetPath: "/w/src", targetIsFolder: true });
    await runContextMenuAction("delete", deps);
    expect(deps.deleteItem).toHaveBeenCalledWith("/w/src", true);
  });

  it.each(["copyPath", "revealInFinder"] as const)("forwards %s", async (action) => {
    const deps = makeDeps();
    await runContextMenuAction(action, deps);
    expect(deps[action]).toHaveBeenCalledWith("/w/notes.md");
  });

  it.each(["newFile", "newFolder"] as const)(
    "creates via %s, passing the target as the parent",
    async (action) => {
      const deps = makeDeps({ targetPath: "/w/src", targetIsFolder: true });
      await runContextMenuAction(action, deps);
      expect(deps[action]).toHaveBeenCalledWith("/w/src");
    },
  );

  it.each(["newFile", "newFolder"] as const)(
    "%s still runs on empty space, with a null parent",
    async (action) => {
      const deps = makeDeps({ targetPath: null });
      await runContextMenuAction(action, deps);
      expect(deps[action]).toHaveBeenCalledWith(null);
    },
  );

  it("ignores an unknown action rather than throwing", async () => {
    await expect(runContextMenuAction(asId("nope"), makeDeps())).resolves.toBeUndefined();
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "ignores the inherited Object key %j instead of treating it as a handler",
    async (key) => {
      // A bare `HANDLERS[action]` lookup resolves these to truthy values off
      // Object.prototype, which would then blow up on `.requires`/`.run`.
      const deps = makeDeps();
      await expect(runContextMenuAction(asId(key), deps)).resolves.toBeUndefined();
      expect(deps.notifyError).not.toHaveBeenCalled();
    },
  );

  it.each([
    "open",
    "rename",
    "duplicate",
    "moveTo",
    "delete",
    "copyPath",
    "revealInFinder",
    "openTerminalHere",
  ])("does nothing for %s when there is no target path", async (action) => {
    const deps = makeDeps({ targetPath: null });
    await runContextMenuAction(asId(action), deps);
    expect(deps.openFileByType).not.toHaveBeenCalled();
    expect(deps.deleteItem).not.toHaveBeenCalled();
    expect(deps.openTerminalHere).not.toHaveBeenCalled();
  });

  it("contains a rejected operation instead of leaking an unhandled rejection", async () => {
    // The caller is a click handler that cannot await; an escaping rejection
    // would surface as an unhandled promise.
    const deps = makeDeps({
      deleteItem: vi.fn(() => Promise.reject(new Error("EPERM"))),
    });
    await expect(runContextMenuAction("delete", deps)).resolves.toBeUndefined();
    expect(deps.notifyError).toHaveBeenCalled();
  });

  it("contains a synchronous throw too", async () => {
    const deps = makeDeps({
      editNode: vi.fn(() => {
        throw new Error("no such node");
      }),
    });
    await expect(runContextMenuAction("rename", deps)).resolves.toBeUndefined();
    expect(deps.notifyError).toHaveBeenCalled();
  });

  describe("openTerminalHere (WI-4.2)", () => {
    it("opens a terminal in the clicked folder", async () => {
      const deps = makeDeps({ targetPath: "/w/src", targetIsFolder: true });
      await runContextMenuAction("openTerminalHere", deps);
      expect(deps.openTerminalHere).toHaveBeenCalledWith("/w/src");
    });

    it("is a no-op for a file — 'here' has no meaning for one", async () => {
      const deps = makeDeps({ targetPath: "/w/notes.md", targetIsFolder: false });
      await runContextMenuAction("openTerminalHere", deps);
      expect(deps.openTerminalHere).not.toHaveBeenCalled();
    });

    it("surfaces a toast when the session cap was hit since the menu opened", async () => {
      const deps = makeDeps({
        targetPath: "/w/src",
        targetIsFolder: true,
        openTerminalHere: vi.fn(() => ({ ok: false as const, reason: "max-sessions" as const })),
      });
      await runContextMenuAction("openTerminalHere", deps);
      expect(deps.notifyError).toHaveBeenCalledWith("statusbar:terminal.maxSessions");
    });

    it("stays quiet on success", async () => {
      const deps = makeDeps({ targetPath: "/w/src", targetIsFolder: true });
      await runContextMenuAction("openTerminalHere", deps);
      expect(deps.notifyError).not.toHaveBeenCalled();
    });
  });

  it("handles every action id the menu can emit", () => {
    // The union in ContextMenu.tsx is the contract; a menu item whose id has
    // no handler would render fine and silently do nothing.
    expect([...HANDLED_ACTION_IDS].sort()).toEqual(
      [
        "copyPath",
        "delete",
        "duplicate",
        "moveTo",
        "newFile",
        "newFolder",
        "open",
        "openTerminalHere",
        "rename",
        "revealInFinder",
      ].sort(),
    );
  });
});
