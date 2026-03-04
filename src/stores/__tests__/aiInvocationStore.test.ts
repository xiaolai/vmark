import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useAiInvocationStore } from "../aiInvocationStore";

describe("aiInvocationStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAiInvocationStore.getState().cancel();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with isRunning false", () => {
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    expect(useAiInvocationStore.getState().requestId).toBeNull();
  });

  it("tryStart succeeds when idle", () => {
    const ok = useAiInvocationStore.getState().tryStart("req-1");
    expect(ok).toBe(true);
    expect(useAiInvocationStore.getState().isRunning).toBe(true);
    expect(useAiInvocationStore.getState().requestId).toBe("req-1");
  });

  it("rejects concurrent invocations via store guard", () => {
    useAiInvocationStore.getState().tryStart("req-1");
    const ok = useAiInvocationStore.getState().tryStart("req-2");
    expect(ok).toBe(false);
    expect(useAiInvocationStore.getState().requestId).toBe("req-1");
  });

  it("after cancel, new invocation succeeds", () => {
    useAiInvocationStore.getState().tryStart("req-1");
    useAiInvocationStore.getState().cancel();
    const ok = useAiInvocationStore.getState().tryStart("req-2");
    expect(ok).toBe(true);
    expect(useAiInvocationStore.getState().requestId).toBe("req-2");
  });

  it("tracks elapsed seconds while running", () => {
    useAiInvocationStore.getState().tryStart("r1");

    vi.advanceTimersByTime(3000);
    expect(useAiInvocationStore.getState().elapsedSeconds).toBe(3);

    vi.advanceTimersByTime(2000);
    expect(useAiInvocationStore.getState().elapsedSeconds).toBe(5);
  });

  it("stops timer on finish", () => {
    useAiInvocationStore.getState().tryStart("r1");
    vi.advanceTimersByTime(3000);
    useAiInvocationStore.getState().finish();

    vi.advanceTimersByTime(5000);
    expect(useAiInvocationStore.getState().elapsedSeconds).toBe(0);
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
  });

  it("stops timer on cancel", () => {
    useAiInvocationStore.getState().tryStart("r1");
    vi.advanceTimersByTime(2000);
    useAiInvocationStore.getState().cancel();

    expect(useAiInvocationStore.getState().elapsedSeconds).toBe(0);
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
  });

  it("tracks error state and resets elapsed/requestId", () => {
    useAiInvocationStore.getState().tryStart("r1");
    vi.advanceTimersByTime(2000);
    useAiInvocationStore.getState().setError("Connection timeout");

    const state = useAiInvocationStore.getState();
    expect(state.isRunning).toBe(false);
    expect(state.error).toBe("Connection timeout");
    expect(state.hasActiveStatus).toBe(true);
    expect(state.elapsedSeconds).toBe(0);
    expect(state.requestId).toBeNull();
  });

  it("dismissError clears error and hasActiveStatus", () => {
    useAiInvocationStore.getState().tryStart("r1");
    useAiInvocationStore.getState().setError("Oops");
    useAiInvocationStore.getState().dismissError();

    const state = useAiInvocationStore.getState();
    expect(state.error).toBeNull();
    expect(state.hasActiveStatus).toBe(false);
  });

  it("hasActiveStatus is true when running", () => {
    useAiInvocationStore.getState().tryStart("r1");
    expect(useAiInvocationStore.getState().hasActiveStatus).toBe(true);
  });

  it("hasActiveStatus is false when idle and no error", () => {
    expect(useAiInvocationStore.getState().hasActiveStatus).toBe(false);
  });

  it("showSuccess briefly after finish", () => {
    useAiInvocationStore.getState().tryStart("r1");
    useAiInvocationStore.getState().finish();

    expect(useAiInvocationStore.getState().showSuccess).toBe(true);
    expect(useAiInvocationStore.getState().hasActiveStatus).toBe(true);

    vi.advanceTimersByTime(3000);

    expect(useAiInvocationStore.getState().showSuccess).toBe(false);
    expect(useAiInvocationStore.getState().hasActiveStatus).toBe(false);
  });

  it("finish is a no-op when not running", () => {
    useAiInvocationStore.getState().finish();
    expect(useAiInvocationStore.getState().showSuccess).toBe(false);
    expect(useAiInvocationStore.getState().hasActiveStatus).toBe(false);
  });

  it("dismissError is a no-op when no error exists", () => {
    useAiInvocationStore.getState().tryStart("r1");
    useAiInvocationStore.getState().dismissError();
    // hasActiveStatus should still be true (running)
    expect(useAiInvocationStore.getState().hasActiveStatus).toBe(true);
  });
});
