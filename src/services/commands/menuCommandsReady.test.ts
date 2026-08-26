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
  resetMenuCommandsForTest,
} from "./menuCommandsReady";

beforeEach(() => {
  resetMenuCommandsForTest();
});

describe("menu-commands readiness barrier", () => {
  it("resolves as soon as the mount signals, without waiting out the budget", async () => {
    const waited = waitForMenuCommands(60_000);
    signalMenuCommandsMounted();
    await expect(waited).resolves.toBe(true);
  });

  it("resolves immediately for a waiter that arrives after the signal", async () => {
    // The ordering is not guaranteed: the bootstrap effect can mount before
    // the provider gets round to waiting. A latch that only notifies waiters
    // present at signal time would hang the handshake forever in that case —
    // the failure mode is a window that never reports ready at all.
    signalMenuCommandsMounted();
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
      signalMenuCommandsMounted();
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
    signalMenuCommandsMounted();
    await expect(all).resolves.toEqual([true, true, true]);
  });

  it("treats a repeated signal as a no-op", async () => {
    signalMenuCommandsMounted();
    signalMenuCommandsMounted();
    await expect(waitForMenuCommands(60_000)).resolves.toBe(true);
  });

  it("reports a timed-out wait as false even if the signal lands later", async () => {
    vi.useFakeTimers();
    try {
      const waited = waitForMenuCommands(2_000);
      await vi.advanceTimersByTimeAsync(2_000);
      signalMenuCommandsMounted();
      // The verdict is about what was true when the budget expired. Re-writing
      // it afterwards would make the log claim a wait succeeded that did not.
      await expect(waited).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
