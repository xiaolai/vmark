/**
 * Tests for the Mermaid theme configuration builder.
 *
 * Live rendering uses mermaid's "base" theme with themeVariables derived from
 * the app's design tokens, so every theme (paper, mint, sepia, night, …)
 * produces theme-native diagrams. Export keeps fixed light/dark palettes,
 * independent of the app theme.
 */

import { describe, it, expect } from "vitest";
import type { DiagramThemeTokens } from "@/plugins/shared/diagramThemeTokens";
import {
  buildMermaidThemeVariables,
  exportThemeVariables,
} from "./themeConfig";

const lightTokens: DiagramThemeTokens = {
  bgColor: "#eeeded",
  bgSecondary: "#e5e4e4",
  textColor: "#1a1a1a",
  textSecondary: "#666666",
  borderColor: "#d5d4d4",
  accentPrimary: "#0066cc",
  mdCharColor: "#777777",
  fontMono: "ui-monospace, monospace",
  isDark: false,
};

const nightTokens: DiagramThemeTokens = {
  ...lightTokens,
  bgColor: "#101418",
  bgSecondary: "#1a1f24",
  textColor: "#f0f0f0",
  textSecondary: "#858585",
  borderColor: "#3a3f46",
  accentPrimary: "#58a6ff",
  mdCharColor: "#6a9955",
  isDark: true,
};

describe("buildMermaidThemeVariables", () => {
  it("maps design tokens onto mermaid base-theme variables", () => {
    const vars = buildMermaidThemeVariables(lightTokens, 14);
    expect(vars.background).toBe("#eeeded");
    expect(vars.primaryColor).toBe("#e5e4e4");
    expect(vars.mainBkg).toBe("#e5e4e4");
    expect(vars.primaryTextColor).toBe("#1a1a1a");
    expect(vars.primaryBorderColor).toBe("#666666");
    expect(vars.lineColor).toBe("#666666");
    expect(vars.secondaryTextColor).toBe("#666666");
    expect(vars.clusterBkg).toBe("#e5e4e4");
    expect(vars.clusterBorder).toBe("#d5d4d4");
    expect(vars.noteBorderColor).toBe("#0066cc");
    expect(vars.gridColor).toBe("#777777");
    expect(vars.fontFamily).toBe("ui-monospace, monospace");
    expect(vars.fontSize).toBe("14px");
    expect(vars.darkMode).toBe(false);
  });

  it("derives darkMode and dark palette from tokens, not a special case", () => {
    const vars = buildMermaidThemeVariables(nightTokens, 16);
    expect(vars.darkMode).toBe(true);
    expect(vars.background).toBe("#101418");
    expect(vars.primaryColor).toBe("#1a1f24");
    expect(vars.primaryTextColor).toBe("#f0f0f0");
    expect(vars.lineColor).toBe("#858585");
    expect(vars.fontSize).toBe("16px");
  });

  it("produces a mid-theme (e.g. sepia) palette straight from its tokens", () => {
    const sepia: DiagramThemeTokens = {
      ...lightTokens,
      bgColor: "#f4ecd8",
      bgSecondary: "#eaddc0",
      textColor: "#5b4636",
    };
    const vars = buildMermaidThemeVariables(sepia, 14);
    expect(vars.background).toBe("#f4ecd8");
    expect(vars.primaryColor).toBe("#eaddc0");
    expect(vars.primaryTextColor).toBe("#5b4636");
    expect(vars.darkMode).toBe(false);
  });
});

describe("exportThemeVariables", () => {
  it("keeps fixed light and dark palettes for PNG export", () => {
    expect(exportThemeVariables.light.primaryColor).toBe("#f0f4f8");
    expect(exportThemeVariables.light.primaryTextColor).toBe("#1a1a1a");
    expect(exportThemeVariables.dark.primaryColor).toBe("#374151");
    expect(exportThemeVariables.dark.primaryTextColor).toBe("#f3f4f6");
  });
});
