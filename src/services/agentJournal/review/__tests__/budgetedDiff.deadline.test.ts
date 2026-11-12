// WI-AL2.1a — P1-DEADLINE-OWNED-WORK, asserted on a controlled clock: the budgeted diff arms its settle timer at the call for `deadlineMs − COARSE_RESERVE_MS`, settles through it before a control timer armed for the deadline at the same moment, never bills a caller stall to itself, and charges every millisecond of its own dispatch work (`ownMs`), so work past the due point reads late instead of being excused. No assertion reads a wall clock, so runner load cannot move it.
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetedDiff } from "../budgetedDiff";
import { COARSE_RESERVE_MS, DIFF_DEADLINE_MS, type DiffOutcome } from "../diffBudget";
import { fakeFactory, type FakeFactory } from "./fakeDiffWorker";

const DUE = DIFF_DEADLINE_MS - COARSE_RESERVE_MS;

let f: FakeFactory;
let lib: BudgetedDiff;
/** The library's clock: it moves only when a test moves it, so "time" is never sampled from the machine. */
let clock = 0;
let readClock = () => clock;

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  readClock = () => clock;
  f = fakeFactory();
  lib = new BudgetedDiff({ factory: f.factory, warn: () => {}, now: () => readClock() });
});
afterEach(() => {
  lib.close();
  vi.useRealTimers();
});

/** Time passes with the thread free: the clock and the timers move together. */
const advance = async (ms: number) => {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
};
/** A caller stall: the clock moves while no timer gets to run. */
const stall = (ms: number) => {
  clock += ms;
};

function track(p: Promise<DiffOutcome>) {
  const box: { value: DiffOutcome | null } = { value: null };
  void p.then((v) => (box.value = v));
  return box;
}

/** A library whose worker is ready and never answers. */
function silentWorker() {
  f.onSpawn = (w) => queueMicrotask(() => w.ready());
  lib.warm();
}

describe("the settle timer", () => {
  it("is armed at the call: nothing settles before the due point, the coarse change settles at it", async () => {
    silentWorker();
    await advance(0);
    const out = track(lib.diff("ab12cd", "aX12Yd"));
    await advance(DUE - 1);
    expect(out.value).toBeNull();
    await advance(1);
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "deadline", elapsedMs: DUE, ownMs: 0 });
    expect(out.value!.changes).toHaveLength(1);
    expect(f.workers[0].terminated).toBe(true);
  });

  it("settles before a control timer armed for the deadline at the same moment", async () => {
    silentWorker();
    await advance(0);
    const order: string[] = [];
    setTimeout(() => order.push("control"), DIFF_DEADLINE_MS);
    void lib.diff("ab12cd", "aX12Yd").then(() => order.push("settled"));
    await advance(DIFF_DEADLINE_MS);
    expect(order).toEqual(["settled", "control"]);
  });

  it("counts from the call, not from when the worker is ready", async () => {
    f.onSpawn = null;
    const out = track(lib.diff("ab12cd", "aX12Yd"));
    await advance(DUE - 1);
    f.workers[0].ready();
    await advance(0);
    expect(out.value).toBeNull();
    expect(f.workers[0].posted).toHaveLength(1);
    await advance(1);
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "deadline" });
  });
});

describe("a caller stall", () => {
  it("that spans the due point delays the settle but is never charged to the library", async () => {
    silentWorker();
    await advance(0);
    const out = track(lib.diff("ab12cd", "aX12Yd"));
    await advance(DUE - 5);
    stall(40);
    await advance(5);
    // The caller observed more than the deadline (DUE + 40 = 220 > 200), and all of the excess is the stall.
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "deadline", elapsedMs: DUE + 40, ownMs: 0 });
    expect(out.value!.elapsedMs).toBeGreaterThan(DIFF_DEADLINE_MS);
  });

  it("before a worker answers does not stop an on-time answer from being accepted", async () => {
    silentWorker();
    await advance(0);
    const out = track(lib.diff("ab12cd", "aX12Yd"));
    await advance(5);
    stall(30); // the answer is handled after a stall: waiting is not the library's work
    f.workers[0].answer();
    await advance(0);
    expect(out.value).toMatchObject({ mode: "exact", dispatched: true, elapsedMs: 35, ownMs: 0 });
  });
});

describe("the library's own work", () => {
  it("in a dispatch that runs across the due point is charged in ownMs and reads late, never excused", async () => {
    const worker = (() => {
      lib.warm();
      return f.workers[0];
    })();
    worker.onPost = () => stall(60); // a structured clone that costs 60 ms on this thread
    const out = track(lib.diff("ab", "aX"));
    await advance(DUE - 5);
    worker.ready();
    await advance(0);
    // Dispatched at DUE − 5 and ended 60 ms later: the 60 ms is its own work, not the 175 ms wait before it.
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "deadline", dispatched: true, ownMs: 60, elapsedMs: DUE - 5 + 60 });
    expect(out.value!.elapsedMs).toBeGreaterThan(DIFF_DEADLINE_MS);
    expect(f.workers[0].terminated).toBe(true);
  });

  it("in the settling callback itself is charged: every clock read there costs time, and the lateness is all ownMs", async () => {
    silentWorker();
    await advance(0);
    const out = track(lib.diff("ab12cd", "aX12Yd"));
    await advance(DUE - 1);
    readClock = () => {
      const at = clock;
      clock += 10;
      return at;
    }; // from here each read of the library's clock costs 10 ms of its own time
    await advance(1);
    const o = out.value!;
    expect(o).toMatchObject({ mode: "tooComplex", reason: "deadline" });
    expect(o.ownMs).toBeGreaterThan(0);
    expect(o.elapsedMs - o.ownMs).toBeLessThanOrEqual(DUE);
    expect(o.elapsedMs).toBeGreaterThan(DUE);
  });

  it("is zero for a call that spent none: equal texts report no own time", async () => {
    const out = await lib.diff("same", "same");
    expect(out).toMatchObject({ mode: "exact", ownMs: 0 });
  });
});
