// WI-UI0.1 — self-test for the catalog contrast gate (C1a–C1f).
/**
 * The gate is tested against SYNTHETIC themes constructed in memory — "a font
 * test that measures real fonts asserts nothing on a machine without the
 * trigger" applies to colours too: the test cannot depend on today's catalog
 * failing, because Phase 1 exists to make it pass.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import type { ThemeTokens } from "../src/theme/tokens";
import {
  parseColor,
  compositeOver,
  contrastRatio,
  contrastFindings,
  compareWithBaseline,
  checkMinimumContrastFloor,
} from "./check-theme-contrast";

/** A synthetic light theme that passes every check in the gate. */
function makeTheme(mutate?: (t: ThemeTokens) => void): ThemeTokens {
  const dark = "#101010";
  const ansiNormal = "#1a1a1a";
  const ansiBright = "#333333"; // max-channel Δ 25 from normal — distinguishable
  const t: ThemeTokens = {
    isDark: false,
    color: {
      bg: { primary: "#ffffff", secondary: "#e0e0e0", tertiary: "#f0f0f0" },
      text: { primary: "#000000", secondary: "#1a1a1a", tertiary: "#555555" },
      accent: { primary: "#0000cc", bg: "rgba(0, 0, 204, 0.1)" },
      contrastText: "white",
      border: "#cccccc",
      controlBorder: "#555555",
      selection: "rgba(0, 0, 204, 0.2)",
      subtle: { bg: "rgba(0, 0, 0, 0.02)", bgHover: "rgba(0, 0, 0, 0.03)" },
      hover: { bg: "rgba(0, 0, 0, 0.04)", strong: "rgba(0, 0, 0, 0.08)" },
      strong: dark,
      emphasis: dark,
      semantic: {
        error: dark,
        errorBg: "#ffeeee",
        errorHover: dark,
        warning: dark,
        warningBg: "rgba(0, 0, 0, 0.1)",
        warningBorder: "rgba(0, 0, 0, 0.3)",
        success: dark,
        successHover: dark,
      },
      alert: { note: dark, tip: dark, important: dark, warning: dark, caution: dark },
      media: { video: "#555555", audio: "#555555", youtube: "#555555", vimeo: "#555555", bilibili: "#555555" },
    },
    terminal: {
      ansi: {
        black: ansiNormal, red: ansiNormal, green: ansiNormal, yellow: ansiNormal,
        blue: ansiNormal, magenta: ansiNormal, cyan: ansiNormal, white: ansiNormal,
        brightBlack: ansiBright, brightRed: ansiBright, brightGreen: ansiBright, brightYellow: ansiBright,
        brightBlue: ansiBright, brightMagenta: ansiBright, brightCyan: ansiBright, brightWhite: ansiBright,
      },
      cursor: "#000000",
      cursorAccent: "#ffffff",
    },
    syntax: {
      keyword: dark, type: dark, function: dark, property: dark,
      variable: dark, string: dark, number: dark, operator: dark,
      punctuation: dark, comment: dark, escape: dark, constant: dark,
      attribute: dark, tag: dark, link: dark, invalid: dark,
    },
    space: { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 5: "20px", 6: "24px", 8: "32px", 10: "40px" },
    radius: { sm: "4px", md: "6px", lg: "8px", pill: "100px" },
    shadow: { sm: "s", md: "m", popup: "p" },
    font: { sans: "sans-serif", mono: "monospace", ui: "system-ui, sans-serif" },
  };
  mutate?.(t);
  return t;
}

const EMPTY_BASELINE = { failing: {}, ansiFloor: {}, exempt: {} };

describe("colour math", () => {
  it("parses hex, rgb(), rgba() and named colours", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseColor("#0066cc")).toEqual([0, 102, 204, 1]);
    expect(parseColor("rgb(63, 86, 99)")).toEqual([63, 86, 99, 1]);
    expect(parseColor("rgba(0, 102, 204, 0.2)")).toEqual([0, 102, 204, 0.2]);
    expect(parseColor("white")).toEqual([255, 255, 255, 1]);
    expect(parseColor("black")).toEqual([0, 0, 0, 1]);
  });

  it("composites an alpha colour over an opaque background", () => {
    expect(compositeOver([0, 0, 0, 0.5], [255, 255, 255, 1])).toEqual([128, 128, 128]);
    expect(compositeOver([0, 0, 204, 1], [255, 255, 255, 1])).toEqual([0, 0, 204]);
  });

  it("computes WCAG ratios (white/black is 21)", () => {
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 1);
    expect(contrastRatio([102, 102, 102], [255, 255, 255])).toBeCloseTo(5.74, 2);
  });
});

describe("contrastFindings", () => {
  it("a synthetic theme built to pass yields zero findings", () => {
    const { findings, problems } = contrastFindings({ ok: makeTheme() }, EMPTY_BASELINE);
    expect(problems).toEqual([]);
    expect(findings).toEqual([]);
  });

  it("names the failing pair and its ratio when text.secondary drops to ~4.0", () => {
    const t = makeTheme((x) => {
      x.color.text.secondary = "#808080";
    });
    const { findings } = contrastFindings({ bad: t }, EMPTY_BASELINE);
    const hit = findings.filter((f) => f.id === "text.secondary/bg.primary");
    expect(hit).toHaveLength(1);
    expect(hit[0].theme).toBe("bad");
    expect(hit[0].ratio).toBeGreaterThan(3.8);
    expect(hit[0].ratio).toBeLessThan(4.2);
    expect(hit[0].message).toContain("needs 4.5");
    expect(hit[0].message).toContain("text.secondary on bg.primary");
  });

  it("measures accent.bg/selection blends over the COMPOSITED colour, not the raw rgba", () => {
    const t = makeTheme((x) => {
      // Treated as opaque black these would both be ratio 1.0 against black
      // text; composited over white they land where the assertions say.
      x.color.accent.bg = "rgba(0, 0, 0, 0.85)"; // → ~#262626, black text ≈ 1.35:1 (fails)
      x.color.selection = "rgba(0, 0, 0, 0.5)"; // → ~#808080, black text ≈ 5.3:1 (passes)
    });
    const { findings } = contrastFindings({ blend: t }, EMPTY_BASELINE);
    const accentHit = findings.filter((f) => f.id === "text.primary/blend(accent.bg)");
    expect(accentHit).toHaveLength(1);
    expect(accentHit[0].ratio).toBeGreaterThan(1.2); // opaque-black maths would report exactly 1.0
    expect(accentHit[0].ratio).toBeLessThan(1.6);
    expect(findings.filter((f) => f.id === "text.primary/blend(selection)")).toEqual([]);
  });

  it("honours an ansiFloor with a reason and refuses one without", () => {
    const t = makeTheme((x) => {
      x.terminal.ansi.red = "#808080"; // ≈ 3.95:1 on white — fails 4.5, clears a 3.0 floor
    });
    const noFloor = contrastFindings({ th: t }, EMPTY_BASELINE);
    expect(noFloor.findings.some((f) => f.id === "ansi.red/bg.primary")).toBe(true);

    const withReason = contrastFindings(
      { th: t },
      { failing: {}, ansiFloor: { th: { value: 3.0, reason: "fixture floor" } }, exempt: {} },
    );
    expect(withReason.problems).toEqual([]);
    expect(withReason.findings.some((f) => f.id === "ansi.red/bg.primary")).toBe(false);

    const noReason = contrastFindings(
      { th: t },
      { failing: {}, ansiFloor: { th: { value: 3.0, reason: "" } }, exempt: {} },
    );
    expect(noReason.problems.some((p) => p.includes("reason"))).toBe(true);
  });

  it("flags a bright slot indistinguishable from its normal slot (max-channel Δ < 15)", () => {
    const t = makeTheme((x) => {
      x.terminal.ansi.brightRed = x.terminal.ansi.red;
    });
    const { findings } = contrastFindings({ th: t }, EMPTY_BASELINE);
    expect(findings.some((f) => f.id === "ansi.brightRed≈red")).toBe(true);

    const exempted = contrastFindings(
      { th: t },
      { failing: {}, ansiFloor: {}, exempt: { th: [{ id: "ansi.brightRed≈red", reason: "fixture" }] } },
    );
    expect(exempted.findings.some((f) => f.id === "ansi.brightRed≈red")).toBe(false);

    const noReason = contrastFindings(
      { th: t },
      { failing: {}, ansiFloor: {}, exempt: { th: [{ id: "ansi.brightRed≈red", reason: " " }] } },
    );
    expect(noReason.problems.some((p) => p.includes("reason"))).toBe(true);
  });

  it("requires boldTextInBrightColors === false when a bright slot equals a text tier", () => {
    const collide = makeTheme((x) => {
      x.terminal.ansi.brightCyan = x.color.text.secondary;
    });
    const { findings } = contrastFindings({ th: collide }, EMPTY_BASELINE);
    expect(findings.some((f) => f.id === "terminal.boldTextInBrightColors")).toBe(true);

    const declared = makeTheme((x) => {
      x.terminal.ansi.brightCyan = x.color.text.secondary;
      x.terminal.boldTextInBrightColors = false;
    });
    const ok = contrastFindings({ th: declared }, EMPTY_BASELINE);
    expect(ok.findings.some((f) => f.id === "terminal.boldTextInBrightColors")).toBe(false);
  });

  it("measures the syntax block when a theme carries one (C1e self-activates)", () => {
    const t = makeTheme((x) => {
      x.syntax.comment = "#bbbbbb"; // fails 4.5 on white
    });
    const { findings } = contrastFindings({ th: t }, EMPTY_BASELINE);
    expect(findings.some((f) => f.id === "syntax.comment/bg.primary")).toBe(true);
    expect(contrastFindings({ th: makeTheme() }, EMPTY_BASELINE).findings).toEqual([]);
  });

  it("fails the surface ramp when bg.secondary is under 1.15:1 from bg.primary", () => {
    const flat = makeTheme((x) => {
      x.color.bg.secondary = "#fafafa";
    });
    const { findings } = contrastFindings({ th: flat }, EMPTY_BASELINE);
    // The darker text tokens still pass on #fafafa, so the only finding is the ramp.
    expect(findings.some((f) => f.id === "surface-ramp/bg.secondary")).toBe(true);
  });

  it("derives the theme list from the record — a 7th theme is measured with no edit", () => {
    const bad = makeTheme((x) => {
      x.color.text.secondary = "#808080";
    });
    const { findings } = contrastFindings({ ok: makeTheme(), seventh: bad }, EMPTY_BASELINE);
    expect(findings.every((f) => f.theme === "seventh")).toBe(true);
    expect(findings.length).toBeGreaterThan(0);
  });
});

describe("compareWithBaseline", () => {
  const finding = { theme: "th", id: "text.secondary/bg.primary", ratio: 4.0, needed: 4.5, message: "m" };

  it("a finding missing from the baseline is new; a baselined pair that passes is stale", () => {
    const { newFindings, stale } = compareWithBaseline(
      [finding],
      { failing: { th: ["ansi.red/bg.primary"] }, ansiFloor: {}, exempt: {} },
      ["th"],
    );
    expect(newFindings).toHaveLength(1);
    expect(stale).toEqual([{ theme: "th", id: "ansi.red/bg.primary" }]);
  });

  it("a baselined finding is neither new nor stale", () => {
    const { newFindings, stale } = compareWithBaseline(
      [finding],
      { failing: { th: ["text.secondary/bg.primary"] }, ansiFloor: {}, exempt: {} },
      ["th"],
    );
    expect(newFindings).toEqual([]);
    expect(stale).toEqual([]);
  });

  it("a baseline key naming no catalog theme is stale", () => {
    const { stale } = compareWithBaseline([], { failing: { ghost: ["x"] }, ansiFloor: {}, exempt: {} }, ["th"]);
    expect(stale).toEqual([{ theme: "ghost", id: "x" }]);
  });
});

describe("minimumContrastRatio floor assertion (D10)", () => {
  it("accepts >= 4.5, refuses lower, and fails closed when the setting is missing", () => {
    expect(checkMinimumContrastFloor("minimumContrastRatio: 4.5,")).toBeNull();
    expect(checkMinimumContrastFloor("minimumContrastRatio: 4.6,")).toBeNull();
    expect(checkMinimumContrastFloor("minimumContrastRatio: 1,")).toContain("4.5");
    expect(checkMinimumContrastFloor("nothing here")).toContain("could not find");
  });
});

describe("the real tree", () => {
  it("pnpm lint:theme-contrast is green against the committed baseline", () => {
    // Fails on any pair not in the baseline AND on any stale entry, so this
    // asserts the baseline is exactly today's measurement.
    execFileSync(process.execPath, ["--import", "tsx", "scripts/check-theme-contrast.ts"], {
      stdio: "pipe",
    });
  });
});
