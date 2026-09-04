// @vitest-environment node
// #1357 — the rescan loop: a scan must never restart back to back just because
// an fs event landed while it ran.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRescanScheduler, DEFAULT_RESCAN_TIMING, type RescanTiming } from "./rescanScheduler";

const TIMING: RescanTiming = { quietMs: 400, maxWaitMs: 2_000, gapMs: 1_000, maxGapMs: 8_000 };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A scan that takes `durationMs` and counts its runs. */
function slowScan(durationMs: number) {
  const runs: number[] = [];
  const scan = () =>
    new Promise<void>((resolve) => {
      runs.push(Date.now());
      setTimeout(resolve, durationMs);
    });
  return { scan, runs };
}

describe("rescan scheduler", () => {
  it("a burst of requests is ONE scan, run quietMs after the last request", async () => {
    const { scan, runs } = slowScan(10);
    const s = createRescanScheduler(scan, TIMING);
    for (let i = 0; i < 10; i++) {
      s.request();
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(runs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(TIMING.quietMs);
    expect(runs).toHaveLength(1);
  });

  it("a stream that never goes quiet still gets a scan within maxWaitMs (no starvation)", async () => {
    const { scan, runs } = slowScan(10);
    const s = createRescanScheduler(scan, TIMING);
    const start = Date.now();
    while (runs.length === 0 && Date.now() - start < 10_000) {
      s.request();
      await vi.advanceTimersByTimeAsync(100); // faster than quietMs, forever
    }
    expect(runs).toHaveLength(1);
    expect(runs[0] - start).toBeLessThanOrEqual(TIMING.maxWaitMs + 100);
  });

  it("continuous churn during scans backs off instead of restarting back to back (#1357)", async () => {
    // The reporter's loop: a 3 s scan, events landing every 500 ms — 36 minutes at
    // ~19 scans/minute. Under the scheduler the same input costs a handful.
    const { scan, runs } = slowScan(3_000);
    const s = createRescanScheduler(scan, TIMING);
    const minutes = 5;
    for (let t = 0; t < minutes * 60_000; t += 500) {
      s.request();
      await vi.advanceTimersByTimeAsync(500);
    }
    const backToBack = minutes * 60_000 / 3_000; // ≈ 100 if scans restarted immediately
    expect(runs.length).toBeLessThan(backToBack / 2);
    // Once the gap has doubled to its ceiling, scans are spaced by at least the
    // ceiling plus the scan itself.
    const late = runs.slice(-3);
    for (let i = 1; i < late.length; i++) {
      expect(late[i] - late[i - 1]).toBeGreaterThanOrEqual(TIMING.maxGapMs);
    }
    expect(s.churn()).toBeGreaterThan(0);
  });

  it("the gap doubles per consecutive churny scan and resets after a quiet one", async () => {
    const { scan, runs } = slowScan(100);
    const s = createRescanScheduler(scan, TIMING);
    // t=0: scan 1 runs 0–100; a request at 50 lands DURING it → churn 1, rest gapMs.
    s.refreshNow();
    await vi.advanceTimersByTimeAsync(50);
    s.request();
    await vi.advanceTimersByTimeAsync(60); // t=110, scan 1 over
    expect(s.churn()).toBe(1);
    expect(runs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(900); // t=1010 < 100 + gapMs
    expect(runs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(140); // t=1150: scan 2 started at 1100, runs to 1200
    expect(runs).toHaveLength(2);
    s.request(); // DURING scan 2 → churn 2 → rest 2 × gapMs from 1200
    await vi.advanceTimersByTimeAsync(60); // t=1210
    expect(s.churn()).toBe(2);
    await vi.advanceTimersByTimeAsync(1790); // t=3000 < 1200 + 2000
    expect(runs).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(400); // t=3400: scan 3 started at 3200, ends 3300
    expect(runs).toHaveLength(3);
    // Scan 3 saw nothing: churn resets and the next request is a plain debounce.
    expect(s.churn()).toBe(0);
    s.request();
    await vi.advanceTimersByTimeAsync(TIMING.quietMs + 10);
    expect(runs).toHaveLength(4);
  });

  it("refreshNow runs at once when idle and coalesces into the follow-up while a scan runs", async () => {
    const { scan, runs } = slowScan(500);
    const s = createRescanScheduler(scan, TIMING);
    s.refreshNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toHaveLength(1);
    s.refreshNow();
    s.refreshNow();
    await vi.advanceTimersByTimeAsync(600);
    expect(runs).toHaveLength(1); // still resting: the follow-up obeys the gap
    await vi.advanceTimersByTimeAsync(TIMING.gapMs);
    expect(runs).toHaveLength(2); // exactly one follow-up for the two coalesced requests
  });

  it("a rejected scan still ends the flight and never stops future scheduling", async () => {
    let n = 0;
    const s = createRescanScheduler(async () => {
      n += 1;
      throw new Error("root unreadable");
    }, TIMING);
    s.refreshNow();
    await vi.advanceTimersByTimeAsync(0);
    s.request();
    await vi.advanceTimersByTimeAsync(TIMING.quietMs + 10);
    expect(n).toBe(2);
  });

  it("dispose cancels a pending scan and lets a running one end without a follow-up", async () => {
    const { scan, runs } = slowScan(200);
    const s = createRescanScheduler(scan, TIMING);
    s.request();
    s.dispose();
    await vi.advanceTimersByTimeAsync(TIMING.maxWaitMs + TIMING.quietMs);
    expect(runs).toHaveLength(0);
    const s2 = createRescanScheduler(scan, TIMING);
    s2.refreshNow();
    await vi.advanceTimersByTimeAsync(50);
    s2.request(); // would be a follow-up
    s2.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runs).toHaveLength(1);
  });

  it("refreshNow resolves when the scan that serves it has run — a coalesced caller waits for the follow-up", async () => {
    const { scan, runs } = slowScan(300);
    const s = createRescanScheduler(scan, TIMING);
    let firstDone = false;
    let coalescedDone = false;
    void s.refreshNow().then(() => { firstDone = true; });
    await vi.advanceTimersByTimeAsync(50);
    void s.refreshNow().then(() => { coalescedDone = true; });
    await vi.advanceTimersByTimeAsync(300); // t=350: scan 1 over
    expect(firstDone).toBe(true);
    expect(coalescedDone).toBe(false); // its scan has not run yet
    await vi.advanceTimersByTimeAsync(TIMING.gapMs + 400); // follow-up ran
    expect(runs).toHaveLength(2);
    expect(coalescedDone).toBe(true);
  });

  it("dispose releases every waiting refresh so nothing hangs on a tree that is gone", async () => {
    const { scan } = slowScan(1_000);
    const s = createRescanScheduler(scan, TIMING);
    let done = 0;
    void s.refreshNow().then(() => { done += 1; });
    await vi.advanceTimersByTimeAsync(10);
    void s.refreshNow().then(() => { done += 1; });
    s.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(2);
  });

  it("a scan begins synchronously inside refreshNow (so a caller can invalidate it at once)", () => {
    let started = 0;
    const s = createRescanScheduler(async () => { started += 1; }, TIMING);
    void s.refreshNow();
    expect(started).toBe(1);
  });

  it("the defaults are what the header says", () => {
    expect(DEFAULT_RESCAN_TIMING).toEqual({ quietMs: 400, maxWaitMs: 2_000, gapMs: 1_000, maxGapMs: 30_000 });
  });
});
