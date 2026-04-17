import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RefObject } from "react";
import { renderHook, act } from "@testing-library/react";
import type { TreeApi } from "react-arborist";
import { useFileExplorerOpenState, __ARBORIST_ROOT_ID } from "./useFileExplorerOpenState";
import { useUIStore } from "@/stores/uiStore";
import type { FileNode as FileNodeType } from "./types";

/** Minimal TreeApi stand-in — only the surface the hook actually calls. */
interface TreeStub {
  openState: Record<string, boolean>;
  isOpen: ReturnType<typeof vi.fn>;
  openAll: ReturnType<typeof vi.fn>;
  closeAll: ReturnType<typeof vi.fn>;
}

function makeTreeStub(initial: Record<string, boolean> = {}): TreeStub {
  const openState: Record<string, boolean> = { ...initial };
  const stub: TreeStub = {
    openState,
    isOpen: vi.fn((id: string) => openState[id] ?? false),
    openAll: vi.fn(() => {
      for (const key of Object.keys(openState)) openState[key] = true;
    }),
    closeAll: vi.fn(() => {
      for (const key of Object.keys(openState)) openState[key] = false;
    }),
  };
  return stub;
}

function makeRef(tree: TreeStub | null): RefObject<TreeApi<FileNodeType> | null> {
  return { current: tree as unknown as TreeApi<FileNodeType> | null };
}

beforeEach(() => {
  useUIStore.setState({ fileExplorerOpenState: {} });
});

describe("useFileExplorerOpenState", () => {
  describe("initialOpenState", () => {
    it("snapshots the store value at mount", () => {
      useUIStore.setState({ fileExplorerOpenState: { "/a": true, "/b": false } });
      const ref = makeRef(makeTreeStub());

      const { result } = renderHook(() => useFileExplorerOpenState(ref));

      expect(result.current.initialOpenState).toEqual({ "/a": true, "/b": false });
    });

    it("does NOT update on later store changes (non-reactive by design)", () => {
      const ref = makeRef(makeTreeStub());
      const { result, rerender } = renderHook(() => useFileExplorerOpenState(ref));
      const snapshot = result.current.initialOpenState;

      act(() => {
        useUIStore.getState().setFileExplorerNodeOpen("/x", true);
      });
      rerender();

      // react-arborist reads initialOpenState once; remount is the only way to refresh.
      expect(result.current.initialOpenState).toBe(snapshot);
    });
  });

  describe("handleToggle", () => {
    it("persists an opened folder into the store", () => {
      const tree = makeTreeStub({ "/a": true });
      const ref = makeRef(tree);
      const { result } = renderHook(() => useFileExplorerOpenState(ref));

      act(() => result.current.handleToggle("/a"));

      expect(useUIStore.getState().fileExplorerOpenState).toEqual({ "/a": true });
    });

    it("persists a closed folder into the store", () => {
      useUIStore.setState({ fileExplorerOpenState: { "/a": true } });
      const tree = makeTreeStub({ "/a": false });
      const ref = makeRef(tree);
      const { result } = renderHook(() => useFileExplorerOpenState(ref));

      act(() => result.current.handleToggle("/a"));

      expect(useUIStore.getState().fileExplorerOpenState).toEqual({ "/a": false });
    });

    it("ignores Arborist's synthetic root id", () => {
      const tree = makeTreeStub({ [__ARBORIST_ROOT_ID]: true });
      const ref = makeRef(tree);
      const { result } = renderHook(() => useFileExplorerOpenState(ref));

      act(() => result.current.handleToggle(__ARBORIST_ROOT_ID));

      expect(useUIStore.getState().fileExplorerOpenState).toEqual({});
      expect(tree.isOpen).not.toHaveBeenCalled();
    });

    it("is a no-op when the tree ref is null (never clobbers persisted state)", () => {
      useUIStore.setState({ fileExplorerOpenState: { "/a": true } });
      const ref = makeRef(null);
      const { result } = renderHook(() => useFileExplorerOpenState(ref));

      act(() => result.current.handleToggle("/a"));

      // Must NOT overwrite "/a" with a guessed `false` — the ref was unavailable.
      expect(useUIStore.getState().fileExplorerOpenState).toEqual({ "/a": true });
    });
  });

  describe("collapseAll / expandAll", () => {
    it("calls closeAll on the tree and persists the resulting state once", () => {
      const tree = makeTreeStub({ "/a": true, "/b": true, "/c": true });
      const ref = makeRef(tree);
      const { result } = renderHook(() => useFileExplorerOpenState(ref));

      // Spy on the store action to count writes — bulk ops must coalesce.
      const setAllSpy = vi.spyOn(useUIStore.getState(), "setFileExplorerOpenState");

      act(() => result.current.collapseAll());

      expect(tree.closeAll).toHaveBeenCalledOnce();
      expect(setAllSpy).toHaveBeenCalledOnce();
      expect(useUIStore.getState().fileExplorerOpenState).toEqual({
        "/a": false,
        "/b": false,
        "/c": false,
      });
    });

    it("calls openAll on the tree and persists the resulting state once", () => {
      const tree = makeTreeStub({ "/a": false, "/b": false });
      const ref = makeRef(tree);
      const { result } = renderHook(() => useFileExplorerOpenState(ref));

      act(() => result.current.expandAll());

      expect(tree.openAll).toHaveBeenCalledOnce();
      expect(useUIStore.getState().fileExplorerOpenState).toEqual({
        "/a": true,
        "/b": true,
      });
    });

    it("strips the synthetic root from the persisted map", () => {
      const tree = makeTreeStub({
        [__ARBORIST_ROOT_ID]: true,
        "/a": true,
        "/b": true,
      });
      const ref = makeRef(tree);
      const { result } = renderHook(() => useFileExplorerOpenState(ref));

      act(() => result.current.expandAll());

      const saved = useUIStore.getState().fileExplorerOpenState;
      expect(saved).toEqual({ "/a": true, "/b": true });
      expect(saved).not.toHaveProperty(__ARBORIST_ROOT_ID);
    });

    it("suspends per-folder mirroring during bulk ops", () => {
      // Simulate arborist calling onToggle once per folder inside closeAll.
      const tree = makeTreeStub({ "/a": true, "/b": true });
      tree.closeAll.mockImplementation(() => {
        tree.openState["/a"] = false;
        tree.openState["/b"] = false;
        // Arborist fires onToggle synchronously — invoke our handler mid-bulk.
        result.current.handleToggle("/a");
        result.current.handleToggle("/b");
      });

      const ref = makeRef(tree);
      const { result } = renderHook(() => useFileExplorerOpenState(ref));

      const singleSetSpy = vi.spyOn(useUIStore.getState(), "setFileExplorerNodeOpen");

      act(() => result.current.collapseAll());

      // handleToggle is gated by bulkOpRef — per-folder writes must NOT fire.
      expect(singleSetSpy).not.toHaveBeenCalled();
      expect(useUIStore.getState().fileExplorerOpenState).toEqual({
        "/a": false,
        "/b": false,
      });
    });

    it("resets the bulk-op guard even if the tree call throws", () => {
      const tree = makeTreeStub({ "/a": true });
      tree.closeAll.mockImplementation(() => {
        throw new Error("boom");
      });
      const ref = makeRef(tree);
      const { result } = renderHook(() => useFileExplorerOpenState(ref));

      expect(() => act(() => result.current.collapseAll())).toThrow("boom");

      // After the throw, handleToggle must be live again.
      act(() => result.current.handleToggle("/a"));
      expect(useUIStore.getState().fileExplorerOpenState).toEqual({ "/a": true });
    });

    it("no-ops when tree ref is null", () => {
      const ref = makeRef(null);
      const { result } = renderHook(() => useFileExplorerOpenState(ref));

      act(() => result.current.collapseAll());
      act(() => result.current.expandAll());

      expect(useUIStore.getState().fileExplorerOpenState).toEqual({});
    });
  });
});
