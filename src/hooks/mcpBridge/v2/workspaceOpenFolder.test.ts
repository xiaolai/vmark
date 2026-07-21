// open_workspace handler — fail-now -> approve -> AI-retry (plan WI-1.5).
import { describe, it, expect, beforeEach, vi } from "vitest";

const responses: Array<Record<string, unknown>> = [];
// Rust validate_workspace_dir returns the canonical path (or rejects).
const invokeMock = vi.fn(async (_cmd: string, args: { path: string }) => args.path);
const openWorkspaceByPath = vi.fn(async () => {});
const withReentryGuard = vi.fn(async (_l: string, _k: string, fn: () => Promise<void>) => fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...(a as [string, { path: string }])) }));
vi.mock("../utils", () => ({
  respond: async (r: Record<string, unknown>) => { responses.push(r); },
}));
vi.mock("./wrapHandler", () => ({
  wrapHandler: async (_id: string, fn: () => Promise<void>) => fn(),
}));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));
vi.mock("@/hooks/openWorkspaceByPath", () => ({
  openWorkspaceByPath: (...a: unknown[]) => openWorkspaceByPath(...(a as [])),
  WORKSPACE_TRANSITION_GUARD: "workspace-transition",
}));
vi.mock("@/utils/reentryGuard", () => ({
  withReentryGuard: (...a: unknown[]) => withReentryGuard(...(a as [string, string, () => Promise<void>])),
}));

import { handleWorkspaceOpenWorkspace } from "./workspaceOpenFolder";
import { useWorkspaceApprovalStore } from "@/stores/workspaceApprovalStore";

beforeEach(() => {
  responses.length = 0;
  vi.clearAllMocks();
  invokeMock.mockImplementation(async (_cmd: string, args: { path: string }) => args.path);
  useWorkspaceApprovalStore.setState({ pending: [], oneShots: [] });
});

describe("handleWorkspaceOpenWorkspace", () => {
  it("rejects a missing folderPath", async () => {
    await handleWorkspaceOpenWorkspace("id1", {});
    expect(responses[0].success).toBe(false);
    expect(String(responses[0].error)).toContain("INVALID_PATH");
    expect(openWorkspaceByPath).not.toHaveBeenCalled();
  });

  it("rejects a path that Rust validation rejects (not a directory)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("'/a/file.md' is not a directory"));
    await handleWorkspaceOpenWorkspace("id1", { folderPath: "/a/file.md" });
    expect(responses[0].success).toBe(false);
    expect(String(responses[0].error)).toContain("INVALID_PATH");
  });

  it("first call queues approval and fails now (does not open)", async () => {
    await handleWorkspaceOpenWorkspace("id1", { folderPath: "/proj", clientId: "c1" });

    expect(openWorkspaceByPath).not.toHaveBeenCalled();
    expect(responses[0].success).toBe(false);
    expect((responses[0].data as { needsApproval?: boolean }).needsApproval).toBe(true);
    // A pending prompt is queued for the UI.
    expect(useWorkspaceApprovalStore.getState().pending).toHaveLength(1);
  });

  it("retry after approval consumes the one-shot and opens under the guard", async () => {
    // First call queues the prompt.
    await handleWorkspaceOpenWorkspace("id1", { folderPath: "/proj", clientId: "c1" });
    // User approves.
    useWorkspaceApprovalStore.getState().resolveApproval("id1", "approve");
    responses.length = 0;

    // Retry (same path/window/client) consumes and opens.
    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj", clientId: "c1" });

    expect(withReentryGuard).toHaveBeenCalledWith(
      "main",
      "workspace-transition",
      expect.any(Function),
    );
    expect(openWorkspaceByPath).toHaveBeenCalledWith("/proj", { windowLabel: "main" });
    expect(responses[0].success).toBe(true);
    expect((responses[0].data as { opened?: boolean }).opened).toBe(true);
    // One-shot spent — a second retry would need re-approval.
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(0);
  });

  it("a retry without approval fails again (no open)", async () => {
    await handleWorkspaceOpenWorkspace("id1", { folderPath: "/proj", clientId: "c1" });
    responses.length = 0;
    // Retry WITHOUT approving — still needs approval.
    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj", clientId: "c1" });
    expect(openWorkspaceByPath).not.toHaveBeenCalled();
    expect(responses[0].success).toBe(false);
  });
});
