// WI-AL2.1a — The caller-side deadline check: did a budgeted call settle within its deadline counted from the call, once caller stalls that delayed it are excused, and once every millisecond the library itself spent in its callbacks is charged back to it (the library's own work can never be excused as a caller stall).
//
// Two checks, both required:
//   1. Ordering: the result settles before a control timer armed for the deadline at the call. It
//      catches a library that is slow off the main thread, but anything blocking the main thread
//      delays the control timer too, so alone it is unsound.
//   2. Elapsed minus the EXCUSED stall ≤ deadline + EPSILON_MS. A 1 ms sampler armed when the call
//      RETURNS counts every gap of ≥ STALL_GAP_MS as stall (less one period, so it under-counts).
//      Only stall after the library's own settle point (`due`, a probe timer armed before the call)
//      up to that probe is excused, and only when the settle follows the probe with no sampler tick
//      between: a tick between means the thread was free and the delay was the library's. The gap
//      from the last sample to the caller's continuation is counted the same way, so a stall after
//      the settle (preemption, a GC pause, another `.then`) is excused, not charged.
// Library-owned work: a library that blocks the main thread in a callback that does NOT settle the
// call (a continuation, a dispatch) shows up to the sampler exactly like a caller stall. So the
// library reports `ownMs` — the time it spent in all of its own callbacks after the call returned —
// and that is subtracted from the excuse. Charging all of it errs late, never in time.
// EPSILON_MS = 2: timers run at whole-millisecond resolution and the sampler adds at most 1 ms of
// under-count. OS preemption probes (stopping the process from a child) are not ported: they are
// process-level and belong to a soak run, not the unit tier.
import { expect } from "vitest";
import { COARSE_RESERVE_MS } from "../diffBudget";
import { CPU_CLOCK } from "@/test/cpuClock";

export const WALL_MS = 200;
const EPSILON_MS = 2;
const SAMPLE_MS = 1;
const STALL_GAP_MS = 3;

export interface Timed<R> {
  r: R;
  ms: number;
  stallMs: number;
  dueStallMs: number;
  excusedMs: number;
  late: boolean;
  deadlineMs: number;
}

/** Time `call` from the call itself; `ownMs` reads the library's reported own-callback time. */
export async function timed<R>(call: () => Promise<R>, deadlineMs: number, ownMs: (r: R) => number): Promise<Timed<R>> {
  let late = false;
  let stallMs = 0;
  let dueStallMs = 0;
  let dueAt: number | null = null;
  let ticksAfterDue = 0;
  const t0 = performance.now();
  const due = deadlineMs - COARSE_RESERVE_MS;
  let prev = t0;
  const sample = () => {
    const now = performance.now();
    const gap = now - prev;
    if (gap >= STALL_GAP_MS) {
      stallMs += gap - SAMPLE_MS;
      if (dueAt === null) dueStallMs += Math.max(0, Math.min(gap - SAMPLE_MS, now - t0 - due));
    }
    if (dueAt !== null) ticksAfterDue++;
    prev = now;
  };
  const control = setTimeout(() => (late = true), deadlineMs);
  const probe = setTimeout(() => {
    sample();
    dueAt = prev - t0;
  }, due);
  try {
    const p = call();
    prev = performance.now();
    const sampler = setInterval(sample, SAMPLE_MS);
    try {
      const r = await p;
      const end = performance.now();
      const ms = end - t0;
      // The last gap, from the last sample to this continuation, no tick can see: a stall after the
      // settle (a caller's `.then`, a GC pause, preemption) lands here. It is excused under the same
      // rule as a stall before it — no tick after the probe — and the library's own time is charged
      // back below, so library work in the settling callback still reads late.
      const tail = end - prev;
      if (dueAt !== null && tail >= STALL_GAP_MS) dueStallMs += tail - SAMPLE_MS;
      const stallExcuse = dueAt !== null && ticksAfterDue === 0 ? dueStallMs : 0;
      const excusedMs = Math.max(0, stallExcuse - ownMs(r));
      return { r, ms, stallMs, dueStallMs: stallExcuse, excusedMs, late, deadlineMs };
    } finally {
      clearInterval(sampler);
    }
  } finally {
    clearTimeout(control);
    clearTimeout(probe);
  }
}

export function isInTime(t: Timed<unknown>): boolean {
  return !t.late && t.ms - t.excusedMs <= t.deadlineMs + EPSILON_MS;
}

export function expectInTime(t: Timed<unknown>, what: string): void {
  const own = t.ms - t.excusedMs;
  expect(t.late, `${what} settled after the deadline's own timer (${t.ms.toFixed(1)} ms)`).toBe(false);
  expect(own, `${what} took ${t.ms.toFixed(1)} ms, ${t.excusedMs.toFixed(1)} ms excused`).toBeLessThanOrEqual(t.deadlineMs + EPSILON_MS);
}

/** Block the main thread for `ms` of wall time: a caller stall. */
export function busy(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end);
}

/** Burn `ms` of this thread's CPU: the library's own work, which preemption only lengthens. */
export function busyCpu(ms: number): void {
  const c0 = CPU_CLOCK.readUs();
  while ((CPU_CLOCK.readUs() - c0) / 1000 < ms);
}

/** A caller stall of `ms` starting `atMs` from now. */
export const stalled = (atMs: number, ms: number) =>
  new Promise<void>((resolve) => setTimeout(() => (busy(ms), resolve()), atMs));

export interface StandInResult {
  ownMs: number;
}

/**
 * A library with the real one's timing contract (a timer at deadline − COARSE_RESERVE_MS from the
 * call settles it) and injected slowness: `blockMs` inside the settling callback, `sideMs` in a
 * NON-settling callback starting `sideAt` from the call, reported in `ownMs` unless `hideOwn`.
 */
export function standIn({
  settleAt = WALL_MS - COARSE_RESERVE_MS,
  blockMs = 0,
  sideAt = 0,
  sideMs = 0,
  hideOwn = false,
} = {}): () => Promise<StandInResult> {
  return () => {
    let own = 0;
    const charge = (work: () => void) => {
      const s = performance.now();
      work();
      own += performance.now() - s;
    };
    if (sideMs > 0) setTimeout(() => charge(() => busyCpu(sideMs)), sideAt);
    return new Promise((resolve) =>
      setTimeout(() => {
        charge(() => busyCpu(blockMs));
        resolve({ ownMs: hideOwn ? 0 : own });
      }, settleAt),
    );
  };
}
