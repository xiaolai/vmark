/**
 * Structural equality for plain JSON-like values.
 *
 * Compares primitives, plain objects, and arrays by value, recursing into
 * nested structures. Two values are equal when they have the same shape and
 * every corresponding leaf is `===`-equal. Object comparison enforces key-set
 * parity, so an extra field on either side makes the values unequal.
 *
 * Scope: plain data only — not `Map`, `Set`, `Date`, `RegExp`, functions, or
 * class instances. Intended for comparing serialisable state snapshots (e.g.
 * cursor-context objects) to suppress no-op store updates.
 *
 * @module utils/structuralEqual
 */

export function structuralEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    return false;
  }

  const aArray = Array.isArray(a);
  const bArray = Array.isArray(b);
  if (aArray !== bArray) return false;

  if (aArray && bArray) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!structuralEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  if (aKeys.length !== Object.keys(bo).length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, key)) return false;
    if (!structuralEqual(ao[key], bo[key])) return false;
  }
  return true;
}
