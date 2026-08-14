// @vitest-environment node
/**
 * The whole point of this helper is one negative property — it must never
 * return "[object Object]" — so that assertion is made directly, over every
 * shape that can reach it, rather than only on the cases that happen to be
 * convenient.
 */
import { describe, it, expect } from "vitest";
import { stringifyUnknown } from "./stringifyUnknown";

describe("stringifyUnknown", () => {
  it.each([
    ["a string", "hello", "hello"],
    ["an empty string", "", ""],
    ["a number", 42, "42"],
    ["zero", 0, "0"],
    ["a negative number", -1.5, "-1.5"],
    ["NaN", Number.NaN, "NaN"],
    ["a boolean", true, "true"],
    ["false", false, "false"],
    ["a bigint", 10n, "10"],
  ])("renders %s", (_label, input, expected) => {
    expect(stringifyUnknown(input)).toBe(expected);
  });

  it("renders null and undefined as empty, not as the words", () => {
    // A field a user reads is better blank than carrying the literal "null".
    expect(stringifyUnknown(null)).toBe("");
    expect(stringifyUnknown(undefined)).toBe("");
  });

  it("renders an Error as its message", () => {
    expect(stringifyUnknown(new Error("boom"))).toBe("boom");
  });

  it("renders a plain object as JSON, never as [object Object]", () => {
    expect(stringifyUnknown({ a: 1, b: "two" })).toBe('{"a":1,"b":"two"}');
  });

  it("renders a nested object as JSON", () => {
    expect(stringifyUnknown({ a: { b: [1, 2] } })).toBe('{"a":{"b":[1,2]}}');
  });

  it("renders an array as JSON rather than comma-joining it", () => {
    // Array.prototype.toString would give "1,2" and lose the structure.
    expect(stringifyUnknown([1, 2])).toBe("[1,2]");
    expect(stringifyUnknown([{ a: 1 }])).toBe('[{"a":1}]');
  });

  it("uses an object's own toString when it has one", () => {
    class Money { toString() { return "£5"; } }
    expect(stringifyUnknown(new Money())).toBe("£5");
    expect(stringifyUnknown(/ab+c/gi)).toBe("/ab+c/gi");
    expect(stringifyUnknown(new URL("https://example.com/x"))).toBe("https://example.com/x");
  });

  it("survives a circular structure instead of throwing", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    // The one case where naming the kind is the honest answer: there is no
    // finite text for a self-referential structure.
    expect(stringifyUnknown(circular)).toBe("[object Object]");
  });

  it("renders symbols and functions readably", () => {
    expect(stringifyUnknown(Symbol("tag"))).toBe("tag");
    expect(stringifyUnknown(Symbol())).toBe("Symbol()");
    expect(stringifyUnknown(function named() {})).toBe("[function named]");
  });

  it("never returns the literal [object Object] for a serialisable object", () => {
    // The regression this helper exists to prevent. A circular object is the
    // one case where the fallback legitimately names the kind.
    const shapes: unknown[] = [
      {}, { a: 1 }, [{}], new Map([["k", "v"]]), new Set([1]),
      Object.create(null) as object,
    ];
    for (const shape of shapes) {
      const out = stringifyUnknown(shape);
      expect(typeof out).toBe("string");
      if (shape !== null && !(shape instanceof Map) && !(shape instanceof Set)) {
        expect(out).not.toBe("[object Object]");
      }
    }
  });
});
