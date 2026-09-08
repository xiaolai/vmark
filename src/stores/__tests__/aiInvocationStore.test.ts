// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useAiInvocationStore } from "../aiStore";

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
  // Audit #996 — elapsed is WALL-CLOCK, not a tick count. setInterval is a
  // lower bound: a backgrounded webview throttles it and a sleeping machine
  // fires it not at all, so counting callbacks under-reported a long run by
  // however long the app was not foregrounded.
  it("reports elapsed time across a gap the timer slept through", () => {
    useAiInvocationStore.getState().tryStart("r-sleep");
    vi.advanceTimersByTime(1000);
    expect(useAiInvocationStore.getState().elapsedSeconds).toBe(1);

    // The clock moves 60s while the interval fires nothing — a sleep, or a
    // throttled background tab. Then one more tick arrives.
    vi.setSystemTime(Date.now() + 60_000);
    vi.advanceTimersByTime(1000);

    expect(useAiInvocationStore.getState().elapsedSeconds).toBe(62);
  });

  // Audit #959 — the epoch a late failure uses to tell "my slot" from "a later
  // run's slot". Monotonic, and it must survive cancel() like cancelEpoch.
  it("advances startEpoch on every start and carries it through cancel", () => {
    const first = useAiInvocationStore.getState().startEpoch;
    useAiInvocationStore.getState().tryStart("r1");
    expect(useAiInvocationStore.getState().startEpoch).toBe(first + 1);

    useAiInvocationStore.getState().cancel();
    expect(useAiInvocationStore.getState().startEpoch).toBe(first + 1);

    useAiInvocationStore.getState().tryStart("r2");
    useAiInvocationStore.getState().finish("r2");
    expect(useAiInvocationStore.getState().startEpoch).toBe(first + 2);
  });
});

// Audit #993 — `hasActiveStatus` is a summary of three other fields, and six
// transitions used to restate it by hand. These pin the summary against its
// inputs after EVERY transition, so a new one that forgets it fails here
// rather than leaving the status bar stuck or blank.
describe("hasActiveStatus is derived, not maintained", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAiInvocationStore.getState().cancel();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The definition, stated once. */
  function expectInvariant(): void {
    const s = useAiInvocationStore.getState();
    expect(s.hasActiveStatus, JSON.stringify({
      isRunning: s.isRunning, error: s.error, showSuccess: s.showSuccess,
    })).toBe(s.isRunning || s.error !== null || s.showSuccess);
  }

  const transitions: ReadonlyArray<[string, () => void]> = [
    ["idle", () => {}],
    ["tryStart", () => void useAiInvocationStore.getState().tryStart("r1")],
    ["tryStart → finish", () => {
      useAiInvocationStore.getState().tryStart("r1");
      useAiInvocationStore.getState().finish();
    }],
    ["tryStart → finish → flash expiry", () => {
      useAiInvocationStore.getState().tryStart("r1");
      useAiInvocationStore.getState().finish();
      vi.advanceTimersByTime(3000);
    }],
    ["tryStart → setError", () => {
      useAiInvocationStore.getState().tryStart("r1");
      useAiInvocationStore.getState().setError("boom");
    }],
    ["tryStart → setError → dismissError", () => {
      useAiInvocationStore.getState().tryStart("r1");
      useAiInvocationStore.getState().setError("boom");
      useAiInvocationStore.getState().dismissError();
    }],
    ["tryStart → cancel", () => {
      useAiInvocationStore.getState().tryStart("r1");
      useAiInvocationStore.getState().cancel();
    }],
    ["setError with an EMPTY message", () => {
      useAiInvocationStore.getState().tryStart("r1");
      useAiInvocationStore.getState().setError("");
    }],
  ];

  it.each(transitions)("holds after %s", (_name, run) => {
    run();
    expectInvariant();
  });
});

// Audit #1000 — `setError` accepts any string and an empty one is reachable
// (`errorMessage(new Error(""))` is ""). A truthiness guard in dismissError
// left that error set and the status row pinned open with no way to clear it.
describe("dismissError with an empty-string error", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAiInvocationStore.getState().cancel();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears an empty error instead of treating it as absent", () => {
    useAiInvocationStore.getState().tryStart("r1");
    useAiInvocationStore.getState().setError("");
    expect(useAiInvocationStore.getState().error).toBe("");
    expect(useAiInvocationStore.getState().hasActiveStatus).toBe(true);

    useAiInvocationStore.getState().dismissError();

    expect(useAiInvocationStore.getState().error).toBeNull();
    expect(useAiInvocationStore.getState().hasActiveStatus).toBe(false);
  });
});
