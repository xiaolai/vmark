/**
 * useFileTree — stale responses, ambiguous keys, overlapping scans, and the
 * difference between "empty" and "unreadable".
 *
 * These four were reported together by an audit of the file explorer, and they
 * share a theme with the bug that prompted it (#1224): the tree presenting an
 * absence of information as an empty folder.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

vi.mock("@/services/workspaceEvents/subscribeWorkspaceEvents", () => ({
  subscribeWorkspaceEvents: () => () => {},
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onFocusChanged: async () => () => {},
  }),
}));

import { useFileTree } from "./useFileTree";

/** A listing that resolves only when the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const entry = (name: string) => ({
  name,
  path: `/root/${name}`,
  isDirectory: false,
  isHidden: false,
});

/** The one-call listing's wire shape (#1357). */
const listing = (entries: unknown[], truncated = false) => ({ entries, truncated });

beforeEach(() => {
  invokeMock.mockReset();
});

describe("stale responses", () => {
  it("discards a listing that lands after the root is cleared", async () => {
    const first = deferred<unknown>();
    invokeMock.mockReturnValueOnce(first.promise);

    const { result, rerender } = renderHook(
      ({ root }: { root: string | null }) => useFileTree(root),
      { initialProps: { root: "/root" as string | null } },
    );

    // Close the workspace while the listing is still in flight.
    rerender({ root: null });
    await act(async () => {
      first.resolve(listing([entry("late.md")]));
      await first.promise;
    });

    expect(result.current.tree).toEqual([]);
  });
});

describe("excludeFolders key", () => {
  it("distinguishes folder lists that flatten to the same comma string", async () => {
    // ["a,b"] and ["a","b"] both joined to "a,b", so switching between them
    // kept the previous loader and the previous exclusions.
    invokeMock.mockResolvedValue(listing([]));
    const { rerender } = renderHook(
      ({ folders }: { folders: string[] }) => useFileTree("/root", { excludeFolders: folders }),
      { initialProps: { folders: ["a,b"] } },
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    const callsBefore = invokeMock.mock.calls.length;

    rerender({ folders: ["a", "b"] });

    await waitFor(() => {
      expect(invokeMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});

describe("unreadable directories", () => {
  it("reports a root that cannot be read instead of showing it as empty", async () => {
    invokeMock.mockRejectedValue(new Error("EACCES"));

    const { result } = renderHook(() => useFileTree("/forbidden"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.tree).toEqual([]);
  });

  it("keeps the rest of the tree when ONE subdirectory is unreadable", async () => {
    // The walker reports a locked subfolder as an empty, flagged directory (#1357);
    // the tree keeps everything else and reports no error.
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd !== "list_directory_tree") return undefined;
      return listing([
        { name: "locked", path: "/root/locked", isDirectory: true, isHidden: false, unreadable: true, children: [] },
        entry("visible.md"),
      ]);
    });

    const { result } = renderHook(() => useFileTree("/root"));

    await waitFor(() => expect(result.current.tree.length).toBe(2));
    expect(result.current.error).toBeNull();
    expect(result.current.tree.map((n) => n.name)).toContain("visible.md");
  });
});
