export type { ThemeTokens, AnsiPalette } from "./tokens";
export { sharedPrimitives, lightShadows, darkShadows } from "./tokens";
export { applyTheme, tokensToCssEntries } from "./applyTheme";
export { cssVars } from "./cssVars";

// Theme catalog — typed source of truth (replaces settingsStore.themes
// per theme-unification-2026-05).
export { white, paper, mint, sepia, night, themes } from "./themes";
export type { ThemeId } from "./themes";

// Legacy lightTheme/darkTheme — paper/night aliases kept for ADR-014
// foundation consumers (e.g. applyTheme.test.ts). New code should
// import the named theme directly.
export { paper as lightTheme } from "./themes/paper";
export { night as darkTheme } from "./themes/night";
export { buildXtermTheme, buildXtermThemeForId } from "./buildXtermTheme";
