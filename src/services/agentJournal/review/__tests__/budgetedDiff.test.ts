// WI-AL2.1a — The budgeted diff: the deadline counts from the call (a wait for a ready worker and a wait behind an earlier job are charged to it); at the deadline the worker is terminated and ONE coarse "too complex to split" change is returned; a warm spare takes over; late results from a retired worker are discarded; spawn and worker failures are logged loudly and exposed as status.
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetedDiff } from "../budgetedDiff";
import { COARSE_RESERVE_MS, DIFF_DEADLINE_MS, type DiffOutcome } from "../diffBudget";
import { InvalidTextError } from "../textChanges";
import { fakeFactory, type FakeFactory } from "./fakeDiffWorker";

const SETTLE_AT = DIFF_DEADLINE_MS - COARSE_RESERVE_MS;
let f: FakeFactory;
let warn: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
let lib: BudgetedDiff;

beforeEach(() => {
  vi.useFakeTimers();
  f = fakeFactory();
  warn = vi.fn<(...args: unknown[]) => void>();
  lib = new BudgetedDiff({ factory: f.factory, warn, now: () => Date.now() });
});
afterEach(() => {
  lib.close();
  vi.useRealTimers();
});

/** Track a promise's settlement without awaiting it, so fake time can be stepped past it. */
function track(p: Promise<DiffOutcome>) {
  const box: { value: DiffOutcome | null; error: unknown } = { value: null, error: null };
  p.then((v) => (box.value = v), (e: unknown) => (box.error = e));
  return box;
}
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("exact results", () => {
  it("dispatches to a ready worker and returns its canonical changes", async () => {
    const out = track(lib.diff("a😀b", "a😁b"));
    f.workers[0].ready();
    await flush();
    expect(f.workers[0].posted).toHaveLength(1);
    f.workers[0].answer();
    await flush();
    expect(out.value).toMatchObject({ mode: "exact", changes: [{ fromA: 1, toA: 3, fromB: 1, toB: 3 }], dispatched: true });
    expect(f.workers[0].terminated).toBe(false);
  });

  it("equal texts are no change and never start a worker", async () => {
    await expect(lib.diff("same", "same")).resolves.toMatchObject({ mode: "exact", changes: [], dispatched: false });
    expect(f.workers).toHaveLength(0);
  });

  it("a lone surrogate is INVALID_TEXT before any worker is involved", async () => {
    await expect(lib.diff("a\uD83Db", "ab")).rejects.toBeInstanceOf(InvalidTextError);
    expect(f.workers).toHaveLength(0);
  });

  it("refuses a deadline that leaves no room for the coarse fallback", () => {
    expect(() => lib.diff("a", "b", { deadlineMs: COARSE_RESERVE_MS })).toThrow(RangeError);
    expect(() => lib.diff("a", "b", { deadlineMs: Number.NaN })).toThrow(RangeError);
  });
});

describe("the deadline counts from the call", () => {
  it("terminates a worker still running at the deadline and returns ONE coarse change", async () => {
    const out = track(lib.diff("ab12cd", "aX12Yd"));
    f.workers[0].ready();
    await vi.advanceTimersByTimeAsync(SETTLE_AT - 1);
    expect(out.value).toBeNull();
    expect(f.workers[0].terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "deadline", dispatched: true, changes: [{ fromA: 1, toA: 5, fromB: 1, toB: 5 }] });
    expect(out.value?.elapsedMs).toBe(SETTLE_AT);
    expect(f.workers[0].terminated).toBe(true);
    expect(lib.status().timeouts).toBe(1);
  });

  it("charges the wait for a ready worker to the call", async () => {
    const out = track(lib.diff("ab", "aX"));
    await vi.advanceTimersByTimeAsync(150);
    f.workers[0].ready();
    await flush();
    expect(f.workers[0].posted).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SETTLE_AT - 150);
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "deadline", readyWaitMs: 150, elapsedMs: SETTLE_AT });
  });

  it("a worker that never becomes ready in time is never dispatched to and is not killed", async () => {
    const out = track(lib.diff("ab", "aX"));
    await vi.advanceTimersByTimeAsync(SETTLE_AT);
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "deadline", dispatched: false });
    expect(f.workers[0].posted).toHaveLength(0);
    expect(f.workers[0].terminated).toBe(false);
    // It still serves the next call once warm.
    const next = track(lib.diff("ab", "aY"));
    f.workers[0].ready();
    await flush();
    f.workers[0].answer();
    await flush();
    expect(next.value?.mode).toBe("exact");
  });

  it("charges a wait behind an earlier job to the later call", async () => {
    f.onSpawn = (w) => queueMicrotask(() => w.ready());
    const first = track(lib.diff("ab", "aX"));
    await vi.advanceTimersByTimeAsync(10);
    const second = track(lib.diff("cd", "cY"));
    await vi.advanceTimersByTimeAsync(SETTLE_AT - 10);
    expect(first.value).toMatchObject({ mode: "tooComplex", reason: "deadline", dispatched: true });
    expect(second.value).toBeNull();
    await vi.advanceTimersByTimeAsync(10);
    // Its wait behind the first used up its own deadline, counted from its call.
    expect(second.value).toMatchObject({ mode: "tooComplex", reason: "deadline", elapsedMs: SETTLE_AT });
  });

  it("a queued job whose turn comes in time is dispatched and answered", async () => {
    f.onSpawn = (w) => queueMicrotask(() => w.ready());
    const first = track(lib.diff("ab", "aX"));
    const second = track(lib.diff("cd", "cY"));
    await flush();
    f.workers[0].answer(f.workers[0].posted[0]);
    await flush();
    expect(f.workers[0].posted).toHaveLength(2);
    f.workers[0].answer(f.workers[0].posted[1]);
    await flush();
    expect(first.value?.mode).toBe("exact");
    expect(second.value).toMatchObject({ mode: "exact", changes: [{ fromA: 1, toA: 2, fromB: 1, toB: 2 }] });
  });
});

describe("warm spare and retired workers", () => {
  it("the warm spare takes the next call at once after a kill; its replacement spawns after the coarse result", async () => {
    const settledAtSpawn: boolean[] = [];
    let first: ReturnType<typeof track> | null = null;
    f.onSpawn = (w) => {
      settledAtSpawn.push(first?.value != null);
      queueMicrotask(() => w.ready());
    };
    first = track(lib.diff("ab", "aX"));
    await flush();
    expect(f.workers).toHaveLength(2); // primary + spare
    await vi.advanceTimersByTimeAsync(SETTLE_AT);
    expect(first.value?.mode).toBe("tooComplex");
    // A zero-delay timer set inside a fake-timer callback is due 1 ms later.
    await vi.advanceTimersByTimeAsync(1);
    expect(f.workers).toHaveLength(3);
    // The refill is off the deadline's path: the caller already had its coarse change.
    expect(settledAtSpawn).toEqual([false, false, true]);
    expect(lib.status().respawns).toBe(1);

    const second = track(lib.diff("cd", "cY"));
    await flush();
    expect(f.workers[1].posted).toHaveLength(1);
    f.workers[1].answer();
    await flush();
    expect(second.value?.mode).toBe("exact");
  });

  it("discards a late result from a retired worker", async () => {
    f.onSpawn = (w) => queueMicrotask(() => w.ready());
    const first = track(lib.diff("ab", "aX"));
    await vi.advanceTimersByTimeAsync(SETTLE_AT);
    const late = f.workers[0].posted[0];
    const second = track(lib.diff("ab", "aZ"));
    await flush();
    expect(() => f.workers[0].answer(late)).not.toThrow();
    f.workers[0].error("late crash");
    await flush();
    expect(first.value?.mode).toBe("tooComplex");
    expect(second.value).toBeNull();
    expect(lib.status().workerFailures).toBe(0);
    f.workers[1].answer();
    await flush();
    expect(second.value?.changes).toEqual([{ fromA: 1, toA: 2, fromB: 1, toB: 2 }]);
  });

  it("ignores a result whose id is not the job in flight", async () => {
    f.onSpawn = (w) => queueMicrotask(() => w.ready());
    const out = track(lib.diff("ab", "aX"));
    await flush();
    f.workers[0].emit({ type: "result", id: 999, changes: [] });
    await flush();
    expect(out.value).toBeNull();
    f.workers[0].answer();
    await flush();
    expect(out.value?.mode).toBe("exact");
  });
});

describe("failures are loud and visible in status", () => {
  it("a spawn failure is logged, counted, and the call returns the coarse change", async () => {
    f.throwOnSpawn = new Error("refused by CSP");
    const out = await lib.diff("ab12cd", "aX12Yd");
    expect(out).toMatchObject({ mode: "tooComplex", reason: "workerUnavailable", dispatched: false, changes: [{ fromA: 1, toA: 5, fromB: 1, toB: 5 }] });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/spawn/), expect.stringMatching(/refused by CSP/));
    expect(lib.status()).toMatchObject({ state: "unavailable", spawnFailures: 1, lastSpawnError: "refused by CSP" });
  });

  it("a later call retries the spawn and recovers", async () => {
    f.throwOnSpawn = new Error("transient");
    await lib.diff("ab", "aX");
    f.throwOnSpawn = null;
    f.onSpawn = (w) => queueMicrotask(() => w.ready());
    const out = track(lib.diff("ab", "aY"));
    await flush();
    f.workers[0].answer();
    await flush();
    expect(out.value?.mode).toBe("exact");
    expect(lib.status()).toMatchObject({ state: "ready", spawnFailures: 1 });
  });

  it("an error before ready is a spawn failure: the call goes coarse at once", async () => {
    const out = track(lib.diff("ab", "aX"));
    f.workers[0].error("module failed to load");
    await flush();
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "workerUnavailable", dispatched: false });
    expect(f.workers[0].terminated).toBe(true);
    expect(lib.status()).toMatchObject({ spawnFailures: 1, lastSpawnError: "module failed to load" });
    expect(warn).toHaveBeenCalled();
  });

  it("a worker error mid-job terminates it, goes coarse, and the spare takes over", async () => {
    f.onSpawn = (w) => queueMicrotask(() => w.ready());
    const out = track(lib.diff("ab", "aX"));
    await flush();
    f.workers[0].error("out of memory");
    await flush();
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "workerFailed", dispatched: true });
    expect(f.workers[0].terminated).toBe(true);
    expect(lib.status().workerFailures).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/worker/), expect.stringMatching(/out of memory/));
    const next = track(lib.diff("ab", "aY"));
    await flush();
    f.workers[1].answer();
    await flush();
    expect(next.value?.mode).toBe("exact");
  });

  it("a failed reply goes coarse and keeps the worker", async () => {
    f.onSpawn = (w) => queueMicrotask(() => w.ready());
    const out = track(lib.diff("ab", "aX"));
    await flush();
    f.workers[0].emit({ type: "failed", id: f.workers[0].posted[0].id, message: "boom" });
    await flush();
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "workerFailed" });
    expect(f.workers[0].terminated).toBe(false);
    expect(lib.status().workerFailures).toBe(1);
    expect(warn).toHaveBeenCalled();
  });

  it.each([
    ["non-canonical changes", [{ fromA: 0, toA: 1, fromB: 0, toB: 1 }]],
    ["a malformed change list", "nope"],
  ])("a result with %s is refused as invalidResult", async (_, changes) => {
    f.onSpawn = (w) => queueMicrotask(() => w.ready());
    const out = track(lib.diff("ab", "aX"));
    await flush();
    f.workers[0].emit({ type: "result", id: f.workers[0].posted[0].id, changes });
    await flush();
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "invalidResult", changes: [{ fromA: 1, toA: 2, fromB: 1, toB: 2 }] });
    expect(lib.status().invalidResults).toBe(1);
    expect(warn).toHaveBeenCalled();
  });
});

describe("lifecycle", () => {
  it("warm() starts the primary and the spare before the first call", () => {
    lib.warm();
    expect(f.workers).toHaveLength(2);
    expect(lib.status().state).toBe("starting");
    f.workers[0].ready();
    expect(lib.status().state).toBe("ready");
  });

  it("close() terminates every worker and settles a pending call coarse", async () => {
    const out = track(lib.diff("ab", "aX"));
    lib.close();
    await flush();
    expect(f.workers.every((w) => w.terminated)).toBe(true);
    expect(out.value?.mode).toBe("tooComplex");
    await expect(lib.diff("ab", "aY")).rejects.toThrow(/closed/);
  });

  it("reports the time it spent in its own callbacks after the call returned", async () => {
    f.onSpawn = (w) => queueMicrotask(() => w.ready());
    const out = track(lib.diff("ab", "aX"));
    await flush();
    f.workers[0].answer();
    await flush();
    expect(out.value?.ownMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(out.value?.ownMs)).toBe(true);
  });
});

describe("the deadline is hard", () => {
  it("charges validation to the call: equal texts report the time it took", async () => {
    let clock = 0;
    const timed = new BudgetedDiff({ factory: f.factory, warn, now: () => (clock += 7) });
    // Reads: the call, one per scanned chunk of each text, and the end of validation.
    await expect(timed.diff("same", "same")).resolves.toMatchObject({ mode: "exact", changes: [], elapsedMs: 21 });
    timed.close();
  });

  it("a call whose validation ran past the settle point goes coarse without dispatching", async () => {
    const reads = [0];
    const late = new BudgetedDiff({ factory: f.factory, warn, now: () => reads.shift() ?? SETTLE_AT + 1 });
    f.onSpawn = (w) => queueMicrotask(() => w.ready());
    const out = track(late.diff("ab", "aX"));
    await flush();
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "deadline", dispatched: false });
    expect(f.workers.flatMap((w) => w.posted)).toHaveLength(0);
    late.close();
  });

  it("a result that arrives past the settle point, before the timer runs, is expired, not accepted", async () => {
    let clock = 0;
    const lagging = new BudgetedDiff({ factory: f.factory, warn, now: () => clock });
    f.onSpawn = (w) => queueMicrotask(() => w.ready());
    const out = track(lagging.diff("ab12cd", "aX12Yd"));
    await flush();
    clock = SETTLE_AT;
    f.workers[0].answer();
    expect(out.value).toBeNull();
    await flush();
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "deadline" });
    expect(f.workers[0].terminated).toBe(true);
    lagging.close();
  });
});
