import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCleanupWarn = vi.fn();

vi.mock("@/utils/debug", () => ({
  cleanupWarn: (...args: unknown[]) => mockCleanupWarn(...args),
}));

import { safeUnlisten, safeUnlistenAsync, safeUnlistenAll } from "./safeUnlisten";

describe("safeUnlisten", () => {
  it("calls the unlisten function", () => {
    const fn = vi.fn();
    safeUnlisten(fn);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("handles null/undefined without throwing", () => {
    expect(() => safeUnlisten(null)).not.toThrow();
    expect(() => safeUnlisten(undefined)).not.toThrow();
  });

  it("catches errors from the unlisten function", () => {
    const fn = vi.fn(() => {
      throw new Error("cleanup error");
    });
    expect(() => safeUnlisten(fn)).not.toThrow();
  });
});

describe("safeUnlistenAsync", () => {
  beforeEach(() => {
    mockCleanupWarn.mockClear();
  });

  it("resolves the promise and calls the unlisten function", async () => {
    const fn = vi.fn();
    const promise = Promise.resolve(fn);
    safeUnlistenAsync(promise);
    await promise;
    // Allow microtask to complete
    await new Promise((r) => setTimeout(r, 0));
    expect(fn).toHaveBeenCalledOnce();
  });

  it("handles null/undefined without throwing", () => {
    expect(() => safeUnlistenAsync(null)).not.toThrow();
    expect(() => safeUnlistenAsync(undefined)).not.toThrow();
  });

  it("logs a warning when the promise rejects", async () => {
    const error = new Error("listen failed");
    const promise = Promise.reject(error);
    safeUnlistenAsync(promise);
    // Allow microtask to complete
    await new Promise((r) => setTimeout(r, 0));
    expect(mockCleanupWarn).toHaveBeenCalledWith(
      "Listener cleanup failed:",
      "listen failed"
    );
  });

  it("logs stringified error for non-Error rejections", async () => {
    const promise = Promise.reject("string error");
    safeUnlistenAsync(promise);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockCleanupWarn).toHaveBeenCalledWith(
      "Listener cleanup failed:",
      "string error"
    );
  });
});

describe("safeUnlistenAll", () => {
  it("calls all unlisten functions", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    safeUnlistenAll([fn1, fn2]);
    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
  });

  it("returns an empty array", () => {
    const result = safeUnlistenAll([vi.fn()]);
    expect(result).toEqual([]);
  });

  it("continues calling remaining functions even if one throws", () => {
    const fn1 = vi.fn(() => {
      throw new Error("error");
    });
    const fn2 = vi.fn();
    safeUnlistenAll([fn1, fn2]);
    expect(fn2).toHaveBeenCalledOnce();
  });
});
