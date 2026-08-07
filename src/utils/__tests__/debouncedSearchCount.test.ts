// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("createDebouncedSearchCounter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exists and returns an object with schedule and cancel", async () => {
    const { createDebouncedSearchCounter } = await import("../debouncedSearchCount");
    const counter = createDebouncedSearchCounter(vi.fn());
    expect(counter.schedule).toBeTypeOf("function");
    expect(counter.cancel).toBeTypeOf("function");
  });

  it("does not invoke callback immediately", async () => {
    const { createDebouncedSearchCounter } = await import("../debouncedSearchCount");
    const callback = vi.fn();
    const counter = createDebouncedSearchCounter(callback);

    counter.schedule("hello world", "hello", false, false, false);

    expect(callback).not.toHaveBeenCalled();
  });

  it("invokes callback after 300ms", async () => {
    const { createDebouncedSearchCounter } = await import("../debouncedSearchCount");
    const callback = vi.fn();
    const counter = createDebouncedSearchCounter(callback);

    counter.schedule("hello world", "hello", false, false, false);

    vi.advanceTimersByTime(300);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("uses latest args when coalescing rapid calls", async () => {
    const { createDebouncedSearchCounter } = await import("../debouncedSearchCount");
    const callback = vi.fn();
    const counter = createDebouncedSearchCounter(callback);

    counter.schedule("version1", "v1", false, false, false);
    counter.schedule("version2", "v2", false, false, false);
    counter.schedule("version3", "v3", false, false, false);

    vi.advanceTimersByTime(300);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("version3", "v3", false, false, false);
  });

  it("cancel prevents pending invocation", async () => {
    const { createDebouncedSearchCounter } = await import("../debouncedSearchCount");
    const callback = vi.fn();
    const counter = createDebouncedSearchCounter(callback);

    counter.schedule("hello", "hello", false, false, false);
    counter.cancel();

    vi.advanceTimersByTime(300);
    expect(callback).not.toHaveBeenCalled();
  });
});
