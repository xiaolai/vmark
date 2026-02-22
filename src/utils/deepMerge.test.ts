import { describe, it, expect } from "vitest";
import { deepMerge } from "./deepMerge";

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
      name: "skips null source values (preserves default)",
      target: { a: 1 },
      source: { a: null },
      expected: { a: 1 },
    },
    {
      name: "skips undefined source values (preserves default)",
      target: { a: 1 },
      source: { a: undefined },
      expected: { a: 1 },
    },
    {
      name: "replaces arrays wholesale (no partial merge)",
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
    expect(deepMerge(target, source)).toEqual(expected);
  });

  it("deep merges multiple levels", () => {
    const target = { a: { b: { c: 1, d: 2 }, e: 3 } };
    const source = { a: { b: { c: 99 } } };
    expect(deepMerge(target, source)).toEqual({
      a: { b: { c: 99, d: 2 }, e: 3 },
    });
  });

  it("does not merge into array target even if source is object", () => {
    const target = { a: [1, 2] };
    const source = { a: { 0: 99 } };
    expect(deepMerge(target, source)).toEqual({ a: { 0: 99 } });
  });

  it("does not mutate the target", () => {
    const target = { a: { x: 1 } };
    const source = { a: { x: 2 } };
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: { x: 2 } });
    expect(target).toEqual({ a: { x: 1 } });
  });

  it("handles empty source", () => {
    const target = { a: 1, b: 2 };
    expect(deepMerge(target, {})).toEqual({ a: 1, b: 2 });
  });

  it("handles empty target", () => {
    const target = {} as Record<string, unknown>;
    const source = { a: 1 };
    expect(deepMerge(target, source)).toEqual({ a: 1 });
  });

  it("skips null in nested objects (preserves nested default)", () => {
    const target = { settings: { fontSize: 18, theme: "light" } };
    const source = { settings: { fontSize: null, theme: "dark" } };
    expect(deepMerge(target, source)).toEqual({
      settings: { fontSize: 18, theme: "dark" },
    });
  });
});
