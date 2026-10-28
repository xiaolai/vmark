// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerActiveWysiwygFlusher,
  registerWysiwygFlusher,
  flushActiveWysiwygNow,
  flushAllWysiwygNow,
  flushWysiwygNow,
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

  it("reports which editors failed to flush, and only those", () => {
    registerWysiwygFlusher("a", () => {
      throw new Error("boom");
    });
    registerWysiwygFlusher("b", vi.fn());

    const failed = flushAllWysiwygNow();

    expect([...failed.keys()]).toEqual(["a"]);
    expect(failed.get("a")).toBeInstanceOf(Error);
  });

  it("does nothing when no keyed flushers are registered", () => {
    expect(() => flushAllWysiwygNow()).not.toThrow();
  });

  describe("flushWysiwygNow — one editor, failures reported", () => {
    it("runs only the named editor's flusher", () => {
      const a = vi.fn();
      const b = vi.fn();
      registerWysiwygFlusher("a", a);
      registerWysiwygFlusher("b", b);

      flushWysiwygNow("a");

      expect(a).toHaveBeenCalledTimes(1);
      expect(b).not.toHaveBeenCalled();
    });

    it("rethrows the flusher's error instead of swallowing it", () => {
      registerWysiwygFlusher("a", () => {
        throw new Error("serializer crashed");
      });

      expect(() => flushWysiwygNow("a")).toThrow("serializer crashed");
    });

    it.each([
      ["never registered", () => {}],
      ["unregistered", () => {
        registerWysiwygFlusher("a", vi.fn());
        registerWysiwygFlusher("a", null);
      }],
    ])("throws when the editor's flusher is %s: nothing brought the store up to date", (_label, arrange) => {
      arrange();
      expect(() => flushWysiwygNow("a")).toThrow(/no WYSIWYG flusher/);
    });

    it("does not consult the active flusher", () => {
      const active = vi.fn();
      registerActiveWysiwygFlusher(active);

      expect(() => flushWysiwygNow("a")).toThrow();
      expect(active).not.toHaveBeenCalled();
    });
  });
});
