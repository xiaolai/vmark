/**
 * useTheme — pure function tests
 *
 * Tests the extractable logic from useTheme.ts:
 *   - Font stack resolution
 *   - Typography CSS var computation
 *   - Core color application
 *   - Mode-specific (dark/light) color application
 *   - Dark class toggling
 */

import { describe, it, expect } from "vitest";
import {
  fontStacks,
  buildFontStack,
  computeTypographyVars,
  computeCoreColorVars,
  computeModeColorVars,
} from "./useTheme";
import type { ThemeColors } from "@/stores/settingsStore";

// ---------------------------------------------------------------------------
// Font stack resolution
// ---------------------------------------------------------------------------
describe("buildFontStack", () => {
  it("resolves known latin font to its stack", () => {
    const result = buildFontStack("athelas", "system", "system");
    expect(result.sans).toContain("Athelas");
  });

  it("resolves known CJK font into the sans stack", () => {
    const result = buildFontStack("system", "songti", "system");
    expect(result.sans).toContain("Songti SC");
  });

  it("resolves known mono font", () => {
    const result = buildFontStack("system", "system", "jetbrains");
    expect(result.mono).toContain("JetBrains Mono");
  });

  it("falls back to system for unknown latin font key", () => {
    const result = buildFontStack("nonexistent", "system", "system");
    expect(result.sans).toContain("system-ui");
  });

  it("falls back to system for unknown CJK font key", () => {
    const result = buildFontStack("system", "nonexistent", "system");
    expect(result.sans).toContain("PingFang SC");
  });

  it("falls back to system for unknown mono font key", () => {
    const result = buildFontStack("system", "system", "nonexistent");
    expect(result.mono).toContain("ui-monospace");
  });

  it("combines latin and CJK in the sans stack", () => {
    const result = buildFontStack("georgia", "kaiti", "system");
    // Latin comes first, then CJK
    const latinIdx = result.sans.indexOf("Georgia");
    const cjkIdx = result.sans.indexOf("Kaiti SC");
    expect(latinIdx).toBeLessThan(cjkIdx);
  });
});

// ---------------------------------------------------------------------------
// Typography vars computation
// ---------------------------------------------------------------------------
describe("computeTypographyVars", () => {
  const baseTypography = {
    latinFont: "system",
    cjkFont: "system",
    monoFont: "system",
    fontSize: 18,
    lineHeight: 1.8,
    blockSpacing: 1,
    cjkLetterSpacing: "0",
    editorWidth: 50,
    blockFontSize: "1",
  };

  it("computes editor font size in px", () => {
    const vars = computeTypographyVars(baseTypography);
    expect(vars["--editor-font-size"]).toBe("18px");
  });

  it("computes small font as 90% of base", () => {
    const vars = computeTypographyVars(baseTypography);
    expect(vars["--editor-font-size-sm"]).toBe(`${18 * 0.9}px`);
  });

  it("computes mono font as 85% of base", () => {
    const vars = computeTypographyVars(baseTypography);
    expect(vars["--editor-font-size-mono"]).toBe(`${18 * 0.85}px`);
  });

  it("computes line height in px", () => {
    const vars = computeTypographyVars(baseTypography);
    expect(vars["--editor-line-height-px"]).toBe(`${18 * 1.8}px`);
  });

  it("computes editor content padding as 2x fontSize", () => {
    const vars = computeTypographyVars(baseTypography);
    expect(vars["--editor-content-padding"]).toBe(`${18 * 2}px`);
  });

  it("computes code padding as 1x fontSize", () => {
    const vars = computeTypographyVars(baseTypography);
    expect(vars["--code-padding"]).toBe("18px");
  });

  it("sets cjk letter spacing to 0 when value is '0'", () => {
    const vars = computeTypographyVars(baseTypography);
    expect(vars["--cjk-letter-spacing"]).toBe("0");
  });

  it("sets cjk letter spacing with em unit when non-zero", () => {
    const vars = computeTypographyVars({
      ...baseTypography,
      cjkLetterSpacing: "0.05",
    });
    expect(vars["--cjk-letter-spacing"]).toBe("0.05em");
  });

  it("sets editor width in em when > 0", () => {
    const vars = computeTypographyVars(baseTypography);
    expect(vars["--editor-width"]).toBe("50em");
  });

  it("sets editor width to 'none' when 0", () => {
    const vars = computeTypographyVars({ ...baseTypography, editorWidth: 0 });
    expect(vars["--editor-width"]).toBe("none");
  });

  it("computes block spacing margin correctly for 1 line", () => {
    // margin = lineHeight * (blockSpacing - 1) + 1
    // = 1.8 * (1 - 1) + 1 = 1 em
    const vars = computeTypographyVars(baseTypography);
    expect(vars["--editor-block-spacing"]).toBe("1em");
  });

  it("computes block spacing margin correctly for 2 lines", () => {
    // margin = 1.8 * (2 - 1) + 1 = 2.8 em
    const vars = computeTypographyVars({
      ...baseTypography,
      blockSpacing: 2,
    });
    expect(vars["--editor-block-spacing"]).toBe("2.8em");
  });

  it("computes block font size as absolute px", () => {
    const vars = computeTypographyVars({
      ...baseTypography,
      blockFontSize: "0.9",
    });
    expect(vars["--editor-font-size-block"]).toBe(`${18 * 0.9}px`);
  });

  it("handles different font sizes correctly", () => {
    const vars = computeTypographyVars({
      ...baseTypography,
      fontSize: 24,
    });
    expect(vars["--editor-font-size"]).toBe("24px");
    expect(vars["--editor-font-size-sm"]).toBe(`${24 * 0.9}px`);
    expect(vars["--editor-font-size-mono"]).toBe(`${24 * 0.85}px`);
    expect(vars["--editor-line-height-px"]).toBe(`${24 * 1.8}px`);
    expect(vars["--editor-content-padding"]).toBe(`${24 * 2}px`);
  });
});

// ---------------------------------------------------------------------------
// Core color vars
// ---------------------------------------------------------------------------
describe("computeCoreColorVars", () => {
  const paperTheme: ThemeColors = {
    background: "#EEEDED",
    foreground: "#1a1a1a",
    link: "#0066cc",
    secondary: "#e5e4e4",
    border: "#d5d4d4",
  };

  it("maps background to --bg-color", () => {
    const vars = computeCoreColorVars(paperTheme);
    expect(vars["--bg-color"]).toBe("#EEEDED");
  });

  it("maps foreground to --text-color", () => {
    const vars = computeCoreColorVars(paperTheme);
    expect(vars["--text-color"]).toBe("#1a1a1a");
  });

  it("maps link to --primary-color, --accent-primary, and --accent-text", () => {
    const vars = computeCoreColorVars(paperTheme);
    expect(vars["--primary-color"]).toBe("#0066cc");
    expect(vars["--accent-primary"]).toBe("#0066cc");
    expect(vars["--accent-text"]).toBe("#0066cc");
  });

  it("maps secondary to --sidebar-bg and --code-bg-color", () => {
    const vars = computeCoreColorVars(paperTheme);
    expect(vars["--sidebar-bg"]).toBe("#e5e4e4");
    expect(vars["--code-bg-color"]).toBe("#e5e4e4");
  });

  it("maps border to --border-color, --code-border-color, --table-border-color", () => {
    const vars = computeCoreColorVars(paperTheme);
    expect(vars["--border-color"]).toBe("#d5d4d4");
    expect(vars["--code-border-color"]).toBe("#d5d4d4");
    expect(vars["--table-border-color"]).toBe("#d5d4d4");
  });
});

// ---------------------------------------------------------------------------
// Mode-specific color vars
// ---------------------------------------------------------------------------
describe("computeModeColorVars", () => {
  const lightTheme: ThemeColors = {
    background: "#EEEDED",
    foreground: "#1a1a1a",
    link: "#0066cc",
    secondary: "#e5e4e4",
    border: "#d5d4d4",
  };

  const darkTheme: ThemeColors = {
    background: "#23262b",
    foreground: "#d6d9de",
    link: "#5aa8ff",
    secondary: "#2a2e34",
    border: "#3a3f46",
    isDark: true,
    textSecondary: "#9aa0a6",
    codeText: "#d1d5db",
    selection: "rgba(90, 168, 255, 0.22)",
    mdChar: "#7aa874",
    strong: "#6cb6ff",
    emphasis: "#d19a66",
  };

  describe("light mode", () => {
    it("returns light mode default colors", () => {
      const { vars } = computeModeColorVars(lightTheme, false);
      expect(vars["--text-secondary"]).toBe("#666666");
      expect(vars["--selection-color"]).toBe("rgba(0, 102, 204, 0.2)");
    });

    it("sets --bg-tertiary to theme border color for light mode", () => {
      const { vars } = computeModeColorVars(lightTheme, false);
      expect(vars["--bg-tertiary"]).toBe("#d5d4d4");
    });

    it("includes light alert colors", () => {
      const { vars } = computeModeColorVars(lightTheme, false);
      expect(vars["--alert-note"]).toBe("#0969da");
      expect(vars["--alert-tip"]).toBe("#1a7f37");
    });

    it("sets isDark to false", () => {
      const result = computeModeColorVars(lightTheme, false);
      expect(result.__isDark).toBe(false);
    });

    it("overrides with theme-specific textSecondary when provided", () => {
      const themed: ThemeColors = {
        ...lightTheme,
        textSecondary: "#555555",
      };
      const { vars } = computeModeColorVars(themed, false);
      expect(vars["--text-secondary"]).toBe("#555555");
    });

    it("overrides with theme-specific strong when provided", () => {
      const themed: ThemeColors = {
        ...lightTheme,
        strong: "#123456",
      };
      const { vars } = computeModeColorVars(themed, false);
      expect(vars["--strong-color"]).toBe("#123456");
    });
  });

  describe("dark mode", () => {
    it("returns dark mode default colors", () => {
      const { vars } = computeModeColorVars(darkTheme, true);
      expect(vars["--blur-text-color"]).toBe("#6b7078");
      expect(vars["--accent-bg"]).toBe("rgba(90, 168, 255, 0.12)");
    });

    it("uses theme-specific dark overrides", () => {
      const { vars } = computeModeColorVars(darkTheme, true);
      expect(vars["--text-secondary"]).toBe("#9aa0a6");
      expect(vars["--selection-color"]).toBe("rgba(90, 168, 255, 0.22)");
      expect(vars["--md-char-color"]).toBe("#7aa874");
    });

    it("falls back to dark defaults when theme overrides are missing", () => {
      const minimal: ThemeColors = {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        link: "#5aa8ff",
        secondary: "#252526",
        border: "#3e3e42",
        isDark: true,
        // no textSecondary, codeText, etc.
      };
      const { vars } = computeModeColorVars(minimal, true);
      expect(vars["--text-secondary"]).toBe("#858585"); // dark default
      expect(vars["--code-text-color"]).toBe("#d4d4d4"); // falls back to foreground
    });

    it("sets isDark to true", () => {
      const result = computeModeColorVars(darkTheme, true);
      expect(result.__isDark).toBe(true);
    });

    it("includes dark alert colors", () => {
      const { vars } = computeModeColorVars(darkTheme, true);
      expect(vars["--alert-note"]).toBe("#58a6ff");
      expect(vars["--alert-caution"]).toBe("#f85149");
    });

    it("includes highlight tokens for dark mode", () => {
      const { vars } = computeModeColorVars(darkTheme, true);
      expect(vars["--highlight-bg"]).toBe("#5c5c00");
      expect(vars["--highlight-text"]).toBe("#fff3a3");
    });
  });
});

// ---------------------------------------------------------------------------
// fontStacks export
// ---------------------------------------------------------------------------
describe("fontStacks", () => {
  it("has latin, cjk, and mono categories", () => {
    expect(fontStacks).toHaveProperty("latin");
    expect(fontStacks).toHaveProperty("cjk");
    expect(fontStacks).toHaveProperty("mono");
  });

  it("has system as a key in each category", () => {
    expect(fontStacks.latin).toHaveProperty("system");
    expect(fontStacks.cjk).toHaveProperty("system");
    expect(fontStacks.mono).toHaveProperty("system");
  });
});
