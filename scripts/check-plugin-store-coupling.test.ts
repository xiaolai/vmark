/**
 * Tests for the plugin→store coupling ratchet used by
 * scripts/check-plugin-store-coupling.mjs.
 *
 * The gate exists because the 2026-07-25 goal audit
 * (dev-docs/deep-researches/20260725-extension-goal-progress-audit.md) found
 * plugin files importing `@/stores/` went 97 → 98 across a 192-commit refactor
 * whose stated purpose was decoupling. Cross-plugin coupling had a gate and
 * fell 22%; this axis had none and drifted up.
 *
 * A bare global count is not enough: fixing one plugin while a new one is born
 * coupled nets to zero and passes. So the baseline freezes PER UNIT, mirroring
 * scripts/file-size-baseline.json.
 */

import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs module without type declarations
import { findCouplingViolations } from "./check-plugin-store-coupling.mjs";

type Counts = Record<string, number>;
interface Violation {
  unit: string;
  kind: "new" | "grew" | "stale" | "fixed";
  actual: number;
  baseline: number;
}

function check(actual: Counts, baseline: Counts): Violation[] {
  return findCouplingViolations(actual, baseline) as Violation[];
}

describe("findCouplingViolations — the ratchet holds", () => {
  it("passes when every unit exactly matches its baseline", () => {
    expect(check({ codemirror: 20, search: 2 }, { codemirror: 20, search: 2 })).toEqual([]);
  });

  it("passes on an empty codebase with an empty baseline", () => {
    expect(check({}, {})).toEqual([]);
  });
});

describe("findCouplingViolations — growth is blocked", () => {
  it("flags a baselined plugin that gained coupling", () => {
    const v = check({ search: 3 }, { search: 2 });
    expect(v).toEqual([{ unit: "search", kind: "grew", actual: 3, baseline: 2 }]);
  });

  it("flags a plugin that is NEW to the baseline (born coupled)", () => {
    const v = check({ search: 2, brandNew: 1 }, { search: 2 });
    expect(v).toEqual([{ unit: "brandNew", kind: "new", actual: 1, baseline: 0 }]);
  });

  it("catches a net-zero swap — the exact hole a global count would miss", () => {
    // One plugin fixed (-2), another born coupled (+2). Total is unchanged, so a
    // bare count gate passes. Per-unit must fail on both.
    const v = check({ born: 2 }, { fixed: 2 });
    expect(v.map((x) => `${x.unit}:${x.kind}`).sort()).toEqual(["born:new", "fixed:fixed"]);
  });
});

describe("findCouplingViolations — wins must be locked in", () => {
  it("flags a stale baseline when a plugin improved", () => {
    const v = check({ search: 1 }, { search: 2 });
    expect(v).toEqual([{ unit: "search", kind: "stale", actual: 1, baseline: 2 }]);
  });

  it("flags a fully decoupled plugin still listed in the baseline", () => {
    const v = check({}, { search: 2 });
    expect(v).toEqual([{ unit: "search", kind: "fixed", actual: 0, baseline: 2 }]);
  });
});

describe("findCouplingViolations — reporting", () => {
  it("reports every offending unit, not just the first", () => {
    const v = check({ a: 2, b: 1, c: 3 }, { a: 1, b: 1, c: 1 });
    expect(v.map((x) => x.unit)).toEqual(["a", "c"]);
  });

  it("orders violations by unit name so output is stable across runs", () => {
    const v = check({ zeta: 2, alpha: 2 }, { zeta: 1, alpha: 1 });
    expect(v.map((x) => x.unit)).toEqual(["alpha", "zeta"]);
  });

  it("treats a zero count as absent rather than a violation", () => {
    expect(check({ search: 0 }, {})).toEqual([]);
  });
});
