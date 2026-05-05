// WI-1.3 — matrix parsing + expansion.
//
// Plan §4.3 — deterministic Cartesian × include × exclude with a 256-cap.

import type {
  Diagnostic,
  MatrixIR,
  MatrixObject,
  MatrixValue,
} from "../types";

const MAX_COMBINATIONS = 256;
const EXPR_PATTERN = /\$\{\{\s*[^}]+\}\}/;

function isExpression(v: unknown): boolean {
  return typeof v === "string" && EXPR_PATTERN.test(v);
}

export interface ParseMatrixResult {
  value?: MatrixIR;
  diagnostics: Diagnostic[];
}

/**
 * Normalize a raw `matrix:` block into MatrixIR. The whole block can be an
 * expression (e.g., `matrix: ${{ fromJSON(...) }}`) or any single
 * dimension can be — both cases mark the matrix as dynamic and emit
 * GHA-MATRIX-002. Static dimensions are kept as-is.
 */
export function parseMatrix(raw: unknown): ParseMatrixResult {
  const diagnostics: Diagnostic[] = [];

  if (raw === undefined || raw === null) return { diagnostics };

  // Whole-block expression.
  if (typeof raw === "string") {
    diagnostics.push({
      severity: "warning",
      code: "GHA-MATRIX-002",
      message: "Matrix is a dynamic expression; cannot expand statically.",
    });
    return {
      value: { dimensions: {}, dynamic: true },
      diagnostics,
    };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { diagnostics };
  }

  const obj = raw as Record<string, unknown>;
  const ir: MatrixIR = { dimensions: {} };
  let dynamic = false;

  for (const [key, value] of Object.entries(obj)) {
    if (key === "include") {
      if (Array.isArray(value)) {
        ir.include = value.filter(
          (v): v is MatrixObject =>
            typeof v === "object" && v !== null && !Array.isArray(v),
        ) as MatrixObject[];
      }
      continue;
    }
    if (key === "exclude") {
      if (Array.isArray(value)) {
        ir.exclude = value.filter(
          (v): v is MatrixObject =>
            typeof v === "object" && v !== null && !Array.isArray(v),
        ) as MatrixObject[];
      }
      continue;
    }

    if (isExpression(value)) {
      dynamic = true;
      diagnostics.push({
        severity: "warning",
        code: "GHA-MATRIX-002",
        message: `Matrix dimension "${key}" is a dynamic expression; cannot expand statically.`,
        context: { dim: key },
      });
      continue;
    }

    if (Array.isArray(value)) {
      ir.dimensions[key] = value as MatrixValue[];
    }
  }

  if (dynamic) ir.dynamic = true;
  return { value: ir, diagnostics };
}

export interface ExpandMatrixResult {
  combinations: MatrixObject[];
  dynamic: boolean;
  diagnostics: Diagnostic[];
}

/**
 * Expand a MatrixIR into the concrete combination list per plan §4.3:
 *   1. Cartesian product of `dimensions` axes (including partially-
 *      dynamic matrices: any statically-known dimensions still expand,
 *      with `dynamic=true` flagged so the UI shows the badge).
 *   2. `include` entries: extend matching combo OR append as new.
 *   3. `exclude` entries: remove matching combos (applied AFTER include).
 *   4. Hard cap at 256 combinations with GHA-MATRIX-001.
 *   5. Fully-dynamic matrices (zero static dims and dynamic flag set)
 *      return empty combinations + dynamic=true.
 *
 * Audit note: partially-dynamic matrices used to short-circuit the
 * cartesian product entirely whenever the `dynamic` flag was set,
 * losing information about the static axes. Now we expand whatever
 * static dimensions exist and report `dynamic=true` so the JobNode
 * badge shows "×N (dynamic)" rather than just "dynamic".
 */
export function expandMatrix(matrix: MatrixIR): ExpandMatrixResult {
  const diagnostics: Diagnostic[] = [];

  const dims = Object.entries(matrix.dimensions);
  if (matrix.dynamic && dims.length === 0) {
    return { combinations: [], dynamic: true, diagnostics };
  }
  if (dims.length === 0 && !matrix.include?.length) {
    return { combinations: [], dynamic: false, diagnostics };
  }

  // Cartesian product.
  let combos: MatrixObject[] = [{}];
  for (const [key, values] of dims) {
    const next: MatrixObject[] = [];
    for (const combo of combos) {
      for (const v of values) {
        next.push({ ...combo, [key]: v });
      }
    }
    combos = next;
  }

  // Apply include: extend matching combos OR append new ones.
  if (matrix.include) {
    for (const inc of matrix.include) {
      const matchIdx = combos.findIndex((c) => combosMatch(c, inc));
      if (matchIdx >= 0) {
        combos[matchIdx] = { ...combos[matchIdx], ...inc };
      } else {
        combos.push({ ...inc });
      }
    }
  }

  // Apply exclude AFTER include.
  if (matrix.exclude) {
    combos = combos.filter(
      (c) => !matrix.exclude!.some((ex) => combosMatch(c, ex)),
    );
  }

  // Cap at 256.
  if (combos.length > MAX_COMBINATIONS) {
    diagnostics.push({
      severity: "warning",
      code: "GHA-MATRIX-001",
      message: `Matrix has ${combos.length} combinations; capping to ${MAX_COMBINATIONS} per GitHub Actions limit.`,
      context: { count: combos.length },
    });
    combos = combos.slice(0, MAX_COMBINATIONS);
  }

  // Carry the partial-dynamic flag through. The UI uses this to render
  // "×N dynamic" rather than dropping to the bare "dynamic" badge.
  return {
    combinations: combos,
    dynamic: matrix.dynamic === true,
    diagnostics,
  };
}

/**
 * Returns true when every key in `pattern` is present in `combo` with
 * the same value. Used by both include-extend matching and exclude.
 */
function combosMatch(combo: MatrixObject, pattern: MatrixObject): boolean {
  for (const [k, v] of Object.entries(pattern)) {
    if (!Object.prototype.hasOwnProperty.call(combo, k)) return false;
    if (!deepEqual(combo[k], v)) return false;
  }
  return true;
}

function deepEqual(a: MatrixValue, b: MatrixValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object"
  ) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) =>
      deepEqual(
        (a as MatrixObject)[k],
        (b as MatrixObject)[k],
      ),
    );
  }
  return false;
}
