/**
 * cssVars tests — ADR-014.
 *
 * Verifies the typed accessor produces the expected `var(--…)` strings
 * that match what `applyTheme()` writes via `tokensToCssEntries()`.
 */

import { describe, it, expect } from "vitest";
import { cssVars, tokensToCssEntries, lightTheme } from "./index";

describe("cssVars", () => {
  it("emits var(--…) strings", () => {
    expect(cssVars.color.bg.primary).toBe("var(--color-bg-primary)");
    expect(cssVars.radius.lg).toBe("var(--radius-lg)");
    expect(cssVars.space[3]).toBe("var(--space-3)");
  });

  it("var names match what applyTheme writes", () => {
    const entries = new Map(tokensToCssEntries(lightTheme));
    // Every value in cssVars is `var(--name)` — strip the wrapper and
    // ensure that name appears in the live theme entries.
    const flat: string[] = [];
    function walk(obj: Record<string, unknown>) {
      for (const v of Object.values(obj)) {
        if (typeof v === "string") flat.push(v);
        else if (v && typeof v === "object") walk(v as Record<string, unknown>);
      }
    }
    walk(cssVars);
    for (const cssVar of flat) {
      const match = /^var\((--[a-z0-9-]+)\)$/.exec(cssVar);
      expect(match, `expected ${cssVar} to be var(--…)`).not.toBeNull();
      if (match) {
        expect(entries.has(match[1]), `expected applyTheme to emit ${match[1]}`).toBe(true);
      }
    }
  });
});
