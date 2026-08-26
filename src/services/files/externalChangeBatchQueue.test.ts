// @vitest-environment node
/**
 * The two defects this queue was extracted to fix, plus the invariants that
 * keep them fixed.
 *
 * Both lived inline in `useExternalFileChanges` and neither was testable
 * there: reaching them needed a React lifecycle, a filesystem watcher, and a
 * native dialog that rejects. Pulled out, they are ten lines of arithmetic.
 *
 * @coordinates-with services/files/externalChangeBatchQueue.ts
 * @module services/files/externalChangeBatchQueue.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBatchQueue } from "./externalChangeBatchQueue";

const MS = 300;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Let a chain of awaits inside the queue settle under fake timers. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe("debounce and keying", () => {
  it("collapses repeats of one key into a single item", async () => {
    const process = vi.fn(async () => {});
    const q = createBatchQueue<string>({ debounceMs: MS, process, onError: vi.fn() });

    q.queue("a", "first");
    q.queue("a", "second");
    expect(q.size()).toBe(1);

    vi.advanceTimersByTime(MS);
    await settle();

    expect(process).toHaveBeenCalledWith(["second"]);
  });

  it("batches distinct keys into one call", async () => {
    const process = vi.fn(async () => {});
    const q = createBatchQueue<string>({ debounceMs: MS, process, onError: vi.fn() });

    q.queue("a", "A");
    q.queue("b", "B");
    vi.advanceTimersByTime(MS);
    await settle();

    expect(process).toHaveBeenCalledTimes(1);
    expect(process.mock.calls[0][0]).toEqual(["A", "B"]);
  });

  it("does not fire before the window elapses", () => {
    const process = vi.fn(async () => {});
    const q = createBatchQueue<string>({ debounceMs: MS, process, onError: vi.fn() });

    q.queue("a", "A");
    vi.advanceTimersByTime(MS - 1);
    expect(process).not.toHaveBeenCalled();
  });

  it("cancel() stops the timer but keeps the items", () => {
    const process = vi.fn(async () => {});
    const q = createBatchQueue<string>({ debounceMs: MS, process, onError: vi.fn() });

    q.queue("a", "A");
    q.cancel();
    vi.advanceTimersByTime(MS * 10);

    expect(process).not.toHaveBeenCalled();
    expect(q.size()).toBe(1); // preserved for the next event, not discarded
  });
});

describe("the leaked-timer defect", () => {
  it("never holds more than one live timer, so cancel() can stop everything", async () => {
    // The inline version scheduled from `queueDirtyChange` AND from the
    // `finally` block, the latter overwriting the ref without clearing it. The
    // orphan then fired against a hook that had already unmounted, and cleanup
    // — which knew only the last ref value — could not cancel it.
    let release!: () => void;
    const process = vi.fn(
      () => new Promise<void>((resolve) => { release = resolve; })
    );
    const q = createBatchQueue<string>({ debounceMs: MS, process, onError: vi.fn() });

    q.queue("a", "A");
    expect(vi.getTimerCount()).toBe(1);
    q.queue("a2", "A2"); // re-queueing must replace the timer, not add one
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(MS);
    await settle();

    // A change lands while the first batch is still in the dialog: one timer
    // from queue(), and the `finally` re-schedule must reuse it, not stack.
    q.queue("b", "B");
    release();
    await settle();
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);

    // So cancel() is sufficient — no orphan survives to fire after teardown.
    q.cancel();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(MS * 10);
    await settle();
    expect(process).toHaveBeenCalledTimes(1);
  });

  it("re-schedules instead of re-entering a batch that is still open", async () => {
    let release!: () => void;
    const process = vi.fn(
      () => new Promise<void>((resolve) => { release = resolve; })
    );
    const q = createBatchQueue<string>({ debounceMs: MS, process, onError: vi.fn() });

    q.queue("a", "A");
    vi.advanceTimersByTime(MS);
    await settle();
    expect(process).toHaveBeenCalledTimes(1);

    q.queue("b", "B");
    vi.advanceTimersByTime(MS * 3);
    await settle();
    expect(process).toHaveBeenCalledTimes(1); // still only the open one

    release();
    await settle();
    vi.advanceTimersByTime(MS);
    await settle();

    expect(process).toHaveBeenCalledTimes(2);
    expect(process.mock.calls[1][0]).toEqual(["B"]);
  });
});

describe("the lost-batch defect", () => {
  it("puts the batch back when processing rejects", async () => {
    // The inline version drained the queue BEFORE awaiting `message()`. A
    // dialog rejection reset the guard and logged, but the conflicts were gone
    // — the user was never asked about files that had changed under them.
    const onError = vi.fn();
    const process = vi.fn(async () => { throw new Error("dialog closed"); });
    const q = createBatchQueue<string>({ debounceMs: MS, process, onError });

    q.queue("a", "A");
    vi.advanceTimersByTime(MS);
    await settle();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "dialog closed" }));
    expect(q.size()).toBe(1); // not lost
  });

  it("retries a failed batch once, then holds it for the next event", async () => {
    const process = vi.fn(async () => { throw new Error("nope"); });
    const q = createBatchQueue<string>({ debounceMs: MS, process, onError: vi.fn() });

    q.queue("a", "A");
    vi.advanceTimersByTime(MS);
    await settle();
    expect(process).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(MS);
    await settle();
    expect(process).toHaveBeenCalledTimes(2); // the one automatic retry

    // No endless dialog loop — but the item is still queued, so the next real
    // filesystem event surfaces it.
    vi.advanceTimersByTime(MS * 20);
    await settle();
    expect(process).toHaveBeenCalledTimes(2);
    expect(q.size()).toBe(1);
  });

  it("a fresher item queued during processing survives the requeue", async () => {
    let release!: () => void;
    let reject!: (e: unknown) => void;
    const process = vi.fn(
      () => new Promise<void>((_, rej) => { reject = rej; release = () => rej(new Error("x")); })
    );
    const q = createBatchQueue<string>({ debounceMs: MS, process, onError: vi.fn() });

    q.queue("a", "STALE");
    vi.advanceTimersByTime(MS);
    await settle();

    q.queue("a", "FRESH"); // same key, newer data, arrives mid-dialog
    release();
    void reject;
    await settle();

    vi.advanceTimersByTime(MS);
    await settle();

    // The retry carries FRESH — the requeue must not overwrite it with STALE.
    expect(process.mock.calls[1][0]).toEqual(["FRESH"]);
  });

  it("resets the failure budget after a success", async () => {
    let fail = true;
    const process = vi.fn(async () => { if (fail) throw new Error("once"); });
    const q = createBatchQueue<string>({ debounceMs: MS, process, onError: vi.fn() });

    q.queue("a", "A");
    vi.advanceTimersByTime(MS);
    await settle();

    fail = false;
    vi.advanceTimersByTime(MS);
    await settle();
    expect(process).toHaveBeenCalledTimes(2);

    // Budget restored: a later failure gets its own retry rather than being
    // counted against the earlier one.
    fail = true;
    q.queue("b", "B");
    vi.advanceTimersByTime(MS);
    await settle();
    expect(process).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(MS);
    await settle();
    expect(process).toHaveBeenCalledTimes(4);
  });
});

describe("empty-queue behaviour", () => {
  it("never calls process with an empty batch", async () => {
    const process = vi.fn(async () => {});
    const q = createBatchQueue<string>({ debounceMs: MS, process, onError: vi.fn() });

    q.queue("a", "A");
    vi.advanceTimersByTime(MS);
    await settle();
    expect(process).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(MS * 10);
    await settle();
    expect(process).toHaveBeenCalledTimes(1);
  });
});

// Audit finding #28. `cancel()` clears the timer and keeps the items, which is
// its documented job — but it is also what unmount cleanup called, and it
// cannot stop a batch that is ALREADY running. That batch's `finally`
// re-schedules whenever anything is pending, so a dialog open at unmount
// re-armed a timer after cleanup had cancelled one, and it fired into a
// torn-down hook. This module's header already records fixing that for the
// two-scheduling-path case; the in-flight rearm survived it.
describe("dispose is terminal, unlike cancel", () => {
  it("stops an in-flight batch from re-arming after cleanup", async () => {
    let release!: () => void;
    const process = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const q = createBatchQueue<string>({ debounceMs: MS, process, onError: vi.fn() });

    q.queue("a", "a");
    vi.advanceTimersByTime(MS);
    await settle();
    expect(process).toHaveBeenCalledTimes(1);

    // A change arrives while the batch is still in flight — this is what puts
    // something in `pending` for the `finally` to re-schedule.
    q.queue("b", "b");
    q.dispose();
    release();
    await settle();

    // Nothing may run after dispose, however long the timers are advanced.
    vi.advanceTimersByTime(MS * 10);
    await settle();
    expect(process).toHaveBeenCalledTimes(1);
  });

  it("does not re-arm when an in-flight batch REJECTS after dispose", async () => {
    // The path the latch actually guards. On failure the `catch` puts the
    // drained batch BACK, so `pending` is non-empty again by the time the
    // `finally` runs — and without the latch that `finally` schedules a fresh
    // timer, after cleanup believed it had shut the queue down. A dispose that
    // only emptied the queue would be undone by the very next rejection.
    let reject!: (e: Error) => void;
    const process = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
    const onError = vi.fn();
    const q = createBatchQueue<string>({ debounceMs: MS, process, onError });

    q.queue("a", "a");
    vi.advanceTimersByTime(MS);
    await settle();
    expect(process).toHaveBeenCalledTimes(1);

    q.dispose();
    reject(new Error("dialog closed with the window"));
    await settle();

    vi.advanceTimersByTime(MS * 10);
    await settle();
    expect(process).toHaveBeenCalledTimes(1);
    expect(q.size(), "the catch put the batch back into a disposed queue").toBe(0);
  });

  it("drops queued items, where cancel keeps them", () => {
    const q = createBatchQueue<string>({ debounceMs: MS, process: vi.fn(), onError: vi.fn() });
    q.queue("a", "a");
    expect(q.size()).toBe(1);

    q.cancel();
    expect(q.size(), "cancel keeps items by design").toBe(1);

    q.dispose();
    expect(q.size()).toBe(0);
  });

  it("ignores anything queued after dispose", () => {
    const process = vi.fn(async () => {});
    const q = createBatchQueue<string>({ debounceMs: MS, process, onError: vi.fn() });

    q.dispose();
    q.queue("a", "a");
    vi.advanceTimersByTime(MS * 10);

    expect(q.size()).toBe(0);
    expect(process).not.toHaveBeenCalled();
  });

  it("is idempotent", () => {
    const q = createBatchQueue<string>({ debounceMs: MS, process: vi.fn(), onError: vi.fn() });
    q.queue("a", "a");
    expect(() => { q.dispose(); q.dispose(); }).not.toThrow();
    expect(q.size()).toBe(0);
  });
});
