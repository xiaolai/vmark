import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not invoke before the delay elapses", () => {
    const fn = vi.fn();
    const d = debounce(fn, 150);
    d("a");
    vi.advanceTimersByTime(149);
    expect(fn).not.toHaveBeenCalled();
  });

  it("invokes once at the delay boundary", () => {
    const fn = vi.fn();
    const d = debounce(fn, 150);
    d("a");
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");
  });

  it("coalesces multiple rapid calls into one trailing call with the latest args", () => {
    const fn = vi.fn();
    const d = debounce(fn, 150);
    d("a");
    vi.advanceTimersByTime(50);
    d("b");
    vi.advanceTimersByTime(50);
    d("c");
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
  });

  it("passes multiple arguments through to the wrapped fn", () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d("x", 1, true);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith("x", 1, true);
  });

  describe("cancel", () => {
    it("prevents the pending call", () => {
      const fn = vi.fn();
      const d = debounce(fn, 150);
      d("a");
      expect(d.pending()).toBe(true);
      d.cancel();
      expect(d.pending()).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(fn).not.toHaveBeenCalled();
    });

    it("is a no-op when nothing is pending", () => {
      const fn = vi.fn();
      const d = debounce(fn, 150);
      d.cancel();
      vi.advanceTimersByTime(1000);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe("flush", () => {
    it("invokes immediately with the latest args and clears the timer", () => {
      const fn = vi.fn();
      const d = debounce(fn, 150);
      d("a");
      d("b");
      expect(d.pending()).toBe(true);
      d.flush();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("b");
      expect(d.pending()).toBe(false);
      // Timer is gone — advancing must not fire again.
      vi.advanceTimersByTime(1000);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("is a no-op when nothing is pending", () => {
      const fn = vi.fn();
      const d = debounce(fn, 150);
      d.flush();
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe("fresh window after flush/cancel", () => {
    it("starts a new window after flush", () => {
      const fn = vi.fn();
      const d = debounce(fn, 150);
      d("a");
      d.flush();
      expect(fn).toHaveBeenCalledTimes(1);

      d("b");
      vi.advanceTimersByTime(150);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith("b");
    });

    it("starts a new window after cancel", () => {
      const fn = vi.fn();
      const d = debounce(fn, 150);
      d("a");
      d.cancel();
      d("b");
      vi.advanceTimersByTime(150);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("b");
    });
  });

  it("allows the firing fn to re-schedule itself without infinite recursion", () => {
    const d = debounce(fn, 50);
    let fires = 0;
    function fn() {
      fires += 1;
      if (fires === 1) d();
    }
    d();
    vi.advanceTimersByTime(50);
    expect(fires).toBe(1);
    vi.advanceTimersByTime(50);
    expect(fires).toBe(2);
  });
});
