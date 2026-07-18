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
