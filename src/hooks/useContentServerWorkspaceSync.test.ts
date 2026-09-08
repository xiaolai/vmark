/**
 * useContentServerWorkspaceSync — the workspace-store half of the content
 * server's lifecycle: a workspace SWITCH while serving (audit #513) and the
 * trust reconciler (WI-FL3.6) it absorbed from useContentServer.ts. Real
 * stores throughout; the only injected piece is the supervisor start path
 * the trust branch restarts through.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { WorkspaceConfig } from "@/stores/workspaceConfigDefaults";
import { normalizeWorkspaceConfig } from "@/stores/workspaceConfigDefaults";
import { useContentServerStore } from "@/stores/contentServerStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useContentServerWorkspaceSync } from "./useContentServerWorkspaceSync";

/** A workspace config whose identity carries the given trust. */
function configWithTrust(trusted: boolean): WorkspaceConfig {
  return {
    ...normalizeWorkspaceConfig(null),
    identity: {
      id: "ws-id",
      createdAt: 1,
      trustLevel: trusted ? "trusted" : "untrusted",
      trustedAt: trusted ? 1 : null,
    },
  };
}

/** The supervisor start path, as the ref useContentServer hands over. */
function startPath() {
  return { current: vi.fn(async (_resetBudget: boolean) => {}) };
}

function serving() {
  useContentServerStore.getState().setRunning("http://127.0.0.1:7", 7);
  useContentServerStore.getState().setIframeUrl("http://127.0.0.1:7/__auth?t=n");
}

beforeEach(() => {
  useContentServerStore.getState().reset();
  useWorkspaceStore.setState({ rootPath: "/a", config: configWithTrust(false) });
});

describe("useContentServerWorkspaceSync — workspace switch (audit #513)", () => {
  it("a switch while running says stopped and clears the previous root's URLs", () => {
    serving();
    const start = startPath();
    renderHook(() => useContentServerWorkspaceSync(start));

    useWorkspaceStore.getState().openWorkspace("/b", configWithTrust(false));

    const s = useContentServerStore.getState();
    expect(s.status).toBe("stopped");
    expect(s.url).toBeNull();
    expect(s.port).toBeNull();
    expect(s.iframeUrl).toBeNull();
    expect(start.current).not.toHaveBeenCalled();
  });

  it("closing the workspace while running says stopped too", () => {
    serving();
    renderHook(() => useContentServerWorkspaceSync(startPath()));
    useWorkspaceStore.getState().closeWorkspace();
    expect(useContentServerStore.getState().status).toBe("stopped");
  });

  it("a switch to a workspace of different trust stops and does NOT start a server for the new root", () => {
    serving();
    const start = startPath();
    renderHook(() => useContentServerWorkspaceSync(start));

    // rootPath and config change in ONE set(): the trust branch must not see
    // this as a flip to restart through — that would start a server for /b
    // without the user asking.
    useWorkspaceStore.getState().openWorkspace("/b", configWithTrust(true));

    expect(useContentServerStore.getState().status).toBe("stopped");
    expect(start.current).not.toHaveBeenCalled();
  });

  it("a switch while a start is in flight is left to that start's own supersession", () => {
    useContentServerStore.getState().setStarting();
    renderHook(() => useContentServerWorkspaceSync(startPath()));
    useWorkspaceStore.getState().openWorkspace("/b", configWithTrust(false));
    expect(useContentServerStore.getState().status).toBe("starting");
  });

  it("a switch while stopped or errored changes nothing", () => {
    useContentServerStore.getState().setError("spawn boom");
    renderHook(() => useContentServerWorkspaceSync(startPath()));
    useWorkspaceStore.getState().openWorkspace("/b", configWithTrust(false));
    const s = useContentServerStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toBe("spawn boom");
  });

  it("an unrelated workspace-store change while running is ignored", () => {
    serving();
    const start = startPath();
    renderHook(() => useContentServerWorkspaceSync(start));
    useWorkspaceStore.setState({ config: { ...configWithTrust(false), excludeFolders: ["x"] } });
    expect(useContentServerStore.getState().status).toBe("running");
    expect(start.current).not.toHaveBeenCalled();
  });
});

describe("useContentServerWorkspaceSync — trust reconciler (WI-FL3.6)", () => {
  it("a trust flip while running restarts through the supervisor start path", () => {
    serving();
    const start = startPath();
    renderHook(() => useContentServerWorkspaceSync(start));
    useWorkspaceStore.getState().trustWorkspace();
    expect(start.current).toHaveBeenCalledTimes(1);
    expect(start.current).toHaveBeenCalledWith(false);
    expect(useContentServerStore.getState().status).toBe("running");
  });

  it("a trust flip while stopped does nothing", () => {
    const start = startPath();
    renderHook(() => useContentServerWorkspaceSync(start));
    useWorkspaceStore.getState().trustWorkspace();
    expect(start.current).not.toHaveBeenCalled();
  });

  it("stops listening on unmount", () => {
    serving();
    const start = startPath();
    const { unmount } = renderHook(() => useContentServerWorkspaceSync(start));
    unmount();
    useWorkspaceStore.getState().openWorkspace("/b", configWithTrust(true));
    expect(useContentServerStore.getState().status).toBe("running");
    expect(start.current).not.toHaveBeenCalled();
  });
});
