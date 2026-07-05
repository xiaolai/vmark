/**
 * Mermaid Theme Configuration
 *
 * Purpose: Maps VMark design tokens onto mermaid's "base" theme variables so
 * live diagrams are theme-native in every app theme, and keeps the fixed
 * light/dark palettes used for PNG export (export is intentionally
 * independent of the current app theme).
 *
 * Token -> themeVariable mapping (live rendering):
 *   --bg-color        -> background, secondaryColor, tertiaryColor, edgeLabelBackground
 *   --bg-secondary    -> primaryColor, mainBkg, clusterBkg, noteBkgColor
 *   --text-color      -> primaryTextColor, textColor, titleColor, noteTextColor
 *   --text-secondary  -> primaryBorderColor, nodeBorder, lineColor, secondaryTextColor
 *   --border-color    -> clusterBorder
 *   --accent-primary  -> noteBorderColor
 *   --md-char-color   -> gridColor (gantt/xychart grids)
 *   --font-mono       -> fontFamily
 *   isDark (derived)  -> darkMode
 *
 * @coordinates-with plugin.ts — initialize() consumes buildMermaidThemeVariables
 * @coordinates-with shared/diagramThemeTokens.ts — token source
 * @module plugins/mermaid/themeConfig
 */

import type { DiagramThemeTokens } from "@/plugins/shared/diagramThemeTokens";

export type MermaidThemeVariables = Record<string, string | boolean>;

/** Build mermaid "base" theme variables from the current design tokens. */
export function buildMermaidThemeVariables(
  tokens: DiagramThemeTokens,
  fontSize: number,
): MermaidThemeVariables {
  return {
    darkMode: tokens.isDark,
    background: tokens.bgColor,
    // Node fills
    primaryColor: tokens.bgSecondary,
    mainBkg: tokens.bgSecondary,
    secondaryColor: tokens.bgColor,
    tertiaryColor: tokens.bgColor,
    // Subgraph fills
    clusterBkg: tokens.bgSecondary,
    clusterBorder: tokens.borderColor,
    // Borders and lines
    primaryBorderColor: tokens.textSecondary,
    nodeBorder: tokens.textSecondary,
    lineColor: tokens.textSecondary,
    // Text
    primaryTextColor: tokens.textColor,
    textColor: tokens.textColor,
    titleColor: tokens.textColor,
    secondaryTextColor: tokens.textSecondary,
    // Notes (sequence diagrams) — accent border, themed surface
    noteBkgColor: tokens.bgSecondary,
    noteTextColor: tokens.textColor,
    noteBorderColor: tokens.accentPrimary,
    // Grids (gantt, xychart)
    gridColor: tokens.mdCharColor,
    edgeLabelBackground: tokens.bgColor,
    fontFamily: tokens.fontMono,
    fontSize: `${fontSize}px`,
  };
}

/**
 * Fixed palettes for PNG export ("light"/"dark" background choice in the
 * export button). Deliberately NOT token-driven: exports must look the same
 * regardless of the exporting user's active theme.
 */
export const exportThemeVariables = {
  light: {
    primaryColor: "#f0f4f8",
    secondaryColor: "#e8f0fe",
    tertiaryColor: "#fff",
    clusterBkg: "#f5f5f5",
    clusterBorder: "#d5d5d5",
    nodeBorder: "#9ca3af",
    primaryTextColor: "#1a1a1a",
    secondaryTextColor: "#4b5563",
    lineColor: "#6b7280",
  },
  dark: {
    primaryColor: "#374151",
    secondaryColor: "#1f2937",
    tertiaryColor: "#111827",
    clusterBkg: "#1f2937",
    clusterBorder: "#4b5563",
    nodeBorder: "#6b7280",
    primaryTextColor: "#f3f4f6",
    secondaryTextColor: "#d1d5db",
    lineColor: "#9ca3af",
  },
} as const;
