import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatArgs, prodWarn, prodError, createWarnLogger } from "./internals";

describe("formatArgs", () => {
  it("joins primitives with the tag", () => {
    expect(formatArgs("[Tag]", ["hello", 42, true])).toBe("[Tag] hello 42 true");
  });

  it("uses Error.stack when present", () => {
    const e = new Error("oops");
    e.stack = "stacktrace-here";
    expect(formatArgs("[T]", [e])).toBe("[T] stacktrace-here");
  });

  it("falls back to Error.message when stack is missing", () => {
    const e = new Error("only-message");
    e.stack = undefined;
    expect(formatArgs("[T]", [e])).toBe("[T] only-message");
  });

  it("JSON-stringifies plain objects", () => {
    expect(formatArgs("[T]", [{ a: 1 }])).toBe('[T] {"a":1}');
  });

  it("falls back to String() when JSON.stringify throws (circular ref)", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const out = formatArgs("[T]", [a]);
    expect(out.startsWith("[T] ")).toBe(true);
    expect(out).toContain("[object Object]");
  });

  it("renders null as the string 'null'", () => {
    expect(formatArgs("[T]", [null])).toBe("[T] null");
  });
});

describe("prodWarn / prodError (dev branch)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("prodWarn forwards to console.warn", () => {
    prodWarn("[X]", "hello", 1);
    expect(warnSpy).toHaveBeenCalledWith("[X]", "hello", 1);
  });

  it("prodError forwards to console.error", () => {
    prodError("[X]", "boom");
    expect(errSpy).toHaveBeenCalledWith("[X]", "boom");
  });
});

describe("createWarnLogger", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns a callable that prefixes with the tag", () => {
    const log = createWarnLogger("[Thing]");
    expect(typeof log).toBe("function");
    log("hello");
    expect(warnSpy).toHaveBeenCalledWith("[Thing]", "hello");
  });

  it("forwards every argument in order", () => {
    const log = createWarnLogger("[Multi]");
    log("a", 1, { k: "v" });
    expect(warnSpy).toHaveBeenCalledWith("[Multi]", "a", 1, { k: "v" });
  });

  it("does not throw when called with no arguments", () => {
    const log = createWarnLogger("[Empty]");
    expect(() => log()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith("[Empty]");
  });

  it("gives each tag its own independent logger", () => {
    createWarnLogger("[A]")("one");
    createWarnLogger("[B]")("two");
    expect(warnSpy).toHaveBeenNthCalledWith(1, "[A]", "one");
    expect(warnSpy).toHaveBeenNthCalledWith(2, "[B]", "two");
  });
});
