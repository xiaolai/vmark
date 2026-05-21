import { describe, it, expect } from "vitest";
import { structuralEqual } from "./structuralEqual";

describe("structuralEqual", () => {
  // ── Primitives & identity ──────────────────────────────────────────
  it("treats the same reference as equal", () => {
    const o = { a: 1 };
    expect(structuralEqual(o, o)).toBe(true);
  });

  it("compares equal primitives", () => {
    expect(structuralEqual(1, 1)).toBe(true);
    expect(structuralEqual("x", "x")).toBe(true);
    expect(structuralEqual(true, true)).toBe(true);
    expect(structuralEqual(null, null)).toBe(true);
  });

  it("detects differing primitives", () => {
    expect(structuralEqual(1, 2)).toBe(false);
    expect(structuralEqual("a", "b")).toBe(false);
    expect(structuralEqual(true, false)).toBe(false);
  });

  it("treats a primitive and an object as unequal", () => {
    expect(structuralEqual(5, {})).toBe(false);
    expect(structuralEqual({}, 5)).toBe(false);
  });

  it("treats null and an object as unequal in both orders", () => {
    expect(structuralEqual(null, {})).toBe(false);
    expect(structuralEqual({}, null)).toBe(false);
  });

  // ── Objects ────────────────────────────────────────────────────────
  it("treats two empty objects as equal", () => {
    expect(structuralEqual({}, {})).toBe(true);
  });

  it("compares flat objects with equal values", () => {
    expect(structuralEqual({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(true);
  });

  it("detects a changed flat value", () => {
    expect(structuralEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("detects an extra key on the right side", () => {
    expect(structuralEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("detects an extra key on the left side", () => {
    expect(structuralEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it("detects disjoint keys with matching key counts", () => {
    expect(structuralEqual({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
  });

  it("ignores key insertion order", () => {
    expect(structuralEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  // ── Nested objects ─────────────────────────────────────────────────
  it("compares nested objects deeply", () => {
    expect(structuralEqual({ n: { x: 1 } }, { n: { x: 1 } })).toBe(true);
    expect(structuralEqual({ n: { x: 1 } }, { n: { x: 2 } })).toBe(false);
  });

  it("detects an extra key inside a nested object", () => {
    expect(structuralEqual({ n: { x: 1 } }, { n: { x: 1, y: 2 } })).toBe(false);
  });

  it("detects a nested object becoming null", () => {
    expect(structuralEqual({ n: { x: 1 } }, { n: null })).toBe(false);
    expect(structuralEqual({ n: null }, { n: { x: 1 } })).toBe(false);
  });

  // ── Arrays ─────────────────────────────────────────────────────────
  it("compares equal primitive arrays", () => {
    expect(structuralEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(structuralEqual({ a: ["x", "y"] }, { a: ["x", "y"] })).toBe(true);
  });

  it("detects array length differences", () => {
    expect(structuralEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it("detects a changed array element", () => {
    expect(structuralEqual([1, 2], [1, 9])).toBe(false);
  });

  it("compares arrays of objects element-wise", () => {
    expect(structuralEqual([{ x: 1 }], [{ x: 1 }])).toBe(true);
    expect(structuralEqual([{ x: 1 }], [{ x: 2 }])).toBe(false);
  });

  it("treats an array and a plain object as unequal", () => {
    expect(structuralEqual([], {})).toBe(false);
    expect(structuralEqual({}, [])).toBe(false);
  });

  // ── Depth ──────────────────────────────────────────────────────────
  it("compares structures nested three levels deep", () => {
    const make = () => ({ a: { b: [{ c: 1 }] } });
    expect(structuralEqual(make(), make())).toBe(true);
    expect(structuralEqual(make(), { a: { b: [{ c: 2 }] } })).toBe(false);
  });
});
