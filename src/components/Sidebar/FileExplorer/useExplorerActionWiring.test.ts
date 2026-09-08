// Audit 20260907 (#322): the explorer's action callbacks were inline in a
// 324-line component with only an a11y test over its empty state. They are a
// hook now, and this pins the routing decisions the hook makes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const ops = vi.hoisted(() => ({
  createFile: vi.fn(),
  createFolder: vi.fn(),
  renameItem: vi.fn(),
  deleteItem: vi.fn(),
  moveItem: vi.fn(),
  openFile: vi.fn(),
  openWithDefaultApp: vi.fn(),
  duplicateFile: vi.fn(),
  copyPath: vi.fn(),
  revealInFinder: vi.fn(),
}));
const createEntryAndEdit = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("./useExplorerOperations", () => ({ useExplorerOperations: () => ops }));
vi.mock("./useExplorerCreateFlow", () => ({ useExplorerCreateFlow: () => ({ createEntryAndEdit }) }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { error: toastError } }));
const openDialog = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openDialog }));
const explorerError = vi.hoisted(() => vi.fn());
vi.mock("@/utils/debug", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/debug")>()),
  fileExplorerError: explorerError,
}));
vi.mock("@/services/terminal/openTerminalHere", () => ({ openTerminalHere: vi.fn() }));

import { useExplorerActionWiring, topLevelPaths } from "./useExplorerActionWiring";

function wiring(over: Partial<Parameters<typeof useExplorerActionWiring>[0]> = {}) {
  const treeRef = { current: null };
  return renderHook(() =>
    useExplorerActionWiring({
      rootPath: "/ws",
      treeRef,
      tree: [],
      refresh: async () => {},
      contextMenu: { targetPath: null, targetIsFolder: false },
      showExtensions: true,
      ...over,
    }),
  ).result.current;
}


/** Let every already-queued microtask and timer callback run. */
const flushMicrotasks = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** The selection snapshot react-arborist hands `onDelete`; `/dir` reads as a folder. */
function nodesFor(...ids: string[]) {
  return ids.map((id) => ({ data: { id, name: id, isFolder: !id.endsWith(".md") } }));
}

beforeEach(() => {
  for (const fn of Object.values(ops)) fn.mockReset();
  createEntryAndEdit.mockReset();
  toastError.mockReset();
  openDialog.mockReset();
  openDialog.mockResolvedValue(null);
  explorerError.mockReset();
  ops.openFile.mockResolvedValue(undefined);
  ops.openWithDefaultApp.mockResolvedValue(undefined);
});

describe("useExplorerActionWiring", () => {
  // Audit R3 #646 — the open-by-type policy is reached through the two routes
  // that USE it (activation and the context menu's Open), not through a
  // returned function no consumer reads. The hook exposed it publicly and only
  // this file ever called it, which is a test-shaped API rather than one.
  it("opens a supported file in VMark and anything else with the system app", async () => {
    const w = wiring({ contextMenu: { targetPath: "/ws/notes.md", targetIsFolder: false } });
    await w.handleContextMenuAction("open");
    await flushMicrotasks();
    expect(ops.openFile).toHaveBeenCalledWith("/ws/notes.md");

    const zip = wiring({ contextMenu: { targetPath: "/ws/archive.zip", targetIsFolder: false } });
    await zip.handleContextMenuAction("open");
    await flushMicrotasks();
    expect(ops.openWithDefaultApp).toHaveBeenCalledWith("/ws/archive.zip");
  });

  it("a failed VMark open becomes a toast, not a rejection", async () => {
    ops.openFile.mockRejectedValue(new Error("boom"));
    wiring().handleActivate({ data: { id: "/ws/notes.md", name: "notes.md", isFolder: false } });
    await flushMicrotasks();
    expect(toastError).toHaveBeenCalledTimes(1);
    // Handled at the INNER boundary (the supported-file branch's own catch),
    // not by the activation handler's outer one — which is what makes it a
    // message to the user rather than a swallowed rejection.
    expect(explorerError).toHaveBeenCalledWith(
      " Failed to open file:",
      "/ws/notes.md",
      expect.any(Error),
    );
  });

  it("activation opens files and ignores folders", () => {
    const w = wiring();
    w.handleActivate({ data: { id: "/ws/dir", name: "dir", isFolder: true } });
    w.handleActivate({ data: { id: "/ws/a.md", name: "a.md", isFolder: false } });
    expect(ops.openFile).toHaveBeenCalledTimes(1);
    expect(ops.openFile).toHaveBeenCalledWith("/ws/a.md");
  });

  // Audit R2 #641 — react-arborist does not await an activation, so the
  // system-app branch (which has no try/catch of its own) rejected into
  // nothing.
  it("an activation whose open is refused is caught, not left unhandled", async () => {
    ops.openWithDefaultApp.mockRejectedValue(new Error("no default app"));
    wiring().handleActivate({ data: { id: "/ws/archive.zip", name: "archive.zip", isFolder: false } });
    await new Promise((r) => setTimeout(r, 0));
    expect(explorerError).toHaveBeenCalled();
  });

  // Audit R2 #639 — `getParentDir` answers "" at the filesystem root, and
  // `"" ?? undefined` is still "": an empty defaultPath, not "no default".
  it("asks for a move destination with no default when the file has no parent", async () => {
    await wiring({ contextMenu: { targetPath: "/notes.md", targetIsFolder: false } })
      .handleContextMenuAction("moveTo");
    expect(openDialog).toHaveBeenCalledTimes(1);
    expect(openDialog.mock.calls[0][0]).not.toHaveProperty("defaultPath");
  });

  it("defaults the move destination to the file's own folder when it has one", async () => {
    await wiring({ contextMenu: { targetPath: "/ws/dir/notes.md", targetIsFolder: false } })
      .handleContextMenuAction("moveTo");
    expect(openDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "/ws/dir" }));
  });

  it("a rename keeps the extension when the tree hides extensions", async () => {
    await wiring({ showExtensions: false }).handleRename({ id: "/ws/a.md", name: "b" });
    expect(ops.renameItem).toHaveBeenCalledWith("/ws/a.md", "b", { preserveExtension: true });
  });

  it("a drop on empty space moves into the workspace root, and nowhere without one", async () => {
    await wiring().handleMove({ dragIds: ["/ws/a.md"], parentId: null });
    expect(ops.moveItem).toHaveBeenCalledWith("/ws/a.md", "/ws");
    ops.moveItem.mockClear();
    await wiring({ rootPath: null }).handleMove({ dragIds: ["/ws/a.md"], parentId: null });
    expect(ops.moveItem).not.toHaveBeenCalled();
  });

  // Audit R2 #642 — each delete is confirmed separately, so the batch has to
  // stop at the first refusal instead of asking again for every remaining
  // selection and deleting the ones confirmed after the user said no.
  it("stops the delete batch at the first cancelled confirmation", async () => {
    ops.deleteItem.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await wiring().handleDelete({ nodes: nodesFor("/ws/a.md", "/ws/b.md", "/ws/c.md") });
    expect(ops.deleteItem.mock.calls.map((c) => c[0])).toEqual(["/ws/a.md", "/ws/b.md"]);
  });

  // Audit R2 #643 — the loop awaits a confirm dialog, a filesystem call and a
  // refresh per item, any of which can drop rows from the live tree. The
  // selection react-arborist handed over is what the user asked to delete.
  it("deletes the handler's own selection even when the tree has moved on", async () => {
    const treeRef = {
      current: { get: () => undefined },
    } as unknown as Parameters<typeof useExplorerActionWiring>[0]["treeRef"];
    ops.deleteItem.mockResolvedValue(true);
    await wiring({ treeRef }).handleDelete({ nodes: nodesFor("/ws/a.md", "/ws/dir") });
    expect(ops.deleteItem.mock.calls).toEqual([
      ["/ws/a.md", false],
      ["/ws/dir", true],
    ]);
  });

  // Audit R2 #644 — react-arborist does not await `onMove`, so nothing else
  // serializes two quick drops or catches a rejection from one.
  it("refuses a second move while one is in flight", async () => {
    let release: (() => void) | undefined;
    ops.moveItem.mockImplementationOnce(
      () => new Promise<null>((resolve) => { release = () => resolve(null); }),
    );
    const w = wiring();
    const first = w.handleMove({ dragIds: ["/ws/a.md"], parentId: "/ws/dir" });
    const second = w.handleMove({ dragIds: ["/ws/b.md"], parentId: "/ws/dir" });
    await second;
    expect(ops.moveItem).toHaveBeenCalledTimes(1);
    release?.();
    await first;
    // The lock is released, so the next drop is accepted.
    ops.moveItem.mockResolvedValue(null);
    await w.handleMove({ dragIds: ["/ws/b.md"], parentId: "/ws/dir" });
    expect(ops.moveItem).toHaveBeenCalledTimes(2);
  });

  it("a rejected move is caught, not left unhandled", async () => {
    ops.moveItem.mockRejectedValue(new Error("boom"));
    await expect(
      wiring().handleMove({ dragIds: ["/ws/a.md"], parentId: "/ws/dir" }),
    ).resolves.toBeUndefined();
  });

  // Audit R2 #645 — a folder carries its contents, so a selection holding both
  // must move only the folder.
  it("moves only the top-level paths of a selection", async () => {
    ops.moveItem.mockResolvedValue(null);
    await wiring().handleMove({
      dragIds: ["/ws/dir", "/ws/dir/child.md", "/ws/other.md"],
      parentId: "/ws/dest",
    });
    expect(ops.moveItem.mock.calls.map((c) => c[0])).toEqual(["/ws/dir", "/ws/other.md"]);
  });

  it("new file / new folder go through the create-then-rename flow with the default names", () => {
    const w = wiring();
    w.handleNewFile("/ws/sub");
    w.handleNewFolder();
    expect(createEntryAndEdit).toHaveBeenNthCalledWith(1, ops.createFile, expect.any(String), "/ws/sub");
    expect(createEntryAndEdit).toHaveBeenNthCalledWith(2, ops.createFolder, expect.any(String), undefined);
  });
});

describe("topLevelPaths", () => {
  it("keeps unrelated paths", () => {
    expect(topLevelPaths(["/ws/a.md", "/ws/b.md"])).toEqual(["/ws/a.md", "/ws/b.md"]);
  });

  it("drops a descendant of another selected path, at any depth", () => {
    expect(topLevelPaths(["/ws/dir", "/ws/dir/deep/child.md"])).toEqual(["/ws/dir"]);
  });

  it("does not treat a name PREFIX as containment", () => {
    expect(topLevelPaths(["/ws/dir", "/ws/dirother.md"])).toEqual(["/ws/dir", "/ws/dirother.md"]);
  });

  it("keeps the order of what survives", () => {
    expect(topLevelPaths(["/ws/a/x.md", "/ws/a", "/ws/b"])).toEqual(["/ws/a", "/ws/b"]);
  });

  it("is empty for an empty selection", () => {
    expect(topLevelPaths([])).toEqual([]);
  });
});

// Audit R3 #640 — `open()` answers `string | string[] | null`, and the cast
// that used to sit here asserted the union away. A folder pick is one folder;
// anything else is "nothing was picked", not a path to move a file onto.
describe("the move-destination pick is narrowed, not asserted", () => {
  it.each([
    { name: "an array result", value: ["/ws/a", "/ws/b"] },
    { name: "a cancelled pick", value: null },
  ])("does not move onto $name", async ({ value }) => {
    openDialog.mockResolvedValue(value);
    await wiring({ contextMenu: { targetPath: "/ws/notes.md", targetIsFolder: false } })
      .handleContextMenuAction("moveTo");
    expect(ops.moveItem).not.toHaveBeenCalled();
  });

  it("moves onto the folder that was picked", async () => {
    openDialog.mockResolvedValue("/ws/dest");
    await wiring({ contextMenu: { targetPath: "/ws/notes.md", targetIsFolder: false } })
      .handleContextMenuAction("moveTo");
    expect(ops.moveItem).toHaveBeenCalledWith("/ws/notes.md", "/ws/dest");
  });
});
