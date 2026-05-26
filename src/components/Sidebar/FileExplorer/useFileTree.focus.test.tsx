/**
 * Tests for the defensive window-focus refresh in useFileTree.
 *
 * Pinned behavior: when the OS window regains focus, the tree is re-listed
 * from disk so externally-created files appear even when the FSEvent-based
 * watcher misses the create. This is the safety net for macOS Finder
 * operations, externally-mounted volumes, and symlinked workspace paths.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

let fsChangeCallback: ((evt: { payload: unknown }) => void) | null = null;
const listenMock = vi.fn(
  async (_name: string, cb: (evt: { payload: unknown }) => void) => {
    fsChangeCallback = cb;
    return () => {
      fsChangeCallback = null;
    };
  },
);
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) =>
    (listenMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("@tauri-apps/api/path", () => ({
  basename: async (p: string) => p.split("/").pop() ?? "",
}));

let focusCallback: ((evt: { payload: boolean }) => void) | null = null;
const onFocusChangedMock = vi.fn(
  async (cb: (evt: { payload: boolean }) => void) => {
    focusCallback = cb;
    return () => {
      focusCallback = null;
    };
  },
);
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ onFocusChanged: onFocusChangedMock }),
}));

import { useFileTree } from "./useFileTree";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "list_directory_entries") return [];
    return undefined;
  });
  onFocusChangedMock.mockClear();
  focusCallback = null;
  fsChangeCallback = null;
});

describe("useFileTree — window-focus refresh", () => {
  it("registers a focus listener when a rootPath is provided", async () => {
    renderHook(() => useFileTree("/Users/me/notes"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onFocusChangedMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT register the focus listener when rootPath is null", async () => {
    renderHook(() => useFileTree(null));
    await Promise.resolve();

    expect(onFocusChangedMock).not.toHaveBeenCalled();
  });

  it("re-lists the directory when the window regains focus", async () => {
    renderHook(() => useFileTree("/Users/me/notes"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const initialListCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "list_directory_entries",
    ).length;
    expect(initialListCalls).toBeGreaterThanOrEqual(1);
    expect(focusCallback).toBeTypeOf("function");

    focusCallback!({ payload: true });
    await Promise.resolve();
    await Promise.resolve();

    const afterFocusCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "list_directory_entries",
    ).length;
    expect(afterFocusCalls).toBeGreaterThan(initialListCalls);
  });

  it("ignores blur (focused=false) events", async () => {
    renderHook(() => useFileTree("/Users/me/notes"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const initialListCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "list_directory_entries",
    ).length;

    focusCallback!({ payload: false });
    await Promise.resolve();

    const afterBlurCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "list_directory_entries",
    ).length;
    expect(afterBlurCalls).toBe(initialListCalls);
  });

  it("immediately unlistens when the component unmounts before onFocusChanged resolves", async () => {
    const lateUnlisten = vi.fn();
    let resolveLate: ((u: () => void) => void) | null = null;
    onFocusChangedMock.mockImplementationOnce(
      () =>
        new Promise<() => void>((resolve) => {
          resolveLate = resolve;
        }),
    );

    const { unmount } = renderHook(() => useFileTree("/Users/me/notes"));
    unmount();
    // Resolve AFTER unmount — the cleanup must run the unlistener.
    resolveLate!(lateUnlisten);
    await Promise.resolve();
    await Promise.resolve();

    expect(lateUnlisten).toHaveBeenCalledTimes(1);
  });

  it("logs without throwing when onFocusChanged rejects", async () => {
    onFocusChangedMock.mockImplementationOnce(() =>
      Promise.reject("focus subscription failed"),
    );

    expect(() => renderHook(() => useFileTree("/Users/me/notes"))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("logs without throwing when onFocusChanged rejects with an Error instance", async () => {
    onFocusChangedMock.mockImplementationOnce(() =>
      Promise.reject(new Error("focus subscription failed")),
    );

    expect(() => renderHook(() => useFileTree("/Users/me/notes"))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe("useFileTree — fs:changed listener", () => {
  it("re-lists when an fs:changed event matches the watched root", async () => {
    renderHook(() => useFileTree("/root", { watchId: "main" }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fsChangeCallback).toBeTypeOf("function");
    const initial = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "list_directory_entries",
    ).length;

    fsChangeCallback!({
      payload: {
        watchId: "main",
        rootPath: "/root",
        paths: ["/root/new.md"],
        kind: "create",
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    const after = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "list_directory_entries",
    ).length;
    expect(after).toBeGreaterThan(initial);
  });

  it("logs without throwing when the fs:changed listen subscription rejects with an Error", async () => {
    listenMock.mockImplementationOnce(async () => {
      throw new Error("listen rejected");
    });
    expect(() => renderHook(() => useFileTree("/root"))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("logs without throwing when the fs:changed listen subscription rejects with a non-Error", async () => {
    listenMock.mockImplementationOnce(async () => {
      throw "rejected as string";
    });
    expect(() => renderHook(() => useFileTree("/root"))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("ignores fs:changed from a different watchId", async () => {
    renderHook(() => useFileTree("/root", { watchId: "main" }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const initial = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "list_directory_entries",
    ).length;

    fsChangeCallback!({
      payload: {
        watchId: "doc-1",
        rootPath: "/other",
        paths: ["/other/new.md"],
        kind: "create",
      },
    });
    await Promise.resolve();

    const after = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "list_directory_entries",
    ).length;
    expect(after).toBe(initial);
  });
});

describe("useFileTree — directory listing", () => {
  it("lists files and folders, filtering markdown by default", async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "list_directory_entries") {
        const path = (args as { path: string }).path;
        if (path === "/root") {
          return [
            { name: "notes.md", path: "/root/notes.md", isDirectory: false },
            { name: "image.png", path: "/root/image.png", isDirectory: false },
            { name: "drafts", path: "/root/drafts", isDirectory: true },
          ];
        }
        if (path === "/root/drafts") {
          return [
            { name: "wip.md", path: "/root/drafts/wip.md", isDirectory: false },
          ];
        }
      }
      return undefined;
    });

    const { result } = renderHook(() => useFileTree("/root"));
    await waitFor(() => {
      expect(result.current.tree.length).toBeGreaterThan(0);
    });

    const names = result.current.tree.map((n) => n.name);
    expect(names).toContain("drafts");
    expect(names).toContain("notes");
    // image.png filtered out (no showAllFiles)
    expect(names).not.toContain("image.png");
  });

  it("sorts files before folders correctly regardless of input order", async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "list_directory_entries") {
        const path = (args as { path: string }).path;
        if (path === "/sorted") {
          // Files first in the raw input — sort must still put folder first.
          return [
            { name: "a.md", path: "/sorted/a.md", isDirectory: false },
            { name: "folder", path: "/sorted/folder", isDirectory: true },
            { name: "b.md", path: "/sorted/b.md", isDirectory: false },
          ];
        }
        if (path === "/sorted/folder") return [];
      }
      return undefined;
    });

    const { result } = renderHook(() => useFileTree("/sorted"));
    await waitFor(() => {
      expect(result.current.tree.length).toBe(3);
    });
    expect(result.current.tree[0].isFolder).toBe(true);
    expect(result.current.tree[1].isFolder).toBe(false);
    expect(result.current.tree[2].isFolder).toBe(false);
  });

  it("returns an empty tree without throwing when listing fails", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_directory_entries") {
        throw new Error("EACCES");
      }
      return undefined;
    });

    const { result } = renderHook(() => useFileTree("/forbidden"));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.tree).toEqual([]);
  });

  it("includes .vmark files when the workflow engine flag is enabled", async () => {
    const { useSettingsStore } = await import("@/stores/settingsStore");
    const prev = useSettingsStore.getState().advanced.workflowEngine;
    useSettingsStore.setState((s) => ({
      advanced: { ...s.advanced, workflowEngine: true },
    }));
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "list_directory_entries") {
        const path = (args as { path: string }).path;
        if (path === "/wf") {
          return [
            { name: "flow.vmark.yml", path: "/wf/flow.vmark.yml", isDirectory: false },
          ];
        }
      }
      return undefined;
    });

    const { result } = renderHook(() => useFileTree("/wf"));
    await waitFor(() => {
      expect(result.current.tree.length).toBeGreaterThan(0);
    });

    useSettingsStore.setState((s) => ({
      advanced: { ...s.advanced, workflowEngine: prev },
    }));
  });

  it("includes all file types when showAllFiles is true", async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "list_directory_entries") {
        const path = (args as { path: string }).path;
        if (path === "/root") {
          return [
            { name: "notes.md", path: "/root/notes.md", isDirectory: false },
            { name: "image.png", path: "/root/image.png", isDirectory: false },
          ];
        }
      }
      return undefined;
    });

    const { result } = renderHook(() => useFileTree("/root", { showAllFiles: true }));
    await waitFor(() => {
      expect(result.current.tree.length).toBeGreaterThan(1);
    });

    const names = result.current.tree.map((n) => n.name);
    expect(names).toContain("image.png");
    expect(names).toContain("notes");
  });
});
