// Self-test for the `check:fast` tier selector.
//
// One property, and it is the one that fails SILENTLY: `test-changed.mjs`
// decides whether to run the gate tier from a hardcoded prefix list, while
// `vitest.gates.config.ts` decides which roots that tier actually owns. If the
// config gains a root the list forgets, a change under it selects no tests and
// `check:fast` still reports green — which is precisely the defect
// `test-changed.mjs` exists to prevent, moved one root along. It happened:
// `e2e/` joined the gate tier and the list did not follow.
//
// This reads both files as TEXT. `test-changed.mjs` spawns vitest at import
// time, so importing it here would recurse; and the vitest config is TypeScript
// with an `import.meta.dirname` dependency, so evaluating it buys nothing the
// literal does not already say.

import { readFileSync, existsSync } from "node:fs";
import { describe, it, expect } from "vitest";

const selector = readFileSync("scripts/test-changed.mjs", "utf8");
const gatesConfig = readFileSync("vitest.gates.config.ts", "utf8");

/** The prefixes `test-changed.mjs` treats as gate-tier paths. */
function declaredPrefixes() {
  const match = selector.match(/const GATE_PREFIXES = \[([^\]]*)\]/);
  if (!match) throw new Error("GATE_PREFIXES literal not found in test-changed.mjs");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** The roots `vitest.gates.config.ts` includes, e.g. `scripts`, `e2e`. */
function tierRoots() {
  const include = gatesConfig.match(/include:\s*\[([^\]]*)\]/);
  if (!include) throw new Error("include array not found in vitest.gates.config.ts");
  const roots = [...include[1].matchAll(/testGlob\("([^"]+)"\)/g)].map((m) => m[1]);
  if (roots.length === 0) {
    throw new Error("no testGlob(...) roots parsed — the config's shape changed");
  }
  return roots;
}

describe("test-changed gate-tier selection", () => {
  it("parses both files (the derivation itself must not silently degrade)", () => {
    expect(declaredPrefixes().length).toBeGreaterThan(0);
    expect(tierRoots().length).toBeGreaterThan(0);
  });

  it("selects the gate tier for every root that tier owns", () => {
    const prefixes = declaredPrefixes();
    const unselectable = tierRoots().filter(
      (root) => !prefixes.some((p) => `${root}/`.startsWith(p)),
    );
    expect(
      unselectable,
      "these roots are in the gate tier but no GATE_PREFIXES entry selects them — " +
        "a change under one runs NO tests and check:fast still reports green",
    ).toEqual([]);
  });

  it("carries no prefix that matches neither a tier root nor a real config file", () => {
    // The other direction: a stale prefix runs the whole gate tier on changes
    // that cannot affect it, which is how a fast loop stops being fast.
    //
    // Two kinds of entry are legitimate. A ROOT prefix (`scripts/`) covers the
    // tier's test files. A FILE entry covers configuration the tier's behaviour
    // depends on but which lives outside every root — `vitest.gates.config.ts`
    // decides what the tier runs at all. A file entry must actually exist, or
    // it is a prefix aimed at nothing, which is the stale case in disguise.
    const roots = tierRoots();
    const stale = declaredPrefixes().filter((p) => {
      if (roots.some((root) => `${root}/`.startsWith(p))) return false;
      if (!p.endsWith("/") && existsSync(p)) return false;
      return true;
    });
    expect(
      stale,
      "these GATE_PREFIXES entries match no gate-tier root and name no existing file",
    ).toEqual([]);
  });

  // Audit finding #17. The prefixes were test-ROOT directories only, so editing
  // the gate tier's own config — which decides what that tier RUNS — selected
  // no gate tests at all and still reported green. This branch edited
  // `vitest.gates.config.ts`, which is exactly the case.
  it("selects the gate tier when the gate tier's own config changes", () => {
    const prefixes = declaredPrefixes();
    for (const f of ["vitest.gates.config.ts", "vitest.shared.ts"]) {
      expect(
        prefixes.some((p) => f.startsWith(p)),
        `changing ${f} would run NO gate tests while check:fast reports green`,
      ).toBe(true);
    }
  });

  it("names the prefixes in its skip message instead of restating them", () => {
    // The message used to hardcode "scripts/ or .claude/hooks/", so adding a
    // root left the operator reading a list that was missing one.
    expect(selector).toContain("GATE_PREFIXES.join(");
  });
});
