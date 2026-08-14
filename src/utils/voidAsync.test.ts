// @vitest-environment node
/**
 * The contract has three halves worth pinning: the wrapper returns void (so it
 * fits a void-typed slot), arguments survive (the regression that a naive
 * `() => void fn()` wrapper causes), and NOTHING is swallowed — an async
 * rejection and a synchronous throw both reach `onError`.
 */
import { describe, it, expect, vi } from "vitest";
import { voidAsync } from "./voidAsync";

describe("voidAsync", () => {
  it("returns undefined so it fits a void-typed callback slot", () => {
    const wrapped = voidAsync(async () => "ignored", vi.fn());
    expect(wrapped()).toBeUndefined();
  });

  it("passes every argument through", async () => {
    const fn = vi.fn(async (_a: string, _b: number) => {});
    voidAsync(fn, vi.fn())("x", 7);
    await Promise.resolve();
    expect(fn).toHaveBeenCalledWith("x", 7);
  });

  it("routes an async rejection to onError", async () => {
    const onError = vi.fn();
    const boom = new Error("async boom");
    voidAsync(async () => { throw boom; }, onError)();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it("routes a SYNCHRONOUS throw to onError too", () => {
    // A handler that throws before its first await would otherwise escape to a
    // caller that is, for an event listener, nobody.
    const onError = vi.fn();
    const boom = new Error("sync boom");
    expect(() => voidAsync(() => { throw boom; }, onError)()).not.toThrow();
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it("does not call onError when the handler resolves", async () => {
    const onError = vi.fn();
    voidAsync(async () => "fine", onError)();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it("accepts a synchronous handler without requiring a promise", async () => {
    const onError = vi.fn();
    const fn = vi.fn(() => 1);
    voidAsync(fn, onError)();
    await Promise.resolve();
    expect(fn).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a non-Error rejection value unchanged", async () => {
    const onError = vi.fn();
    voidAsync(async () => { throw "a string"; }, onError)();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith("a string");
  });
});
