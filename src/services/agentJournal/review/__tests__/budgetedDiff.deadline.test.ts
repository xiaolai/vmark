// WI-AL2.1a — P1-DEADLINE-OWNED-WORK on real timers: the deadline check excuses only caller stalls that delayed the settle or the caller's continuation after it, and charges back every millisecond the library spent in its own callbacks, settling or not; the budgeted diff settles in time at its deadline, and its own dispatch work past the due point is caught as late rather than excused.
// @vitest-environment node
// timer-isolation: intentional real timers — the real deadline timer and real elapsed time are the subject
import { afterEach, describe, expect, it } from "vitest";
import { BudgetedDiff } from "../budgetedDiff";
import { COARSE_RESERVE_MS, type DiffOutcome } from "../diffBudget";
import { busy, busyCpu, expectInTime, isInTime, stalled, standIn, timed, WALL_MS, type StandInResult } from "./deadlineCheck";
import { fakeFactory } from "./fakeDiffWorker";

const DUE = WALL_MS - COARSE_RESERVE_MS;
const own = (r: StandInResult | DiffOutcome) => r.ownMs;

describe("the deadline check itself", () => {
  it("passes an on-time library", async () => {
    expectInTime(await timed(standIn(), WALL_MS, own), "on-time stand-in");
  });

  it("fails a library that does 30 ms of its own work past its due point", async () => {
    expect(isInTime(await timed(standIn({ blockMs: 30 }), WALL_MS, own))).toBe(false);
  });

  it("excuses a caller stall that spans the due point", async () => {
    const stall = stalled(DUE - 5, 40);
    const t = await timed(standIn(), WALL_MS, own);
    await stall;
    expect(t.ms).toBeGreaterThan(WALL_MS);
    expectInTime(t, "on-time stand-in behind a caller stall");
  });

  it("excuses a caller stall between the settle and the caller's continuation", async () => {
    // Stands in for OS preemption or a GC pause after the library settled: no sampler tick can see it.
    const call = standIn();
    const t = await timed(() => {
      const p = call();
      void p.then(() => busy(40));
      return p;
    }, WALL_MS, own);
    expect(t.ms).toBeGreaterThan(WALL_MS);
    expectInTime(t, "on-time stand-in behind a stall after its settle");
  });

  it("still fails 30 ms of library work in the settling callback when a caller stall follows it", async () => {
    const call = standIn({ blockMs: 30 });
    const t = await timed(() => {
      const p = call();
      void p.then(() => busy(10));
      return p;
    }, WALL_MS, own);
    expect(isInTime(t)).toBe(false);
  });

  it("charges library work in a callback that does not settle the call", async () => {
    const t = await timed(standIn({ sideAt: DUE - 5, sideMs: 60 }), WALL_MS, own);
    expect(t.ms).toBeGreaterThan(WALL_MS);
    expect(isInTime(t)).toBe(false);
  });

  it("without the charge the same library would be excused: the hole the charge closes", async () => {
    const t = await timed(standIn({ sideAt: DUE - 5, sideMs: 60, hideOwn: true }), WALL_MS, own);
    expect(t.dueStallMs).toBeGreaterThan(20);
    expect(isInTime(t)).toBe(true);
  });
});

describe("the budgeted diff against the check", () => {
  let lib: BudgetedDiff | null = null;
  afterEach(() => lib?.close());

  const big = (seed: string) => Array.from({ length: 20000 }, (_, i) => `line ${i} ${seed} 😀 甲 שלום`).join("\n");

  it("settles in time with the coarse change when the worker never answers", async () => {
    const f = fakeFactory();
    f.onSpawn = (w) => queueMicrotask(() => w.ready());
    lib = new BudgetedDiff({ factory: f.factory, warn: () => {} });
    lib.warm();
    await new Promise((r) => setTimeout(r, 5));
    const a = big("a");
    const b = a.replace("line 7 a", "line 7 B").replace("line 19000 a", "line 19000 C");
    const t = await timed(() => lib!.diff(a, b), WALL_MS, own);
    expectInTime(t, "budgeted diff");
    expect(t.r).toMatchObject({ mode: "tooComplex", reason: "deadline" });
    expect(t.r.changes).toHaveLength(1);
    expect(f.workers[0].terminated).toBe(true);
  });

  it("settles in time when a caller stall spans its due point", async () => {
    const f = fakeFactory();
    f.onSpawn = (w) => queueMicrotask(() => w.ready());
    lib = new BudgetedDiff({ factory: f.factory, warn: () => {} });
    lib.warm();
    await new Promise((r) => setTimeout(r, 5));
    const stall = stalled(DUE - 5, 40);
    const t = await timed(() => lib!.diff("ab12cd", "aX12Yd"), WALL_MS, own);
    await stall;
    expectInTime(t, "budgeted diff behind a caller stall");
  });

  it("charges its own dispatch work: dispatch that runs across the due point reads late, never excused", async () => {
    const f = fakeFactory();
    lib = new BudgetedDiff({ factory: f.factory, warn: () => {} });
    lib.warm();
    const worker = f.workers[0];
    worker.onPost = () => busyCpu(60); // a structured clone that costs 60 ms on this thread
    setTimeout(() => worker.ready(), DUE - 5);
    const t = await timed(() => lib!.diff("ab", "aX"), WALL_MS, own);
    expect(t.r.ownMs).toBeGreaterThanOrEqual(55);
    expect(t.ms).toBeGreaterThan(WALL_MS);
    expect(isInTime(t)).toBe(false);
  });
});
