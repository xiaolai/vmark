import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceTransferAckPayload } from "@/types/workspaceTransfer";
import { waitForWorkspaceAck } from "./workspaceTransferAck";

const { mockListen } = vi.hoisted(() => ({
  mockListen: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: mockListen }),
}));

describe("waitForWorkspaceAck", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockListen.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("unlistens when listen resolves after timeout", async () => {
    let resolveListen!: (fn: () => void) => void;
    const unlisten = vi.fn();
    mockListen.mockReturnValue(new Promise<() => void>((resolve) => {
      resolveListen = resolve;
    }));

    const result = waitForWorkspaceAck("req-a", 5);
    await vi.advanceTimersByTimeAsync(5);
    await expect(result).resolves.toBeNull();

    resolveListen(unlisten);
    await Promise.resolve();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("resolves matching ack and ignores unrelated acks", async () => {
    const unlisten = vi.fn();
    let handler!: (event: { payload: WorkspaceTransferAckPayload }) => void;
    mockListen.mockImplementation((_event, cb) => {
      handler = cb;
      return Promise.resolve(unlisten);
    });

    const result = waitForWorkspaceAck("req-a", 100);
    await Promise.resolve();
    handler({
      payload: {
        requestId: "other",
        targetWindowLabel: "doc-2",
        workspaceInstanceId: "wsi-other",
      },
    });
    handler({
      payload: {
        requestId: "req-a",
        targetWindowLabel: "doc-1",
        workspaceInstanceId: "wsi-a",
      },
    });

    await expect(result).resolves.toMatchObject({ targetWindowLabel: "doc-1" });
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
