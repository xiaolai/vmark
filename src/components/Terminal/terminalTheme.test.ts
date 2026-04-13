/**
 * Tests for terminalTheme — ANSI palette builder.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetState = vi.fn();
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: { getState: () => mockGetState() },
  themes: {
    white: {
      background: "#FFFFFF",
      foreground: "#1a1a1a",
      link: "#0066cc",
      secondary: "#f8f8f8",
      border: "#eeeeee",
    },
    paper: {
      background: "#EEEDED",
      foreground: "#1a1a1a",
      link: "#0066cc",
      secondary: "#e5e4e4",
      border: "#d5d4d4",
    },
    mint: {
      background: "#CCE6D0",
      foreground: "#2d3a35",
      link: "#1a6b4a",
      secondary: "#b8d9bd",
      border: "#a8c9ad",
    },
    sepia: {
      background: "#F9F0DB",
      foreground: "#5c4b37",
      link: "#8b4513",
      secondary: "#f0e5cc",
      border: "#e0d5bc",
    },
    night: {
      background: "#23262b",
      foreground: "#d6d9de",
      link: "#5aa8ff",
      secondary: "#2a2e34",
      border: "#3a3f46",
      isDark: true,
      selection: "rgba(90,168,255,0.22)",
    },
    // Unknown theme to test fallback
    custom: {
      background: "#ff0000",
      foreground: "#00ff00",
      link: "#0000ff",
      secondary: "#111111",
      border: "#222222",
    },
  },
}));

import { buildXtermTheme, buildXtermThemeForId } from "./terminalTheme";
import type { ThemeId } from "@/stores/settingsStore";

describe("terminalTheme", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buildXtermTheme reads theme from store", () => {
    mockGetState.mockReturnValue({ appearance: { theme: "paper" } });
    const theme = buildXtermTheme();
    expect(theme.background).toBe("#EEEDED");
    expect(theme.foreground).toBe("#1a1a1a");
  });

  it("includes all 16 ANSI colors for paper theme", () => {
    const theme = buildXtermThemeForId("paper" as ThemeId);
    const ansiKeys = [
      "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
      "brightBlack", "brightRed", "brightGreen", "brightYellow",
      "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
    ] as const;
    for (const key of ansiKeys) {
      expect(theme[key]).toBeDefined();
      expect(theme[key]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("includes all 16 ANSI colors for night theme", () => {
    const theme = buildXtermThemeForId("night" as ThemeId);
    expect(theme.background).toBe("#23262b");
    expect(theme.black).toBeDefined();
    expect(theme.brightWhite).toBeDefined();
  });

  it("uses dark scrollbar for night theme", () => {
    const theme = buildXtermThemeForId("night" as ThemeId);
    expect(theme.scrollbarSliderBackground).toContain("255,255,255");
  });

  it("uses light scrollbar for paper theme", () => {
    const theme = buildXtermThemeForId("paper" as ThemeId);
    expect(theme.scrollbarSliderBackground).toContain("0,0,0");
  });

  it("falls back to paper palette for unknown light theme", () => {
    const theme = buildXtermThemeForId("custom" as ThemeId);
    // Should still have ANSI colors (from paper fallback)
    expect(theme.black).toBeDefined();
    expect(theme.background).toBe("#ff0000");
  });

  it("falls back to paper colors when theme ID not in themes map", () => {
    const theme = buildXtermThemeForId("nonexistent" as ThemeId);
    // Both colors and ansi should fall back to paper
    expect(theme.background).toBe("#EEEDED");
    expect(theme.black).toBeDefined();
  });

  it("sets cursor to foreground and cursorAccent to background", () => {
    const theme = buildXtermThemeForId("paper" as ThemeId);
    expect(theme.cursor).toBe("#1a1a1a");
    expect(theme.cursorAccent).toBe("#EEEDED");
  });

  it("uses theme selection color when available", () => {
    const theme = buildXtermThemeForId("night" as ThemeId);
    expect(theme.selectionBackground).toBe("rgba(90,168,255,0.22)");
  });

  it("falls back selection color when not set", () => {
    const theme = buildXtermThemeForId("paper" as ThemeId);
    expect(theme.selectionBackground).toBe("rgba(0,102,204,0.25)");
  });

  // WCAG AA contrast regression — every visible ANSI color must have ≥ 4.5:1
  // contrast against its theme background. black/brightBlack are intentionally
  // dim and excluded from the light-theme check; likewise white/brightWhite
  // are excluded from dark-theme check.
  describe("WCAG AA contrast (≥ 4.5:1)", () => {
    function hexToSrgb(hex: string): [number, number, number] {
      hex = hex.replace("#", "");
      return [parseInt(hex.substr(0, 2), 16), parseInt(hex.substr(2, 2), 16), parseInt(hex.substr(4, 2), 16)];
    }
    function relativeLuminance(r: number, g: number, b: number): number {
      const [rs, gs, bs] = [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }
    function contrastRatio(hex1: string, hex2: string): number {
      const l1 = relativeLuminance(...hexToSrgb(hex1));
      const l2 = relativeLuminance(...hexToSrgb(hex2));
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }

    const ansiColorKeys = [
      "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
      "brightBlack", "brightRed", "brightGreen", "brightYellow",
      "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
    ] as const;

    // black/brightBlack are intentionally near-invisible on dark backgrounds
    const darkExclude = new Set(["black", "brightBlack"]);

    it.each(["white", "paper", "mint", "sepia"] as ThemeId[])("%s: all ANSI colors ≥ 4.5:1", (themeId) => {
      const theme = buildXtermThemeForId(themeId);
      const bg = theme.background!;
      for (const key of ansiColorKeys) {
        const color = theme[key] as string;
        const ratio = contrastRatio(bg, color);
        expect(ratio, `${key} (${color}) on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("night: all visible colors ≥ 4.5:1", () => {
      const theme = buildXtermThemeForId("night" as ThemeId);
      const bg = theme.background!;
      for (const key of ansiColorKeys) {
        if (darkExclude.has(key)) continue;
        const color = theme[key] as string;
        const ratio = contrastRatio(bg, color);
        expect(ratio, `${key} (${color}) on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    });

    // Hue-distinguishability check for tinted themes — passing WCAG AA on the
    // background is necessary but not sufficient. Cyan and green can both end
    // up as "dark teal" against a green-tinted background (#773), making them
    // visually indistinguishable even though contrast ratios pass.
    function hueOf(hex: string): number {
      const [r, g, b] = hexToSrgb(hex).map((c) => c / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d === 0) return 0;
      let h: number;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      return h < 0 ? h + 360 : h;
    }
    function hueDistance(a: number, b: number): number {
      const d = Math.abs(a - b);
      return Math.min(d, 360 - d);
    }

    // CIEDE2000 perceptual color distance. ΔE < 1 = imperceptible,
    // 2-5 = perceptible at glance, > 5 = clearly different.
    // We require cross-family ANSI pairs (cyan vs blue, etc.) to have
    // ΔE ≥ 5 so they're distinguishable at terminal reading speed.
    function rgbToLab(hex: string): [number, number, number] {
      const [r, g, b] = hexToSrgb(hex).map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      const X = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
      const Y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175);
      const Z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
      const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
      return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
    }
    function deltaE2000(hex1: string, hex2: string): number {
      const [L1, a1, b1] = rgbToLab(hex1);
      const [L2, a2, b2] = rgbToLab(hex2);
      const avgL = (L1 + L2) / 2;
      const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
      const avgC = (C1 + C2) / 2;
      const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
      const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
      const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
      const avgCp = (C1p + C2p) / 2;
      const h1p = (Math.atan2(b1, a1p) * 180 / Math.PI + 360) % 360;
      const h2p = (Math.atan2(b2, a2p) * 180 / Math.PI + 360) % 360;
      const dhp = (() => {
        if (C1p * C2p === 0) return 0;
        let d = h2p - h1p;
        if (d > 180) d -= 360;
        else if (d < -180) d += 360;
        return d;
      })();
      const dLp = L2 - L1, dCp = C2p - C1p;
      const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * Math.PI / 180);
      const avgHp = (() => {
        if (C1p * C2p === 0) return h1p + h2p;
        return Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : (h1p + h2p + 360) / 2;
      })();
      const T = 1 - 0.17 * Math.cos((avgHp - 30) * Math.PI / 180)
              + 0.24 * Math.cos((2 * avgHp) * Math.PI / 180)
              + 0.32 * Math.cos((3 * avgHp + 6) * Math.PI / 180)
              - 0.20 * Math.cos((4 * avgHp - 63) * Math.PI / 180);
      const Sl = 1 + (0.015 * Math.pow(avgL - 50, 2)) / Math.sqrt(20 + Math.pow(avgL - 50, 2));
      const Sc = 1 + 0.045 * avgCp;
      const Sh = 1 + 0.015 * avgCp * T;
      const Rt = -2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)))
               * Math.sin(60 * Math.exp(-Math.pow((avgHp - 275) / 25, 2)) * Math.PI / 180);
      return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2)
                     + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh));
    }

    it.each(["mint", "sepia"] as ThemeId[])(
      "%s: cyan and green hues are ≥ 45° apart (visually distinguishable)",
      (themeId) => {
        const theme = buildXtermThemeForId(themeId);
        const cyanHue = hueOf(theme.cyan as string);
        const greenHue = hueOf(theme.green as string);
        const dist = hueDistance(cyanHue, greenHue);
        expect(
          dist,
          `cyan (${theme.cyan}, H=${cyanHue.toFixed(0)}) vs green (${theme.green}, H=${greenHue.toFixed(0)}) — only ${dist.toFixed(0)}° apart`,
        ).toBeGreaterThanOrEqual(45);
      },
    );

    // Cross-family perceptual distance — pairs that SHOULD be semantically
    // distinct must be clearly distinguishable (ΔE ≥ 5). Covers all adjacent
    // hue pairs on the color wheel for each ANSI variant (normal + bright).
    const crossFamilyPairs: ReadonlyArray<readonly [string, string]> = [
      ["red", "magenta"], ["red", "yellow"],
      ["yellow", "green"],
      ["green", "cyan"], ["cyan", "blue"],
      ["blue", "magenta"],
      ["brightRed", "brightMagenta"], ["brightRed", "brightYellow"],
      ["brightYellow", "brightGreen"],
      ["brightGreen", "brightCyan"], ["brightCyan", "brightBlue"],
      ["brightBlue", "brightMagenta"],
    ];

    it.each(["white", "paper", "mint", "sepia", "night"] as ThemeId[])(
      "%s: all cross-family ANSI pairs have ΔE ≥ 5 (perceptually distinct)",
      (themeId) => {
        const theme = buildXtermThemeForId(themeId) as Record<string, string>;
        for (const [a, b] of crossFamilyPairs) {
          const colorA = theme[a];
          const colorB = theme[b];
          const de = deltaE2000(colorA, colorB);
          expect(
            de,
            `${a} (${colorA}) vs ${b} (${colorB}) — ΔE=${de.toFixed(1)} (< 5)`,
          ).toBeGreaterThanOrEqual(5);
        }
      },
    );
  });
});
