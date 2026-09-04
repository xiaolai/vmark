/**
 * Tests for the defensive window-focus refresh in useFileTree.
 *
 * Pinned behavior: when the OS window regains focus, the tree is re-listed
 * from disk so externally-created files appear even when the FSEvent-based
 * watcher misses the create. This is the safety net for macOS Finder
 * operations, externally-mounted volumes, and symlinked workspace paths.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

let wsEventCallback: ((events: unknown[]) => void) | null = null;
const subscribeMock = vi.fn((_label: string, cb: (events: unknown[]) => void) => {
  wsEventCallback = cb;
  return () => {
    wsEventCallback = null;
  };
});
vi.mock("@/services/workspaceEvents/subscribeWorkspaceEvents", () => ({
  subscribeWorkspaceEvents: (...args: unknown[]) =>
    (subscribeMock as unknown as (...a: unknown[]) => unknown)(...args),
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

/**
 * The one-call listing (#1357), built from a per-directory map so a fixture still
 * reads as "what each directory contains": directories get their children from
 * the map (none listed → empty), and an entry without `isHidden` is visible.
 */
type RawEntry = { name: string; path: string; isDirectory: boolean; isHidden?: boolean };
function mockTree(byDir: Record<string, RawEntry[]>) {
  const build = (dir: string): unknown[] =>
    (byDir[dir] ?? []).map((e) => ({
      ...e,
      isHidden: e.isHidden ?? false,
      ...(e.isDirectory ? { children: build(e.path) } : {}),
    }));
  invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd !== "list_directory_tree") return undefined;
    const root = (args as { path: string }).path;
    if (!(root in byDir)) return { entries: [], truncated: false };
    return { entries: build(root), truncated: false };
  });
}


beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "list_directory_tree") return { entries: [], truncated: false };
    return undefined;
  });
  onFocusChangedMock.mockClear();
  focusCallback = null;
  subscribeMock.mockClear();
  wsEventCallback = null;
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
    // Let the initial listing settle (the scheduler marks itself idle a few
    // microtasks after the listing resolves); a focus during a scan is coalesced
    // into a paced follow-up instead (#1357), which is the other test's subject.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const initialListCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "list_directory_tree",
    ).length;
    expect(initialListCalls).toBeGreaterThanOrEqual(1);
    expect(focusCallback).toBeTypeOf("function");

    focusCallback!({ payload: true });
    await Promise.resolve();
    await Promise.resolve();

    const afterFocusCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "list_directory_tree",
    ).length;
    expect(afterFocusCalls).toBeGreaterThan(initialListCalls);
  });

  it("ignores blur (focused=false) events", async () => {
    renderHook(() => useFileTree("/Users/me/notes"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const initialListCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "list_directory_tree",
    ).length;

    focusCallback!({ payload: false });
    await Promise.resolve();

    const afterBlurCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "list_directory_tree",
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

describe("useFileTree — workspace event subscription", () => {
  it("subscribes to the shared source with the tree's watchId as window label", async () => {
    renderHook(() => useFileTree("/root", { watchId: "main" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(subscribeMock).toHaveBeenCalledWith("main", expect.any(Function));
  });

  it("re-lists the directory when the source delivers a batch", async () => {
    renderHook(() => useFileTree("/root", { watchId: "main" }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(wsEventCallback).toBeTypeOf("function");
    const initial = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "list_directory_tree",
    ).length;

    // Scope + watchId filtering + suppression are the source's job; useFileTree
    // re-lists on a delivered batch — after the debounce window (#1357), never
    // per batch.
    wsEventCallback!([{ kind: "created", path: "/root/new.md", rootPath: "/root", selfWrite: false }]);
    await Promise.resolve();
    await Promise.resolve();
    const rightAway = invokeMock.mock.calls.filter(([cmd]) => cmd === "list_directory_tree").length;
    expect(rightAway).toBe(initial); // debounced, not immediate

    await waitFor(
      () => {
        const after = invokeMock.mock.calls.filter(([cmd]) => cmd === "list_directory_tree").length;
        expect(after).toBeGreaterThan(initial);
      },
      { timeout: 3_000 },
    );
  });

  it("does not subscribe when rootPath is null", async () => {
    renderHook(() => useFileTree(null));
    await Promise.resolve();
    await Promise.resolve();

    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", async () => {
    const unsub = vi.fn();
    subscribeMock.mockImplementationOnce((_label: string, cb: (events: unknown[]) => void) => {
      wsEventCallback = cb;
      return unsub;
    });
    const { unmount } = renderHook(() => useFileTree("/root"));
    await Promise.resolve();
    await Promise.resolve();
    unmount();

    expect(unsub).toHaveBeenCalledTimes(1);
  });
});

describe("useFileTree — directory listing", () => {
  it("lists files and folders, filtering markdown by default", async () => {
    mockTree({
      "/root": [
            { name: "notes.md", path: "/root/notes.md", isDirectory: false },
            { name: "image.png", path: "/root/image.png", isDirectory: false },
            { name: "drafts", path: "/root/drafts", isDirectory: true },
          ],
      "/root/drafts": [
            { name: "wip.md", path: "/root/drafts/wip.md", isDirectory: false },
          ],
    });

    const { result } = renderHook(() => useFileTree("/root"));
    await waitFor(() => {
      expect(result.current.tree.length).toBeGreaterThan(0);
    });

    const names = result.current.tree.map((n) => n.name);
    expect(names).toContain("drafts");
    // #1224 — the label is the name on disk, extension included, by default.
    expect(names).toContain("notes.md");
    // image.png filtered out (no showAllFiles)
    expect(names).not.toContain("image.png");
  });

  // The tree used to keep a registered non-markdown extension once
  // showAllFiles was on, so it said `requirements.txt` while the tab open on
  // that file said `requirements`. showAllFiles decides what is LISTED, never
  // how a listed name is spelled.
  it("hides a registered non-markdown extension even with all files shown", async () => {
    mockTree({
      "/root": [
          { name: "requirements.txt", path: "/root/requirements.txt", isDirectory: false },
          { name: "App.vue", path: "/root/App.vue", isDirectory: false },
        ],
    });

    const { result } = renderHook(() =>
      useFileTree("/root", { showAllFiles: true, showExtensions: false }),
    );
    await waitFor(() => {
      expect(result.current.tree.length).toBe(2);
    });
    const names = result.current.tree.map((n) => n.name);
    expect(names).toContain("requirements");
    // Unregistered: VMark cannot open it, so the name stays as it is on disk.
    expect(names).toContain("App.vue");
  });

  it("hides the extension when the user turns that setting off", async () => {
    const { useSettingsStore } = await import("@/stores/settingsStore");
    const prev = useSettingsStore.getState().general.showFileExtensions;
    useSettingsStore.setState((s) => ({
      general: { ...s.general, showFileExtensions: false },
    }));
    mockTree({
      "/root": [{ name: "notes.md", path: "/root/notes.md", isDirectory: false }],
    });

    try {
      const { result } = renderHook(() =>
        useFileTree("/root", { showExtensions: false }),
      );
      await waitFor(() => {
        expect(result.current.tree.length).toBe(1);
      });
      expect(result.current.tree[0].name).toBe("notes");
    } finally {
      useSettingsStore.setState((s) => ({
        general: { ...s.general, showFileExtensions: prev },
      }));
    }
  });

  it("sorts files before folders correctly regardless of input order", async () => {
    mockTree({
      // Files first in the raw input — sort must still put the folder first.
      "/sorted": [
        { name: "a.md", path: "/sorted/a.md", isDirectory: false },
        { name: "folder", path: "/sorted/folder", isDirectory: true },
        { name: "b.md", path: "/sorted/b.md", isDirectory: false },
      ],
      "/sorted/folder": [],
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
      if (cmd === "list_directory_tree") {
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
    mockTree({
      "/wf": [
            { name: "flow.vmark.yml", path: "/wf/flow.vmark.yml", isDirectory: false },
          ],
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
    mockTree({
      "/root": [
            { name: "notes.md", path: "/root/notes.md", isDirectory: false },
            { name: "image.png", path: "/root/image.png", isDirectory: false },
          ],
    });

    const { result } = renderHook(() => useFileTree("/root", { showAllFiles: true }));
    await waitFor(() => {
      expect(result.current.tree.length).toBeGreaterThan(1);
    });

    const names = result.current.tree.map((n) => n.name);
    expect(names).toContain("image.png");
    expect(names).toContain("notes.md");
  });
});
