/**
 * useGenieInvocation.cancel — audit #375: cancel() reaches Rust.
 *
 * The hook's cancel used to drop the `ai:response` listener and reset the
 * store while the provider ran on. It now asks Rust to fire the request's
 * cancel token — keyed by the store's active request id, read BEFORE the
 * reset clears it. Split from useGenieInvocation.test.ts, which is frozen at
 * its file-size baseline. The Tauri boundary is mocked; the stores are real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const invokeMock = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

import { useAiInvocationStore } from "@/stores/aiStore";
import { useGenieInvocation } from "../useGenieInvocation";
import { runGenieStream } from "@/services/genieInvocation/streamRunner";
import { useAiProviderStore } from "@/stores/aiStore";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  useAiInvocationStore.getState().cancel();
});

describe("useGenieInvocation.cancel — reaches Rust (audit #375)", () => {
  it("invokes cancel_ai_prompt with the active request id, then resets the store", () => {
    expect(useAiInvocationStore.getState().tryStart("req-42")).toBe(true);
    const { result } = renderHook(() => useGenieInvocation());

    act(() => {
      result.current.cancel();
    });

    expect(invokeMock).toHaveBeenCalledWith("cancel_ai_prompt", { requestId: "req-42" });
    const s = useAiInvocationStore.getState();
    expect(s.isRunning).toBe(false);
    expect(s.requestId).toBeNull();
  });

  it("does not ask Rust to cancel when nothing is running", () => {
    const { result, unmount } = renderHook(() => useGenieInvocation());
    act(() => {
      result.current.cancel();
    });
    unmount(); // the unmount cleanup cancels too
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("a rejected cancel_ai_prompt does not block the local reset", async () => {
    invokeMock.mockRejectedValue({ code: "internal", message: "bridge down" });
    useAiInvocationStore.getState().tryStart("req-7");
    const { result } = renderHook(() => useGenieInvocation());

    act(() => {
      result.current.cancel();
    });

    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    // Let the handled rejection settle; an unhandled one would fail the run.
    await Promise.resolve();
    await Promise.resolve();
  });

  it("cancels the running request on unmount", () => {
    useAiInvocationStore.getState().tryStart("req-9");
    const { unmount } = renderHook(() => useGenieInvocation());
    unmount();
    expect(invokeMock).toHaveBeenCalledWith("cancel_ai_prompt", { requestId: "req-9" });
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
  });
});

// Audit #375, round 3. Cancel used to reach only what was ALREADY registered:
// a click during the awaits that precede registration (`ensureProvider()`, the
// `listen()` round-trip) found no request id, cancelled nothing, and the
// provider request then started anyway — the user watched a run they had
// already stopped. The cancel now mints an INTENT that a later registration
// has to clear.
describe("cancel before the request is registered (audit #375)", () => {
  it("refuses a start that was cancelled before it registered", () => {
    const store = useAiInvocationStore.getState();
    const epoch = store.cancelEpoch;
    store.cancel(); // the user clicked Cancel while the start was still awaiting
    expect(store.tryStart("req-late", epoch)).toBe(false);
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
  });

  it("still starts when no cancel happened since the epoch was taken", () => {
    const store = useAiInvocationStore.getState();
    expect(store.tryStart("req-ok", store.cancelEpoch)).toBe(true);
    expect(useAiInvocationStore.getState().requestId).toBe("req-ok");
  });

  it("does not dispatch run_ai_prompt for a stream cancelled before it registered", async () => {
    // A usable provider, so the run gets as far as dispatching: without it the
    // early provider bail-out would make this pass for the wrong reason.
    useAiProviderStore.setState({
      activeProvider: "openai",
      restProviders: [
        { type: "openai", name: "OpenAI", apiKey: "sk-test", model: "gpt-4", endpoint: null } as never,
      ],
      cliProviders: [],
    } as never);
    const epoch = useAiInvocationStore.getState().cancelEpoch;
    useAiInvocationStore.getState().cancel();
    await runGenieStream({
      filledPrompt: "hello",
      extraction: { text: "hello", from: 0, to: 5 },
      listenerRef: { current: null },
      cancelEpoch: epoch,
    });
    expect(invokeMock).not.toHaveBeenCalledWith("run_ai_prompt", expect.anything());
  });

  it("surfaces a refused cancel instead of only writing it to the log", async () => {
    // Fire-and-forget is right — a cancel must not wait on the thing it is
    // cancelling — but a REFUSED cancel means the provider is still running and
    // still billing, and `genieWarn` only reaches the log file.
    invokeMock.mockRejectedValue({ code: "internal", message: "bridge down" });
    useAiInvocationStore.getState().tryStart("req-13");
    const { result } = renderHook(() => useGenieInvocation());
    act(() => {
      result.current.cancel();
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(useAiInvocationStore.getState().error).toBe("bridge down");
  });
});
