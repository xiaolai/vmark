// @vitest-environment node
// Audit #375 — the frontend's cancel must reach the provider, not just drop
// its listener: cancelGenieRequest asks Rust to fire the request's token.
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

const genieWarnMock = vi.fn();
vi.mock("@/utils/debug", () => ({
  genieWarn: (...args: unknown[]) => genieWarnMock(...args),
}));

const toastErrorMock = vi.fn();
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: (...args: unknown[]) => toastErrorMock(...args), info: vi.fn(), success: vi.fn() },
}));

import { cancelGenieRequest } from "./cancelRequest";
import { useAiInvocationStore } from "@/stores/aiStore";

beforeEach(() => {
  invokeMock.mockReset();
  genieWarnMock.mockReset();
  toastErrorMock.mockReset();
  useAiInvocationStore.getState().cancel();
});

describe("cancelGenieRequest (audit #375)", () => {
  it("invokes cancel_ai_prompt with the request id", () => {
    invokeMock.mockResolvedValue(undefined);
    cancelGenieRequest("req-1");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("cancel_ai_prompt", { requestId: "req-1" });
  });

  it("is fire-and-forget: a rejection is logged through commandErrorMessage, never thrown", async () => {
    // cancel_ai_prompt is a TYPED command — its rejection is a plain object,
    // which String() would render as "[object Object]".
    invokeMock.mockRejectedValue({ code: "internal", message: "registry gone" });
    expect(() => cancelGenieRequest("req-2")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(genieWarnMock).toHaveBeenCalledTimes(1);
    expect(genieWarnMock.mock.calls[0]?.[1]).toBe("registry gone");
  });

  it("stays quiet when the cancel is accepted", async () => {
    invokeMock.mockResolvedValue(undefined);
    cancelGenieRequest("req-3");
    await Promise.resolve();
    expect(genieWarnMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("puts a refused cancel in the invocation status while nothing else is running", async () => {
    invokeMock.mockRejectedValue({ code: "internal", message: "registry gone" });
    cancelGenieRequest("req-4");
    await Promise.resolve();
    await Promise.resolve();
    expect(useAiInvocationStore.getState().error).toBe("registry gone");
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  // audit #958 — a refused cancel means the provider is STILL RUNNING and still
  // billing. Suppressing the report to protect a newer invocation's state
  // silenced it in the case where it matters most; a toast is
  // request-independent, so it reports without touching that state.
  it("still reports a refused cancel when a newer invocation is running", async () => {
    invokeMock.mockRejectedValue({ code: "internal", message: "registry gone" });
    expect(useAiInvocationStore.getState().tryStart("req-newer")).toBe(true);

    cancelGenieRequest("req-5");
    await Promise.resolve();
    await Promise.resolve();

    expect(toastErrorMock).toHaveBeenCalledWith("registry gone");
    // …and the newer invocation is untouched.
    expect(useAiInvocationStore.getState().isRunning).toBe(true);
    expect(useAiInvocationStore.getState().requestId).toBe("req-newer");
    expect(useAiInvocationStore.getState().error).toBeNull();
    useAiInvocationStore.getState().cancel();
  });

  // audit #959 — the ABA read. `isRunning` is false both when the cancelled
  // run's own slot is still idle and when a LATER run started and finished in
  // the meantime; the second case must not have its success flash overwritten
  // by a failure belonging to the request before it.
  it("does not overwrite a newer invocation that already finished", async () => {
    invokeMock.mockRejectedValue({ code: "internal", message: "registry gone" });
    cancelGenieRequest("req-6");

    // A whole newer invocation comes and goes before the rejection lands.
    expect(useAiInvocationStore.getState().tryStart("req-newer")).toBe(true);
    useAiInvocationStore.getState().finish("req-newer");
    expect(useAiInvocationStore.getState().isRunning).toBe(false);

    await Promise.resolve();
    await Promise.resolve();

    expect(toastErrorMock).toHaveBeenCalledWith("registry gone");
    expect(useAiInvocationStore.getState().error).toBeNull();
    expect(useAiInvocationStore.getState().showSuccess).toBe(true);
  });
});
