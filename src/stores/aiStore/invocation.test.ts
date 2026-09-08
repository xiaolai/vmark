// @vitest-environment node
/**
 * AI invocation store — the singleton guard's ownership rules (audit round 2).
 *
 * Four defects, one shape: a store write that belongs to one request landing on
 * another. Two are ORDERING (a timer armed after the state it belongs to is
 * published, so a synchronous subscriber's `clearTimers()` cannot see it), and
 * two are SCOPE (a terminal transition with no request identity, so a late
 * frame from a finished run ends a live one).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAiInvocationStore } from "./invocation";

beforeEach(() => {
  vi.useFakeTimers();
  useAiInvocationStore.getState().cancel();
});

afterEach(() => {
  useAiInvocationStore.getState().cancel();
  vi.useRealTimers();
});

describe("timers are armed before the state that owns them is published", () => {
  // #995 — Zustand notifies subscribers synchronously inside `set`. A
  // subscriber that cancelled during `tryStart`'s publish ran `clearTimers()`
  // while the elapsed interval did not yet exist, and the assignment that
  // followed left an orphan ticking `elapsedSeconds` over a cancelled store.
  it("a cancel from inside tryStart's publish leaves no orphan elapsed timer", () => {
    const unsub = useAiInvocationStore.subscribe((s) => {
      if (s.isRunning) useAiInvocationStore.getState().cancel();
    });
    useAiInvocationStore.getState().tryStart("req-1");
    unsub();

    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    const before = useAiInvocationStore.getState().elapsedSeconds;
    vi.advanceTimersByTime(5000);
    expect(useAiInvocationStore.getState().elapsedSeconds).toBe(before);
  });

  // #998 — same shape on the success flash: a subscriber that started another
  // request inside `finish`'s publish ran a `clearTimers()` that could not see
  // this timeout, which then fired and cleared the NEW request's active status.
  it("a new request started from inside finish's publish is not hidden by the old success timeout", () => {
    useAiInvocationStore.getState().tryStart("req-1");
    const unsub = useAiInvocationStore.subscribe((s) => {
      if (s.showSuccess) useAiInvocationStore.getState().tryStart("req-2");
    });
    useAiInvocationStore.getState().finish();
    unsub();

    expect(useAiInvocationStore.getState().requestId).toBe("req-2");
    vi.advanceTimersByTime(5000);
    // The stale flash timeout must not have switched the new request's status
    // banner off underneath it.
    expect(useAiInvocationStore.getState().hasActiveStatus).toBe(true);
  });
});

describe("terminal transitions are request-scoped", () => {
  // #997 — a delayed completion from a cancelled invocation saw a NEWER one
  // running and ended it: one request's success silently killing another's run.
  it("finish() for a stale request does not end the live one", () => {
    useAiInvocationStore.getState().tryStart("req-old");
    useAiInvocationStore.getState().cancel();
    useAiInvocationStore.getState().tryStart("req-new");

    useAiInvocationStore.getState().finish("req-old");

    expect(useAiInvocationStore.getState().isRunning).toBe(true);
    expect(useAiInvocationStore.getState().requestId).toBe("req-new");
    expect(useAiInvocationStore.getState().showSuccess).toBe(false);
  });

  it("finish() for the live request still ends it", () => {
    useAiInvocationStore.getState().tryStart("req-1");
    useAiInvocationStore.getState().finish("req-1");
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    expect(useAiInvocationStore.getState().showSuccess).toBe(true);
  });

  // #999 — setError had no request identity AND did not even require a running
  // invocation, so a late failure from an old request terminated and overwrote
  // a newer one.
  it("setError() for a stale request does not overwrite the live one", () => {
    useAiInvocationStore.getState().tryStart("req-old");
    useAiInvocationStore.getState().cancel();
    useAiInvocationStore.getState().tryStart("req-new");

    useAiInvocationStore.getState().setError("old provider blew up", "req-old");

    expect(useAiInvocationStore.getState().isRunning).toBe(true);
    expect(useAiInvocationStore.getState().requestId).toBe("req-new");
    expect(useAiInvocationStore.getState().error).toBeNull();
  });

  it("setError() for the live request still reports it", () => {
    useAiInvocationStore.getState().tryStart("req-1");
    useAiInvocationStore.getState().setError("rate limited", "req-1");
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    expect(useAiInvocationStore.getState().error).toBe("rate limited");
  });

  // Callers with no request of their own — provider validation, a cancel that
  // could not reach Rust — report against whatever is current, unchanged.
  it("an unscoped setError() still reports, as before", () => {
    useAiInvocationStore.getState().setError("no provider configured");
    expect(useAiInvocationStore.getState().error).toBe("no provider configured");
  });
});
