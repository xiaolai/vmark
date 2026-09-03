// @vitest-environment node
// Audit 2026-09-03 W-06 / D1v2 — the run deadline counts RUNNING time only: the
// clock pauses while an approval prompt is open and counts everything else
// (steps, navigation waits). Driven by an injected `now`, never the wall clock.
import { describe, expect, it } from "vitest";
import { createRunClock } from "./runClock";

function fakeNow(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createRunClock", () => {
  it("starts running and counts elapsed time against the budget", () => {
    const c = fakeNow();
    const clock = createRunClock(120_000, c.now);
    expect(clock.elapsed()).toBe(0);
    expect(clock.remaining()).toBe(120_000);
    c.advance(30_000);
    expect(clock.elapsed()).toBe(30_000);
    expect(clock.remaining()).toBe(90_000);
    expect(clock.expired()).toBe(false);
  });

  it("expires exactly at the budget and never reports negative remaining time", () => {
    const c = fakeNow();
    const clock = createRunClock(1_000, c.now);
    c.advance(999);
    expect(clock.expired()).toBe(false);
    c.advance(1);
    expect(clock.expired()).toBe(true);
    c.advance(5_000);
    expect(clock.remaining()).toBe(0);
    expect(clock.elapsed()).toBe(6_000);
  });

  it("does not count time while paused (an open prompt), and resumes from where it stopped", () => {
    const c = fakeNow();
    const clock = createRunClock(10_000, c.now);
    c.advance(2_000);
    clock.pause();
    expect(clock.paused).toBe(true);
    c.advance(60_000); // the user thinks it over for a minute
    expect(clock.elapsed()).toBe(2_000);
    expect(clock.expired()).toBe(false);
    clock.resume();
    expect(clock.paused).toBe(false);
    c.advance(3_000);
    expect(clock.elapsed()).toBe(5_000);
  });

  it("pause and resume are idempotent", () => {
    const c = fakeNow();
    const clock = createRunClock(10_000, c.now);
    clock.pause();
    clock.pause();
    c.advance(1_000);
    clock.resume();
    clock.resume();
    c.advance(1_000);
    expect(clock.elapsed()).toBe(1_000);
  });

  it("refuses a budget that is not a finite non-negative number", () => {
    expect(() => createRunClock(NaN)).toThrow(RangeError);
    expect(() => createRunClock(-1)).toThrow(RangeError);
    expect(() => createRunClock(Infinity)).toThrow(RangeError);
    expect(() => createRunClock(0)).not.toThrow();
  });

  it("a zero budget is expired from the first tick", () => {
    expect(createRunClock(0, () => 5).expired()).toBe(true);
  });
});
