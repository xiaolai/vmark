import { describe, it, expect } from "vitest";
import { deepMerge } from "./deepMerge";

type R = Record<string, unknown>;

describe("deepMerge", () => {
  it.each([
    {
      name: "overwrites primitive",
      target: { a: 1 },
      source: { a: 2 },
      expected: { a: 2 },
    },
    {
      name: "preserves keys missing from source",
      target: { a: 1, b: 2 },
      source: { a: 3 },
      expected: { a: 3, b: 2 },
    },
    {
      name: "deep merges nested objects",
      target: { a: { x: 1, y: 2 } },
      source: { a: { x: 3 } },
      expected: { a: { x: 3, y: 2 } },
    },
    {
      name: "skips null source value (preserves default)",
      target: { a: 1 },
      source: { a: null },
      expected: { a: 1 },
    },
    {
      name: "skips undefined source value (preserves default)",
      target: { a: 1 },
      source: { a: undefined },
      expected: { a: 1 },
    },
    {
      name: "replaces arrays wholesale",
      target: { a: [1, 2] },
      source: { a: [3] },
      expected: { a: [3] },
    },
    {
      name: "preserves falsy zero",
      target: { a: 1 },
      source: { a: 0 },
      expected: { a: 0 },
    },
    {
      name: "preserves falsy empty string",
      target: { a: "x" },
      source: { a: "" },
      expected: { a: "" },
    },
    {
      name: "preserves falsy false",
      target: { a: true },
      source: { a: false },
      expected: { a: false },
    },
  ])("$name", ({ target, source, expected }) => {
    expect(deepMerge(target as R, source as R)).toEqual(expected);
  });

  it("merges multiple levels deep", () => {
    const target = { a: { b: { c: 1, d: 2 }, e: 3 } };
    const source: R = { a: { b: { c: 10 } } };
    expect(deepMerge(target, source)).toEqual({
      a: { b: { c: 10, d: 2 }, e: 3 },
    });
  });

  it("does not mutate the target", () => {
    const target = { a: 1, b: { c: 2 } };
    const source = { a: 5, b: { c: 9 } };
    const original = JSON.parse(JSON.stringify(target));
    deepMerge(target, source);
    expect(target).toEqual(original);
  });

  it("handles empty source", () => {
    const target = { a: 1, b: 2 };
    expect(deepMerge(target, {})).toEqual({ a: 1, b: 2 });
  });

  it("skips null in nested objects (corrupted localStorage)", () => {
    const target = { settings: { fontSize: 16, theme: "light" } };
    const source: R = { settings: { fontSize: null, theme: "dark" } };
    expect(deepMerge(target, source)).toEqual({
      settings: { fontSize: 16, theme: "dark" },
    });
  });

  it("does not deep merge when target value is not an object", () => {
    const target = { a: "string" };
    const source: R = { a: { nested: true } };
    expect(deepMerge(target, source)).toEqual({ a: { nested: true } });
  });

  it("does not deep merge when source value is an array", () => {
    const target = { a: { x: 1 } };
    const source: R = { a: [1, 2, 3] };
    expect(deepMerge(target, source)).toEqual({ a: [1, 2, 3] });
  });
});
