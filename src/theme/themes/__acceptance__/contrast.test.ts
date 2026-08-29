// @vitest-environment node
// WI-UI1.2 + WI-UI1.4 — the catalog clears the WHOLE contrast matrix (R1).
/**
 * `pnpm lint:theme-contrast` is the gate, but it lives in `check:static`,
 * which a docs-only PR skips — this asserts the same property inside
 * `test:coverage`, importing the same measurement the gate runs so the two
 * cannot disagree. ZERO findings beyond the reasoned D10 floors/exemptions:
 * text, semantic, alert, media, blends, contrast-text, surface ramp, the
 * terminal ANSI matrix, and the bright-row Δ rule.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { contrastFindings, type ContrastBaseline } from "../../../../scripts/check-theme-contrast";
import { themes } from "../index";

describe("catalog contrast acceptance (R1)", () => {
  it("zero findings across all six themes", () => {
    const baseline = JSON.parse(
      readFileSync("scripts/theme-contrast-baseline.json", "utf8"),
    ) as ContrastBaseline;
    // Floors/exempt apply (D10); the failing lists do NOT — this asserts the
    // tree itself, not the frozen debt.
    const { findings, problems } = contrastFindings(themes, {
      ansiFloor: baseline.ansiFloor ?? {},
      exempt: baseline.exempt ?? {},
    });
    expect(problems).toEqual([]);
    expect(findings.map((f) => `${f.theme} ${f.id} ${f.ratio}`)).toEqual([]);
  });
});
