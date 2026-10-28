// @vitest-environment node
// WI-AL2.0j — `settleWithin` charges a stalled event loop like `withJournalDeadline` does: a value that settles after the deadline by the monotonic clock is refused (`null`) even when it beat the timer, and one inside the deadline is kept
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settleWithin } from "../journalDeadline";

// The deadline's timer never fires in these cases; fake timers keep it from
// outliving the test. `performance.now` is spied after, so each case sets it.
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("settleWithin", () => {
  it("refuses a value that lands after the deadline, though its timer has not fired", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    let resolve!: (v: string) => void;
    const running = new Promise<string>((r) => (resolve = r));
    const settled = settleWithin(running, 100);
    now = 250; // the loop was blocked past the deadline before the value arrived
    resolve("late");
    await expect(settled).resolves.toBeNull();
  });

  it("keeps a value that lands inside the deadline", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const settled = settleWithin(Promise.resolve("ok"), 100);
    now = 100;
    await expect(settled).resolves.toEqual({ value: "ok" });
  });

  it("passes a rejection through unchanged", async () => {
    const boom = new Error("boom");
    await expect(settleWithin(Promise.reject(boom), 100)).rejects.toBe(boom);
  });
});
