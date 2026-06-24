import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerActiveWysiwygFlusher,
  registerWysiwygFlusher,
  flushActiveWysiwygNow,
  flushAllWysiwygNow,
} from "./wysiwygFlush";

describe("wysiwygFlush", () => {
  beforeEach(() => {
    // Reset flushers between tests
    registerActiveWysiwygFlusher(null);
    registerWysiwygFlusher("a", null);
    registerWysiwygFlusher("b", null);
  });

  it("calls the registered flusher", () => {
    const flusher = vi.fn();
    registerActiveWysiwygFlusher(flusher);

    flushActiveWysiwygNow();

    expect(flusher).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no flusher is registered", () => {
    // Should not throw
    expect(() => flushActiveWysiwygNow()).not.toThrow();
  });

  it("does nothing when flusher is set to null", () => {
    const flusher = vi.fn();
    registerActiveWysiwygFlusher(flusher);
    registerActiveWysiwygFlusher(null);

    flushActiveWysiwygNow();

    expect(flusher).not.toHaveBeenCalled();
  });

  it("replaces the previous flusher", () => {
    const first = vi.fn();
    const second = vi.fn();

    registerActiveWysiwygFlusher(first);
    registerActiveWysiwygFlusher(second);

    flushActiveWysiwygNow();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("flushAllWysiwygNow", () => {
  beforeEach(() => {
    registerWysiwygFlusher("a", null);
    registerWysiwygFlusher("b", null);
  });

  it("flushes every registered keyed flusher (not just the focused one)", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerWysiwygFlusher("a", a);
    registerWysiwygFlusher("b", b);

    flushAllWysiwygNow();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("does not flush an unregistered (null) flusher", () => {
    const a = vi.fn();
    registerWysiwygFlusher("a", a);
    registerWysiwygFlusher("a", null);

    flushAllWysiwygNow();

    expect(a).not.toHaveBeenCalled();
  });

  it("continues flushing the rest when one flusher throws", () => {
    const a = vi.fn(() => {
      throw new Error("boom");
    });
    const b = vi.fn();
    registerWysiwygFlusher("a", a);
    registerWysiwygFlusher("b", b);

    expect(() => flushAllWysiwygNow()).not.toThrow();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no keyed flushers are registered", () => {
    expect(() => flushAllWysiwygNow()).not.toThrow();
  });
});
