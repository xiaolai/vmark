// WI-1.3 — matrix expansion tests.
//
// Plan §4.3 expansion rules:
//   1. Cartesian product of dimensions
//   2. include extends matching combos OR appends new ones
//   3. exclude removes matching combos (applied AFTER include)
//   4. 256-combination cap with GHA-MATRIX-001 warning
//   5. expression-valued dimensions → marked dynamic (no static expansion)

import { describe, expect, it } from "vitest";
import { expandMatrix, parseMatrix } from "../matrix";
import type { MatrixIR } from "../../types";

describe("parseMatrix", () => {
  it("parses simple 2-dim matrix", () => {
    const result = parseMatrix({
      os: ["ubuntu-latest", "macos-latest"],
      node: [18, 20],
    });
    expect(result.value?.dimensions).toEqual({
      os: ["ubuntu-latest", "macos-latest"],
      node: [18, 20],
    });
    expect(result.value?.dynamic).toBeFalsy();
  });

  it("parses include and exclude lists", () => {
    const result = parseMatrix({
      os: ["ubuntu-latest"],
      include: [{ os: "macos-latest", extra: "yes" }],
      exclude: [{ os: "ubuntu-latest", node: 16 }],
    });
    expect(result.value?.include).toEqual([{ os: "macos-latest", extra: "yes" }]);
    expect(result.value?.exclude).toEqual([{ os: "ubuntu-latest", node: 16 }]);
  });

  it("flags dynamic matrix when value is an expression string", () => {
    const result = parseMatrix("${{ fromJSON(needs.gen.outputs.matrix) }}");
    expect(result.value?.dynamic).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "GHA-MATRIX-002")).toBe(true);
  });

  it("flags dynamic dimension when one axis is an expression", () => {
    const result = parseMatrix({
      os: "${{ fromJSON(needs.gen.outputs.os) }}",
      node: [18, 20],
    });
    expect(result.value?.dynamic).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "GHA-MATRIX-002")).toBe(true);
  });
});

describe("expandMatrix", () => {
  function mat(input: Partial<MatrixIR>): MatrixIR {
    return {
      dimensions: {},
      ...input,
    };
  }

  it("expands a 1-dimension matrix", () => {
    const r = expandMatrix(mat({ dimensions: { os: ["a", "b", "c"] } }));
    expect(r.combinations).toHaveLength(3);
    expect(r.combinations).toEqual([
      { os: "a" },
      { os: "b" },
      { os: "c" },
    ]);
  });

  it("expands a 2x2 matrix into 4 combinations", () => {
    const r = expandMatrix(mat({ dimensions: { os: ["u", "m"], node: [18, 20] } }));
    expect(r.combinations).toHaveLength(4);
  });

  it("returns dynamic flag when matrix is fully dynamic (no static dims)", () => {
    const r = expandMatrix(mat({ dimensions: {}, dynamic: true }));
    expect(r.dynamic).toBe(true);
    expect(r.combinations).toEqual([]);
  });

  it("expands static dimensions on a partially-dynamic matrix (audit fix)", () => {
    // Cross-validator finding: a matrix with one dynamic dim AND one
    // static dim used to short-circuit and return zero combinations.
    // We now expand the static portion and carry dynamic=true forward.
    const r = expandMatrix(
      mat({
        dimensions: { os: ["ubuntu", "macos"] },
        dynamic: true,
      }),
    );
    expect(r.dynamic).toBe(true);
    expect(r.combinations).toEqual([{ os: "ubuntu" }, { os: "macos" }]);
  });

  it("appends include entries when they don't match existing combos", () => {
    const r = expandMatrix(
      mat({
        dimensions: { os: ["u"] },
        include: [{ os: "m", extra: "yes" }],
      }),
    );
    expect(r.combinations).toHaveLength(2);
    expect(r.combinations).toEqual(
      expect.arrayContaining([
        { os: "u" },
        { os: "m", extra: "yes" },
      ]),
    );
  });

  it("extends matching combos with include's extra keys", () => {
    const r = expandMatrix(
      mat({
        dimensions: { os: ["u", "m"] },
        include: [{ os: "u", extra: "added" }],
      }),
    );
    expect(r.combinations).toEqual(
      expect.arrayContaining([
        { os: "u", extra: "added" },
        { os: "m" },
      ]),
    );
  });

  it("removes combos that match exclude entries", () => {
    const r = expandMatrix(
      mat({
        dimensions: { os: ["u", "m"], node: [18, 20] },
        exclude: [{ os: "u", node: 18 }],
      }),
    );
    expect(r.combinations).toHaveLength(3);
    expect(r.combinations).not.toContainEqual({ os: "u", node: 18 });
  });

  it("applies exclude AFTER include", () => {
    const r = expandMatrix(
      mat({
        dimensions: { os: ["u"] },
        include: [{ os: "m" }],
        exclude: [{ os: "m" }],
      }),
    );
    expect(r.combinations).toEqual([{ os: "u" }]);
  });

  it("caps at 256 combinations and emits GHA-MATRIX-001", () => {
    // 5×5×5×5 = 625 → cap to 256.
    const r = expandMatrix(
      mat({
        dimensions: {
          a: [1, 2, 3, 4, 5],
          b: [1, 2, 3, 4, 5],
          c: [1, 2, 3, 4, 5],
          d: [1, 2, 3, 4, 5],
        },
      }),
    );
    expect(r.combinations).toHaveLength(256);
    expect(r.diagnostics.some((d) => d.code === "GHA-MATRIX-001")).toBe(true);
  });

  it("returns no combinations and no diagnostics for empty dimensions", () => {
    const r = expandMatrix(mat({ dimensions: {} }));
    expect(r.combinations).toEqual([]);
    expect(r.diagnostics).toEqual([]);
  });

  it("handles object-shaped matrix dimension values (deepEqual paths)", () => {
    const r = expandMatrix(
      mat({
        dimensions: {
          config: [
            { name: "small", cpu: 1 },
            { name: "large", cpu: 4 },
          ] as never,
        },
        exclude: [{ config: { name: "large", cpu: 4 } } as never],
      }),
    );
    expect(r.combinations).toHaveLength(1);
  });

  it("handles array-shaped matrix dimension values", () => {
    const r = expandMatrix(
      mat({
        dimensions: { tags: [["a", "b"], ["c", "d"]] as never },
        exclude: [{ tags: ["a", "b"] } as never],
      }),
    );
    expect(r.combinations).toHaveLength(1);
  });

  it("handles deepEqual mismatch on object key sets", () => {
    // Different number of keys → not equal.
    const r = expandMatrix(
      mat({
        dimensions: { config: [{ a: 1, b: 2 }] as never },
        exclude: [{ config: { a: 1 } } as never],
      }),
    );
    expect(r.combinations).toHaveLength(1);
  });
});

describe("parseMatrix edge cases", () => {
  it("returns empty for null/undefined raw", () => {
    expect(parseMatrix(undefined).value).toBeUndefined();
    expect(parseMatrix(null).value).toBeUndefined();
  });

  it("returns empty for non-object non-string raw", () => {
    expect(parseMatrix(42).value).toBeUndefined();
    expect(parseMatrix(true).value).toBeUndefined();
    expect(parseMatrix(["a", "b"]).value).toBeUndefined();
  });

  it("ignores non-array include/exclude values", () => {
    const r = parseMatrix({
      os: ["a"],
      include: "not-an-array",
      exclude: { also: "wrong" },
    });
    expect(r.value?.include).toBeUndefined();
    expect(r.value?.exclude).toBeUndefined();
  });
});
