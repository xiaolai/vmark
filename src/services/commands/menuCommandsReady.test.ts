// @vitest-environment node
/**
 * The barrier that replaced a 100 ms guess.
 *
 * `useWindowReady` used to wait a fixed 100 ms before telling Rust the window
 * was listening. The thing it was waiting for is `useCommandBootstrap`, which
 * `await`s a DYNAMIC IMPORT (`registerPandocFormatCommands`) before it mounts
 * a single menu listener — an unbounded wait that no constant can cover. Under
 * a cold chunk fetch or a loaded machine the delay expires first, Rust is told
 * the window is ready, and the next `menu:open` lands on a listener that does
 * not exist yet.
 *
 * So the signal is now the fact itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  signalMenuCommandsMounted,
  waitForMenuCommands,
  clampWaitBudget,
  resetMenuCommandsForTest,
} from "./menuCommandsReady";

beforeEach(() => {
  resetMenuCommandsForTest();
});

describe("menu-commands readiness barrier", () => {
  it("resolves as soon as the mount signals, without waiting out the budget", async () => {
    const waited = waitForMenuCommands(60_000);
    signalMenuCommandsMounted(true);
    await expect(waited).resolves.toBe(true);
  });

  it("resolves immediately for a waiter that arrives after the signal", async () => {
    // The ordering is not guaranteed: the bootstrap effect can mount before
    // the provider gets round to waiting. A latch that only notifies waiters
    // present at signal time would hang the handshake forever in that case —
    // the failure mode is a window that never reports ready at all.
    signalMenuCommandsMounted(true);
    await expect(waitForMenuCommands(60_000)).resolves.toBe(true);
  });

  it("gives up after the budget rather than hanging", async () => {
    vi.useFakeTimers();
    try {
      const waited = waitForMenuCommands(2_000);
      await vi.advanceTimersByTimeAsync(2_000);
      // FALSE, not a rejection: the caller must still tell Rust the window is
      // ready. A window that never announces itself is unusable; one that
      // announces itself early has, at worst, the old behaviour.
      await expect(waited).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leave a timer running once the signal arrives", async () => {
    vi.useFakeTimers();
    try {
      const waited = waitForMenuCommands(60_000);
      signalMenuCommandsMounted(true);
      await waited;
      // A live 60s timer would keep a test worker (and, in production, the
      // event loop) busy long after the thing it was watching had happened.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves several concurrent waiters from one signal", async () => {
    const all = Promise.all([
      waitForMenuCommands(60_000),
      waitForMenuCommands(60_000),
      waitForMenuCommands(60_000),
    ]);
    signalMenuCommandsMounted(true);
    await expect(all).resolves.toEqual([true, true, true]);
  });

  it("treats a repeated signal as a no-op", async () => {
    signalMenuCommandsMounted(true);
    signalMenuCommandsMounted(true);
    await expect(waitForMenuCommands(60_000)).resolves.toBe(true);
  });

  // Audit #359 (round 3) — the signal carries the OUTCOME, not the mere fact
  // that the mount settled. The bootstrap used to signal in a `finally`, so a
  // mount that threw announced a fully-dead menu as ready and the waiter had
  // no way to tell. A window still has to announce itself either way; what
  // changes is that the announcement is no longer a lie.
  it("reports a mount that failed as NOT mounted, to a waiter present at signal time", async () => {
    const waited = waitForMenuCommands(60_000);
    signalMenuCommandsMounted(false);
    await expect(waited).resolves.toBe(false);
  });

  it("reports a mount that failed as NOT mounted, to a waiter that arrives later", async () => {
    signalMenuCommandsMounted(false);
    await expect(waitForMenuCommands(60_000)).resolves.toBe(false);
  });

  it("keeps the first verdict when a later signal disagrees", async () => {
    // One mount per window, so a second signal is a bug, not a correction —
    // and a `false` overwritten by a stray `true` is exactly the silence this
    // whole barrier exists to remove.
    signalMenuCommandsMounted(false);
    signalMenuCommandsMounted(true);
    await expect(waitForMenuCommands(60_000)).resolves.toBe(false);
  });

  it("reports a timed-out wait as false even if the signal lands later", async () => {
    vi.useFakeTimers();
    try {
      const waited = waitForMenuCommands(2_000);
      await vi.advanceTimersByTimeAsync(2_000);
      signalMenuCommandsMounted(true);
      // The verdict is about what was true when the budget expired. Re-writing
      // it afterwards would make the log claim a wait succeeded that did not.
      await expect(waited).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  // Audit #911 — the reset used to drop pending waiters without settling them,
  // so each one's `setTimeout` outlived the test that created it.
  it("settles pending waiters on reset instead of leaking their timers", async () => {
    vi.useFakeTimers();
    try {
      const waited = waitForMenuCommands(60_000);
      resetMenuCommandsForTest();
      await expect(waited).resolves.toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // Audit #909 — the first verdict still wins, but a second signal that
  // DISAGREES is the double-mount bug the header describes, and it used to
  // leave no trace at all.
  it("reports a disagreeing second signal and keeps the first verdict", async () => {
    const reported: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      reported.push(args);
    });
    try {
      signalMenuCommandsMounted(false);
      signalMenuCommandsMounted(true);
      await expect(waitForMenuCommands(60_000)).resolves.toBe(false);
      expect(reported).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("stays quiet for an agreeing repeat", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      signalMenuCommandsMounted(true);
      signalMenuCommandsMounted(true);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

// Audit #910 — the budget reached `setTimeout` unvalidated. `setTimeout` holds
// the delay in a SIGNED 32-bit int, so a budget above 2^31−1 overflows and the
// timer fires immediately; a negative one fires immediately too. Both turn a
// generous wait into an instant "not ready", which is the guess this barrier
// replaced.
describe("waitForMenuCommands budget clamping (#910)", () => {
  it("clamps a 32-bit overflow down to the largest honourable delay", () => {
    expect(clampWaitBudget(Number.MAX_SAFE_INTEGER)).toBe(2_147_483_647);
    expect(clampWaitBudget(Infinity)).toBe(2_147_483_647);
  });

  it("clamps a negative budget to zero rather than firing on a past deadline", () => {
    expect(clampWaitBudget(-1)).toBe(0);
    expect(clampWaitBudget(-Infinity)).toBe(0);
  });

  it("treats NaN as no budget at all, never as an unbounded wait", () => {
    expect(clampWaitBudget(NaN)).toBe(0);
  });

  it("passes an ordinary budget through untouched", () => {
    expect(clampWaitBudget(2_000)).toBe(2_000);
    expect(clampWaitBudget(0)).toBe(0);
  });

  it("still resolves — not hangs — for a budget beyond the timer's range", async () => {
    vi.useFakeTimers();
    try {
      const waited = waitForMenuCommands(Number.MAX_SAFE_INTEGER);
      signalMenuCommandsMounted(true);
      await expect(waited).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
