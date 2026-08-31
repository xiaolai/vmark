// @vitest-environment node
// Audit round 3, R3-10/R3-12 — the rail handlers' toast POLICY, and the
// rejection paths every call site fires with `void`: a thrown service error
// must surface as a failure toast, never an unhandled rejection.
import { beforeEach, describe, expect, it, vi } from "vitest";

const closeWorkspaceInstance = vi.fn();
const moveWorkspaceInstanceToNewWindow = vi.fn();
const duplicateWorkspaceInstanceToNewWindow = vi.fn();
const toastError = vi.fn();
const toastMessage = vi.fn();

vi.mock("@/services/workspaces/closeWorkspaceInstance", () => ({
  closeWorkspaceInstance: (...args: unknown[]) => closeWorkspaceInstance(...args),
}));
vi.mock("@/services/workspaces/workspaceWindowActions", () => ({
  moveWorkspaceInstanceToNewWindow: (...args: unknown[]) =>
    moveWorkspaceInstanceToNewWindow(...args),
  duplicateWorkspaceInstanceToNewWindow: (...args: unknown[]) =>
    duplicateWorkspaceInstanceToNewWindow(...args),
}));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: {
    error: (...args: unknown[]) => toastError(...args),
    message: (...args: unknown[]) => toastMessage(...args),
  },
}));
vi.mock("@/services/tabs/tabOperations", () => ({
  closeTabsWithDirtyCheck: vi.fn(),
}));
vi.mock("@/services/windowClose/tabCleanup", () => ({
  cleanupTabState: vi.fn(),
}));

import {
  handleCloseWorkspace,
  handleDuplicateWorkspace,
  handleMoveWorkspace,
} from "./workspaceRailHandlers";

const t = ((key: string) => key) as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleCloseWorkspace toast policy (R3-12)", () => {
  it.each([
    { result: { ok: true }, toasts: 0, label: "success is silent" },
    { result: { ok: false, reason: "cancelled" }, toasts: 0, label: "cancelled is the user's own choice" },
    { result: { ok: false, reason: "missing" }, toasts: 0, label: "missing means already gone" },
    { result: { ok: false, reason: "busy" }, toasts: 1, label: "busy is the one refusal worth a toast" },
  ])("$label", async ({ result, toasts }) => {
    closeWorkspaceInstance.mockResolvedValue(result);
    await handleCloseWorkspace("main", "wsi-a", t);
    expect(toastError).toHaveBeenCalledTimes(toasts);
    if (toasts > 0) {
      expect(toastError).toHaveBeenCalledWith("dialog:toast.workspaceCloseBusy");
    }
  });

  it("a thrown close surfaces as the close-failed toast, not an unhandled rejection", async () => {
    closeWorkspaceInstance.mockRejectedValue(new Error("dialog plumbing died"));
    await expect(handleCloseWorkspace("main", "wsi-a", t)).resolves.toBeUndefined();
    expect(toastError).toHaveBeenCalledWith("dialog:toast.workspaceCloseFailed");
  });
});

describe("handleMoveWorkspace rejection path (R3-10)", () => {
  it("a thrown move surfaces as the move-failed toast", async () => {
    moveWorkspaceInstanceToNewWindow.mockRejectedValue(new Error("ipc died"));
    await expect(handleMoveWorkspace("main", "wsi-a", t)).resolves.toBeUndefined();
    expect(toastError).toHaveBeenCalledWith("dialog:toast.workspaceMoveFailed");
  });

  it("a refused move still toasts (result-shaped failure)", async () => {
    moveWorkspaceInstanceToNewWindow.mockResolvedValue({ ok: false, reason: "timeout" });
    await handleMoveWorkspace("main", "wsi-a", t);
    expect(toastError).toHaveBeenCalledWith("dialog:toast.workspaceMoveFailed");
  });
});

describe("handleDuplicateWorkspace rejection path (R3-10)", () => {
  it("a thrown duplicate surfaces as the duplicate-failed toast", async () => {
    duplicateWorkspaceInstanceToNewWindow.mockRejectedValue(new Error("ipc died"));
    await expect(handleDuplicateWorkspace("main", "wsi-a", t)).resolves.toBeUndefined();
    expect(toastError).toHaveBeenCalledWith("dialog:toast.workspaceDuplicateFailed");
  });

  it("a successful duplicate with skipped tabs reports the count", async () => {
    duplicateWorkspaceInstanceToNewWindow.mockResolvedValue({
      ok: true,
      targetWindowLabel: "doc-2",
      skippedDirtyCount: 2,
      skippedUntitledCount: 1,
      skippedMissingCount: 0,
    });
    await handleDuplicateWorkspace("main", "wsi-a", t);
    expect(toastMessage).toHaveBeenCalledWith("dialog:toast.workspaceDuplicateSkipped");
    expect(toastError).not.toHaveBeenCalled();
  });
});
