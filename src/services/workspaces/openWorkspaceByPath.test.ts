// @vitest-environment node
// Shared open-workspace-by-path helper (plan WI-1.1b / ADR-1).
// Both the "Open Folder" menu command and the open_workspace MCP handler call
// this, so opening a folder is one code path and can't half-open (store set but
// tabs/rail/split not restored). It owns the per-window transition guard.
import { describe, it, expect, beforeEach, vi } from "vitest";

const calls: string[] = [];
const openWorkspaceWithConfig = vi.fn(async () => ({ documents: [] }));
const showSidebarWithView = vi.fn(() => calls.push("sidebar"));
const addWorkspace = vi.fn(() => calls.push("recents"));
const restoreWorkspaceTabs = vi.fn(async () => calls.push("restoreTabs"));
const restoreSplitLayout = vi.fn(() => calls.push("restoreSplit"));

vi.mock("@/services/workspaces/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...a: unknown[]) => {
    calls.push("openWorkspaceWithConfig");
    return openWorkspaceWithConfig(...(a as []));
  },
}));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: { getState: () => ({ showSidebarWithView }) },
}));
vi.mock("@/stores/workspaceStore", () => ({
  useRecentWorkspacesStore: { getState: () => ({ addWorkspace }) },
}));
vi.mock("@/services/navigation/restoreWorkspaceTabs", () => ({
  restoreWorkspaceTabs: (...a: unknown[]) => restoreWorkspaceTabs(...(a as [])),
  restoreSplitLayout: (...a: unknown[]) => restoreSplitLayout(...(a as [])),
}));
vi.mock("@/services/persistence/sessionTabs", () => ({
  documentPathsForRestore: () => [],
}));

const mockInvoke = vi.fn(async () => undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => {
    calls.push("scope");
    return mockInvoke(cmd as never, args as never);
  },
}));

import { openWorkspaceByPath, WORKSPACE_TRANSITION_GUARD } from "./openWorkspaceByPath";

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe("openWorkspaceByPath", () => {
  it("exports the shared transition-guard key (callers hold it)", () => {
    expect(WORKSPACE_TRANSITION_GUARD).toBe("workspace-transition");
  });

  it("runs the full open sequence in order", async () => {
    await openWorkspaceByPath("/some/folder", { windowLabel: "doc-1" });
    expect(calls).toEqual([
      // The scope grant comes FIRST — every step after it may read files.
      "scope",
      "openWorkspaceWithConfig",
      "sidebar",
      "recents",
      "restoreTabs",
      "restoreSplit",
    ]);
  });

  // #1252 — fs scope grants are in-memory and do NOT survive a restart, so a
  // workspace restored from the previous session or reopened from recents
  // never passes through the folder picker that would have granted it. Off the
  // home drive (Windows `G:\…`, where the static `$HOME/**` scope reaches
  // nothing) every file in it is then refused with `forbidden path: …`.
  it("grants fs scope for the workspace root before reading anything", async () => {
    await openWorkspaceByPath("/some/folder", { windowLabel: "doc-1" });
    expect(mockInvoke).toHaveBeenCalledWith("allow_workspace_access", {
      path: "/some/folder",
    });
  });

  it("still opens the workspace when the scope grant fails", async () => {
    // Best-effort: the static scope already covers the common case, so a failed
    // grant must not turn a working open into a hard failure.
    mockInvoke.mockRejectedValueOnce(new Error("no such command"));
    await expect(openWorkspaceByPath("/f")).resolves.toBe(true);
  });

  it("passes the window label through (default main)", async () => {
    await openWorkspaceByPath("/f");
    expect(restoreSplitLayout).toHaveBeenCalledWith("main", "/f");
  });

  it("returns true when the sequence completes", async () => {
    await expect(openWorkspaceByPath("/f")).resolves.toBe(true);
  });

  it("returns false on an open failure without throwing (does not break the caller)", async () => {
    openWorkspaceWithConfig.mockRejectedValueOnce(new Error("boom"));
    await expect(openWorkspaceByPath("/f")).resolves.toBe(false);
  });
});
