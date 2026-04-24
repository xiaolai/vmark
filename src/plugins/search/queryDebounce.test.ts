import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createQueryDebounce } from "./queryDebounce";

describe("createQueryDebounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fire the callback before the delay", () => {
    const fn = vi.fn();
    const d = createQueryDebounce(150);
    d.schedule(fn);
    vi.advanceTimersByTime(149);
    expect(fn).not.toHaveBeenCalled();
  });

  it("fires the callback exactly once at the delay boundary", () => {
    const fn = vi.fn();
    const d = createQueryDebounce(150);
    d.schedule(fn);
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("coalesces rapid schedule calls into a single fire", () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const d = createQueryDebounce(150);
    d.schedule(a);
    vi.advanceTimersByTime(50);
    d.schedule(b);
    vi.advanceTimersByTime(50);
    d.schedule(c);
    vi.advanceTimersByTime(150);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(c).toHaveBeenCalledTimes(1);
  });

  it("flushIfPending runs the pending callback synchronously and clears the timer", () => {
    const fn = vi.fn();
    const d = createQueryDebounce(150);
    d.schedule(fn);
    expect(d.hasPending()).toBe(true);

    const flushed = d.flushIfPending();
    expect(flushed).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(d.hasPending()).toBe(false);

    // Timer should be cancelled — advancing time must not double-fire.
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flushIfPending returns false and is a no-op when nothing is pending", () => {
    // Callers (e.g. the search plugin's nav path) rely on this return value
    // to decide whether they need to dispatch their own work — a missing
    // false return would cause double-dispatch when nothing was scheduled.
    const d = createQueryDebounce(150);
    const flushed = d.flushIfPending();
    expect(flushed).toBe(false);
    expect(d.hasPending()).toBe(false);
  });

  it("flushIfPending fires the pending callback exactly once across schedule + flush + timer", () => {
    // Regression guard: ensure the timer cannot also fire the callback after
    // a flush. If callers use the return value to suppress their own dispatch,
    // and the timer ALSO ran the callback, the user would still see double work.
    const fn = vi.fn();
    const d = createQueryDebounce(150);
    d.schedule(fn);
    expect(d.flushIfPending()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel clears the pending callback without running it", () => {
    const fn = vi.fn();
    const d = createQueryDebounce(150);
    d.schedule(fn);
    d.cancel();
    expect(d.hasPending()).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("schedule after flushIfPending starts a fresh timer", () => {
    const a = vi.fn();
    const b = vi.fn();
    const d = createQueryDebounce(150);
    d.schedule(a);
    d.flushIfPending();
    expect(a).toHaveBeenCalledTimes(1);

    d.schedule(b);
    vi.advanceTimersByTime(150);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("schedule after cancel starts a fresh timer", () => {
    const a = vi.fn();
    const b = vi.fn();
    const d = createQueryDebounce(150);
    d.schedule(a);
    d.cancel();
    d.schedule(b);
    vi.advanceTimersByTime(150);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("the firing callback can re-schedule itself without infinite recursion", () => {
    // Defensive: a misbehaving callback that re-schedules from inside should
    // not break the controller's invariant (timer is cleared before fire).
    const d = createQueryDebounce(50);
    let fires = 0;
    const fn = vi.fn(() => {
      fires += 1;
      if (fires === 1) d.schedule(fn);
    });
    d.schedule(fn);
    vi.advanceTimersByTime(50);
    expect(fires).toBe(1);
    vi.advanceTimersByTime(50);
    expect(fires).toBe(2);
  });
});
