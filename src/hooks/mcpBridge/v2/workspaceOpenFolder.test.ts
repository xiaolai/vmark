// open_workspace handler — fail-now -> approve -> AI-retry (plan WI-1.5).
import { describe, it, expect, beforeEach, vi } from "vitest";

const responses: Array<Record<string, unknown>> = [];
// Rust validate_workspace_dir returns the canonical path (or rejects).
const invokeMock = vi.fn(async (_cmd: string, args: { path: string }) => args.path);
// openWorkspaceByPath resolves to whether the sequence completed (M8).
const openWorkspaceByPath = vi.fn(async () => true);
const withReentryGuard = vi.fn(async <T>(_l: string, _k: string, fn: () => Promise<T>) => fn());

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
vi.mock("@/services/workspaces/openWorkspaceByPath", () => ({
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

  it("a busy transition guard fails BUSY and does NOT consume the grant (M4)", async () => {
    await handleWorkspaceOpenWorkspace("id1", { folderPath: "/proj", clientId: "c1" });
    useWorkspaceApprovalStore.getState().resolveApproval("id1", "approve");
    responses.length = 0;
    // The guard is held by a concurrent menu transition → callback skipped.
    withReentryGuard.mockImplementationOnce(async () => undefined);

    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj", clientId: "c1" });

    expect(openWorkspaceByPath).not.toHaveBeenCalled();
    expect(responses[0].success).toBe(false);
    expect(String(responses[0].error)).toContain("BUSY");
    // The one-shot survives so a later retry can still open.
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(1);
  });

  it("an internal open failure fails closed (no false success) (M8)", async () => {
    await handleWorkspaceOpenWorkspace("id1", { folderPath: "/proj", clientId: "c1" });
    useWorkspaceApprovalStore.getState().resolveApproval("id1", "approve");
    responses.length = 0;
    openWorkspaceByPath.mockResolvedValueOnce(false);

    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj", clientId: "c1" });

    expect(responses[0].success).toBe(false);
    expect(String(responses[0].error)).toContain("INTERNAL");
    // Grant is spent (it authorized one attempt); a fresh approval is required.
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(0);
  });

  it("responds RESOURCE_EXHAUSTED when the approval queue is full (M7)", async () => {
    // Saturate the pending queue with distinct requests.
    const store = useWorkspaceApprovalStore.getState();
    for (let i = 0; i < 32; i++) store.requestApproval(`p${i}`, `/full${i}`, "main", "c1");
    responses.length = 0;

    await handleWorkspaceOpenWorkspace("overflow", { folderPath: "/new", clientId: "c1" });

    expect(responses[0].success).toBe(false);
    expect(String(responses[0].error)).toContain("RESOURCE_EXHAUSTED");
  });
});
