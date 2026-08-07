// @vitest-environment node
// WI-3.5 F5 — window→workspace registration for MCP routing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startWindowWorkspaceSync } from "./windowWorkspaceSync";
import { useWorkspaceStore } from "@/stores/workspaceStore";

beforeEach(() => {
  useWorkspaceStore.getState().closeWorkspace();
});

function harness(initialRoot: string | null) {
  const invoke = vi.fn(() => Promise.resolve());
  let listener: ((s: { rootPath: string | null }) => void) | null = null;
  const subscribe = ((fn: (s: { rootPath: string | null }) => void) => {
    listener = fn;
    return () => {
      listener = null;
    };
  }) as unknown as typeof useWorkspaceStore.subscribe;
  let root = initialRoot;
  const stop = startWindowWorkspaceSync({
    invoke: invoke as never,
    windowLabel: "doc-0",
    subscribe,
    getRoot: () => root,
  });
  return {
    invoke,
    stop,
    setRoot: (r: string | null) => {
      root = r;
      listener?.({ rootPath: r });
    },
  };
}

describe("startWindowWorkspaceSync", () => {
  it("registers the current root on start", () => {
    const { invoke } = harness("/repo");
    expect(invoke).toHaveBeenCalledWith("mcp_bridge_set_window_workspace", {
      windowLabel: "doc-0",
      workspaceRoot: "/repo",
    });
  });

  it("re-registers only when the root actually changes", () => {
    const { invoke, setRoot } = harness("/repo");
    invoke.mockClear();
    setRoot("/repo"); // unchanged → no call
    expect(invoke).not.toHaveBeenCalled();
    setRoot("/other");
    expect(invoke).toHaveBeenCalledWith("mcp_bridge_set_window_workspace", {
      windowLabel: "doc-0",
      workspaceRoot: "/other",
    });
  });

  it("retries the same root after a failed registration (audit D7)", async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(new Error("bridge down"))
      .mockResolvedValue(undefined);
    let listener: ((s: { rootPath: string | null }) => void) | null = null;
    const subscribe = ((fn: (s: { rootPath: string | null }) => void) => {
      listener = fn;
      return () => {};
    }) as unknown as typeof useWorkspaceStore.subscribe;
    startWindowWorkspaceSync({
      invoke: invoke as never,
      windowLabel: "doc-0",
      subscribe,
      getRoot: () => "/repo",
    });
    // The initial registration rejects; let its .catch run.
    await Promise.resolve();
    invoke.mockClear();
    // Same root again — because the prior attempt failed, it must re-fire,
    // not be swallowed as a no-op.
    listener?.({ rootPath: "/repo" });
    expect(invoke).toHaveBeenCalledWith("mcp_bridge_set_window_workspace", {
      windowLabel: "doc-0",
      workspaceRoot: "/repo",
    });
  });

  it("an older failure does not invalidate a newer same-root registration (audit #7)", async () => {
    const deferreds: Array<{
      resolve: () => void;
      reject: (e: unknown) => void;
    }> = [];
    const invoke = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          deferreds.push({ resolve, reject });
        }),
    );
    let listener: ((s: { rootPath: string | null }) => void) | null = null;
    const subscribe = ((fn: (s: { rootPath: string | null }) => void) => {
      listener = fn;
      return () => {};
    }) as unknown as typeof useWorkspaceStore.subscribe;
    startWindowWorkspaceSync({
      invoke: invoke as never,
      windowLabel: "doc-0",
      subscribe,
      getRoot: () => "/repo",
    });
    // invoke[0] = register /repo (attempt 1), then /other, then /repo again.
    listener?.({ rootPath: "/other" });
    listener?.({ rootPath: "/repo" });
    expect(invoke).toHaveBeenCalledTimes(3);
    invoke.mockClear();
    // The FIRST /repo registration now fails, late. Because a newer /repo
    // attempt superseded it, `last` must stay "/repo" — not roll back.
    deferreds[0].reject(new Error("late failure"));
    await Promise.resolve();
    await Promise.resolve();
    listener?.({ rootPath: "/repo" }); // unchanged root → must be a no-op
    expect(invoke).not.toHaveBeenCalled();
  });

  it("undoes a registration that lands after teardown (audit #8)", async () => {
    const deferreds: Array<{
      resolve: () => void;
      reject: (e: unknown) => void;
    }> = [];
    const invoke = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          deferreds.push({ resolve, reject });
        }),
    );
    const subscribe = (() => () => {}) as unknown as typeof useWorkspaceStore.subscribe;
    const stop = startWindowWorkspaceSync({
      invoke: invoke as never,
      windowLabel: "doc-0",
      subscribe,
      getRoot: () => "/repo",
    });
    // invoke[0] = register /repo (still pending).
    stop(); // disposed; invoke[1] = clear(null).
    invoke.mockClear();
    // The registration lands AFTER teardown — its success must be undone.
    deferreds[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith("mcp_bridge_set_window_workspace", {
      windowLabel: "doc-0",
      workspaceRoot: null,
    });
  });

  it("clears the registration when the workspace closes", () => {
    const { invoke, setRoot } = harness("/repo");
    invoke.mockClear();
    setRoot(null);
    expect(invoke).toHaveBeenCalledWith("mcp_bridge_set_window_workspace", {
      windowLabel: "doc-0",
      workspaceRoot: null,
    });
  });

  it("clears on teardown so a closed window stops owning a workspace", () => {
    const { invoke, stop } = harness("/repo");
    invoke.mockClear();
    stop();
    expect(invoke).toHaveBeenCalledWith("mcp_bridge_set_window_workspace", {
      windowLabel: "doc-0",
      workspaceRoot: null,
    });
  });
});
