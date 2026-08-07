/**
 * The create → refresh → rename cycle, which had no test at all.
 *
 * Both defects below need an in-flight create to outlive something: a
 * workspace switch, or a second create. A fixed-timer version of this flow
 * shipped for months because nothing exercised either.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { TreeApi } from "react-arborist";
import { useExplorerCreateFlow } from "./useExplorerCreateFlow";
import type { FileNode } from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

/** A tree API stub: no selection, and `get` finds nothing so no rename fires. */
function treeStub() {
  return {
    current: { selectedNodes: [], get: () => null },
  } as unknown as React.RefObject<TreeApi<FileNode> | null>;
}

describe("useExplorerCreateFlow", () => {
  it("abandons a create whose workspace closed while it was in flight", async () => {
    const create = vi.fn().mockReturnValue(deferred<string | null>().promise);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const pending = deferred<string | null>();
    create.mockReturnValue(pending.promise);

    const { result, rerender } = renderHook(
      ({ root }: { root: string | null }) =>
        useExplorerCreateFlow({ rootPath: root, refresh, treeRef: treeStub(), tree: [] }),
      { initialProps: { root: "/one" as string | null } },
    );

    let started!: Promise<void>;
    act(() => {
      started = result.current.createEntryAndEdit(create, "Untitled.md");
    });

    // The user switches workspaces before the file finishes being created.
    rerender({ root: "/two" });
    await act(async () => {
      pending.resolve("/one/Untitled.md");
      await started;
    });

    // The captured `refresh` belongs to the workspace we left; running it would
    // load that tree into the workspace now on screen.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes normally when the workspace has not changed", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue("/one/Untitled.md");

    const { result } = renderHook(() =>
      useExplorerCreateFlow({ rootPath: "/one", refresh, treeRef: treeStub(), tree: [] }),
    );

    await act(async () => {
      await result.current.createEntryAndEdit(create, "Untitled.md");
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("runs one create at a time across the whole cycle", async () => {
    // The guard in useExplorerOperations covers only the filesystem call, so a
    // second create starting while the first awaited its refresh overwrote the
    // single pending-edit slot and the first file never entered rename mode.
    const first = deferred<string | null>();
    const create = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("/one/b.md");
    const refresh = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useExplorerCreateFlow({ rootPath: "/one", refresh, treeRef: treeStub(), tree: [] }),
    );

    let firstCall!: Promise<void>;
    act(() => {
      firstCall = result.current.createEntryAndEdit(create, "a.md");
    });
    await act(async () => {
      await result.current.createEntryAndEdit(create, "b.md");
    });

    expect(create).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve("/one/a.md");
      await firstCall;
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("does not open rename on a node from the workspace we left", async () => {
    const edit = vi.fn();
    // The tree API answers for ANY id — as a stale tree would, if the pending
    // path were still considered live after a switch.
    const treeRef = {
      current: { selectedNodes: [], get: () => ({ edit }) },
    } as unknown as React.RefObject<TreeApi<FileNode> | null>;
    const create = vi.fn().mockResolvedValue("/one/a.md");

    const { result, rerender } = renderHook(
      ({ root, tree }: { root: string | null; tree: FileNode[] }) =>
        useExplorerCreateFlow({ rootPath: root, refresh: vi.fn().mockResolvedValue(undefined), treeRef, tree }),
      { initialProps: { root: "/one" as string | null, tree: [] as FileNode[] } },
    );

    await act(async () => {
      await result.current.createEntryAndEdit(create, "a.md");
    });
    edit.mockClear();

    // Now the user is in another workspace and its tree arrives.
    rerender({ root: "/two", tree: [{ id: "/two/x.md", name: "x.md", isFolder: false }] });

    expect(edit).not.toHaveBeenCalled();
  });

  it("does nothing without a workspace", async () => {
    const create = vi.fn();
    const { result } = renderHook(() =>
      useExplorerCreateFlow({ rootPath: null, refresh: vi.fn(), treeRef: treeStub(), tree: [] }),
    );

    await act(async () => {
      await result.current.createEntryAndEdit(create, "x.md");
    });

    expect(create).not.toHaveBeenCalled();
  });
});
