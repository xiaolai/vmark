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
  });
});
