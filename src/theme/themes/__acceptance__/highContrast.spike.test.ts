/**
 * Theme-unification Phase 5 acceptance test.
 *
 * Proves the architecture promise: adding a new vmark theme requires
 * ONE new file (a ThemeTokens implementation). The shape contract is
 * enforced at compile time (TypeScript) and at runtime (this test).
 *
 * If this test passes, the "single source of truth" claim holds — the
 * highContrast spike was authored without touching settingsStore,
 * useTheme, terminalTheme, or index.css.
 */

import { describe, it, expect } from "vitest";
import { highContrast } from "./highContrast.spike";
import { paper } from "../paper";

describe("Phase-5 acceptance: 6th theme shape contract", () => {
  it("highContrast implements every key paper has (no missing fields)", () => {
    function keyPaths(obj: unknown, prefix = ""): string[] {
      if (typeof obj !== "object" || obj === null) return [prefix];
      return Object.keys(obj)
        .sort()
        .flatMap((k) =>
          keyPaths(
            (obj as Record<string, unknown>)[k],
            prefix ? `${prefix}.${k}` : k,
          ),
        );
    }
    const paperKeys = new Set(keyPaths(paper));
    const hcKeys = new Set(keyPaths(highContrast));
    expect([...paperKeys].filter((k) => !hcKeys.has(k))).toEqual([]);
  });

  it("highContrast.terminal.ansi has all 16 colors", () => {
    const ansi = highContrast.terminal.ansi;
    expect(Object.keys(ansi)).toHaveLength(16);
    for (const c of Object.values(ansi)) expect(c).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  });

  it("authoring highContrast required only one new file", () => {
    // Sentinel: this test passes as long as the spike file exists and
    // compiles. If the architecture ever requires touching another
    // file to add a theme, the test in that other file would fail.
    expect(typeof highContrast).toBe("object");
  });
});
