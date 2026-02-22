import { deepMerge } from "./deepMerge";

describe("deepMerge", () => {
  it.each([
    // Primitive overwrite
    { target: { a: 1 }, source: { a: 2 }, expected: { a: 2 }, name: "overwrites primitive" },

    // Preserves keys not in source
    { target: { a: 1, b: 2 }, source: { a: 3 }, expected: { a: 3, b: 2 }, name: "preserves missing keys" },

    // Deep merge nested objects
    { target: { a: { x: 1, y: 2 } }, source: { a: { x: 3 } }, expected: { a: { x: 3, y: 2 } }, name: "deep merges nested objects" },

    // Null handling — null source values are skipped to preserve defaults
    { target: { a: 1 }, source: { a: null }, expected: { a: 1 }, name: "skips null source value (preserves default)" },

    // Undefined handling — undefined source values are skipped
    { target: { a: 1 }, source: { a: undefined }, expected: { a: 1 }, name: "skips undefined source value" },

    // Array handling — arrays replaced wholesale, not deep merged
    { target: { a: [1, 2] }, source: { a: [3] }, expected: { a: [3] }, name: "replaces arrays wholesale" },
    { target: { a: [1, 2, 3] }, source: { a: [] }, expected: { a: [] }, name: "replaces array with empty array" },

    // Falsy values preserved
    { target: { a: 1 }, source: { a: 0 }, expected: { a: 0 }, name: "preserves falsy zero" },
    { target: { a: "x" }, source: { a: "" }, expected: { a: "" }, name: "preserves falsy empty string" },
    { target: { a: true }, source: { a: false }, expected: { a: false }, name: "preserves falsy false" },

    // Deeply nested (3+ levels)
    {
      target: { a: { b: { c: 1, d: 2 }, e: 3 } },
      source: { a: { b: { c: 9 } } },
      expected: { a: { b: { c: 9, d: 2 }, e: 3 } },
      name: "deep merges 3 levels deep",
    },

    // Source adds new key to nested object (upgrade scenario)
    {
      target: { theme: { fontSize: 16, newDefault: true } },
      source: { theme: { fontSize: 14 } },
      expected: { theme: { fontSize: 14, newDefault: true } },
      name: "preserves new default keys during upgrade",
    },

    // Empty source — target unchanged
    { target: { a: 1, b: 2 }, source: {}, expected: { a: 1, b: 2 }, name: "empty source returns target copy" },

    // Empty target — source values applied
    { target: {}, source: { a: 1 }, expected: { a: 1 }, name: "empty target gains source keys" },

    // Null nested inside source object — skipped at nested level
    {
      target: { a: { x: 1, y: 2 } },
      source: { a: { x: null } },
      expected: { a: { x: 1, y: 2 } },
      name: "skips null in nested source",
    },

    // Array target with object source — source replaces (not deep merged)
    { target: { a: [1] }, source: { a: { x: 1 } }, expected: { a: { x: 1 } }, name: "object source replaces array target" },

    // Object target with array source — source replaces (arrays not deep merged)
    { target: { a: { x: 1 } }, source: { a: [1] }, expected: { a: [1] }, name: "array source replaces object target" },

    // String to number type change
    { target: { a: "hello" }, source: { a: 42 }, expected: { a: 42 }, name: "allows type change from string to number" },
  ])("$name", ({ target, source, expected }) => {
    expect(deepMerge(target, source)).toEqual(expected);
  });

  it("does not mutate target or source", () => {
    const target = { a: { x: 1 }, b: 2 };
    const source = { a: { x: 9 } };
    const targetCopy = JSON.parse(JSON.stringify(target));
    const sourceCopy = JSON.parse(JSON.stringify(source));

    deepMerge(target, source);

    expect(target).toEqual(targetCopy);
    expect(source).toEqual(sourceCopy);
  });
});
