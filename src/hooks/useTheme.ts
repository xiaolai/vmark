/**
 * Theme Hook
 *
 * Purpose: Reads appearance settings and computes all CSS custom properties
 *   (design tokens) dynamically — font stacks, sizes, colors, spacing, and
 *   dark/light mode class toggling.
 *
 * Pipeline: settingsStore.appearance changes (or an OS light/dark flip while
 *   follow-system-appearance is on) → this hook recomputes → sets CSS vars on
 *   document.documentElement → all components react via CSS, and the resolved
 *   light/dark state is reported to Rust so OS-drawn chrome follows it too
 *
 * Key decisions:
 *   - Font stacks live in `@/utils/fontStacks` (leaf-pure); this hook composes
 *     them via `buildFontStack` into the `--font-sans`/`--font-mono` tokens
 *   - Editor font size drives dependent tokens (line-height, padding, mono size)
 *   - Mermaid and code preview plugins notified of font size changes
 *   - Dark theme toggled via `.dark-theme` class on documentElement
 *   - Static defaults in :root for print/SSR; this hook overrides at runtime
 *   - Dark/light legacy color values are derived from the typed theme catalog
 *     (`legacyLight` + per-theme `color.legacy`) — this hook no longer carries
 *     its own `darkModeColors`/`lightModeColors` literals
 *
 * @coordinates-with settingsStore.ts — reads appearance settings
 * @coordinates-with useEffectiveTheme.ts — resolves manual vs follow-system theme id
 * @coordinates-with services/theme/nativeTheme.ts — reports light/dark to native chrome
 * @coordinates-with useSystemAppearanceWatcher.ts — mounted here to track the OS preference
 * @coordinates-with index.css — static token defaults (overridden here)
 * @coordinates-with theme/legacyModeColors.ts — derived legacy color sets + pure color-var computation
 * @coordinates-with utils/fontStacks.ts — font family stacks and resolution
 * @module hooks/useTheme
 */

import { useEffect, useRef } from "react";
import { useSettingsStore, themes, type ThemeColors, type FocusModeDim } from "@/stores/settingsStore";
import { useEffectiveThemeId } from "@/hooks/useEffectiveTheme";
import { useSystemAppearanceWatcher } from "@/hooks/useSystemAppearanceWatcher";
import { updateMermaidFontSize } from "@/plugins/mermaid";
import { refreshPreviews } from "@/plugins/codePreview/tiptap";
import { applyTheme, themes as themeTokensCatalog } from "@/theme";
import { computeCoreColorVars, computeModeColorVars } from "@/theme/legacyModeColors";
import { buildFontStack } from "@/utils/fontStacks";
import { syncNativeTheme } from "@/services/theme/nativeTheme";

// Pure color computation moved to @/theme/legacyModeColors (ADR-014 home for
// color values; keeps this file under the size gate). Re-exported here so
// existing test/consumer imports keep their stable path.
export { computeCoreColorVars, computeModeColorVars } from "@/theme/legacyModeColors";

/** Apply CSS variables from a config object */
function applyVars(root: HTMLElement, vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

export type TypographyInput = {
  latinFont: string;
  cjkFont: string;
  monoFont: string;
  fontSize: number;
  lineHeight: number;
  blockSpacing: number;
  cjkLetterSpacing: string;
  editorWidth: number;
  blockFontSize: string;
};

/** Compute typography CSS vars. Pure — no DOM access. */
export function computeTypographyVars(input: TypographyInput): Record<string, string> {
  const { fontSize, lineHeight, blockSpacing, cjkLetterSpacing, editorWidth, blockFontSize } = input;
  const { sans, mono } = buildFontStack(input.latinFont, input.cjkFont, input.monoFont);

  // Calculate absolute line-height for use with reduced font sizes
  const lineHeightPx = fontSize * lineHeight;
  // Mermaid renders at the editor's mono font size directly (no CSS zoom needed).
  // --mermaid-scale is kept at 1 for CSS compatibility; visual scaling is handled
  // by mermaid's own fontSize config.
  const mermaidScale = 1;

  // Calculate block spacing margin that produces correct visual gap.
  // Visual gap = margin + (lineHeight - 1) × fontSize (due to half-leading above and below)
  // For N lines of visual gap: margin = lineHeight × (N - 1) + 1 (in em units)
  // This ensures "1 line" setting produces exactly 1 line-height of visual space.
  const blockSpacingMargin = lineHeight * (blockSpacing - 1) + 1;

  // Calculate block font size as absolute pixel value to prevent compounding
  // when block elements are nested (e.g., list inside blockquote)
  const blockFontSizePx = fontSize * parseFloat(blockFontSize);

  return {
    "--font-sans": sans,
    "--font-mono": mono,
    "--editor-font-size": `${fontSize}px`,
    "--editor-font-size-sm": `${fontSize * 0.9}px`,
    "--editor-font-size-mono": `${fontSize * 0.85}px`,
    "--editor-font-size-block": `${blockFontSizePx}px`, // Absolute to prevent compounding in nested blocks
    "--editor-line-height": String(lineHeight),
    "--editor-line-height-px": `${lineHeightPx}px`,
    "--editor-block-spacing": `${blockSpacingMargin}em`,
    "--editor-content-padding": `${fontSize * 2}px`, // 2em relative to base font-size, consistent across modes
    "--code-padding": `${fontSize}px`, // 1em relative to base font-size (not code font)
    "--cjk-letter-spacing": cjkLetterSpacing === "0" ? "0" : `${cjkLetterSpacing}em`,
    "--editor-width": editorWidth > 0 ? `${editorWidth}em` : "none",
    "--mermaid-scale": String(mermaidScale),
  };
}

// ---------------------------------------------------------------------------
// DOM-mutating helpers — used by the useTheme hook
// ---------------------------------------------------------------------------

/** Apply core theme colors (background, foreground, accents) */
function applyCoreColors(root: HTMLElement, colors: ThemeColors) {
  applyVars(root, computeCoreColorVars(colors));
}

/** Apply mode-specific colors (dark/light) */
function applyModeColors(root: HTMLElement, colors: ThemeColors, isDark: boolean) {
  const { __isDark: wasDark, vars } = computeModeColorVars(colors, isDark);
  applyVars(root, vars);
  if (wasDark) {
    root.classList.add("dark-theme", "dark");
  } else {
    root.classList.remove("dark-theme", "dark");
  }
}

/** Apply typography settings (fonts, sizes, spacing) */
function applyTypography(
  root: HTMLElement,
  latinFont: string,
  cjkFont: string,
  monoFont: string,
  fontSize: number,
  lineHeight: number,
  blockSpacing: number,
  cjkLetterSpacing: string,
  editorWidth: number,
  blockFontSize: string
) {
  applyVars(root, computeTypographyVars({
    latinFont, cjkFont, monoFont, fontSize, lineHeight,
    blockSpacing, cjkLetterSpacing, editorWidth, blockFontSize,
  }));
}

/** Focus Mode dim level → opacity for non-focused content. "standard" keeps
 *  the historical color-only dimming (opacity 1). Exported for testing. */
export const FOCUS_DIM_OPACITY: Record<FocusModeDim, string> = {
  standard: "1",
  strong: "0.65",
  stronger: "0.45",
};

/** Hook that applies CSS design tokens (fonts, sizes, colors, dark/light mode) from appearance settings. */
export function useTheme() {
  // Track the OS light/dark preference for follow-system-appearance (#1125).
  // Mounted here so every window that themes itself gets the watcher.
  useSystemAppearanceWatcher();
  const appearance = useSettingsStore((state) => state.appearance);
  const blockFontSize = useSettingsStore((state) => state.markdown.blockFontSize);
  // Manual theme, or the paired light/dark theme when following the system
  const effectiveThemeId = useEffectiveThemeId();
  const prevFontSizeRef = useRef<number | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    // Guard against invalid theme key (e.g., from corrupted localStorage)
    const themeColors = themes[effectiveThemeId] ?? themes.paper;
    const isDark = themeColors.isDark ?? false;

    // ADR-014: lay down typed-theme baseline before user-driven overrides.
    // Existing applyCoreColors/applyModeColors layer settings-specific
    // values (theme palette, font sizing) on top of this baseline.
    //
    // Audit fix (H1, 2026-05-25): pass the user's actual theme, not the
    // hardcoded paper/night pair. Without this, App.tsx's typed `cssVars`
    // consumers (drop overlay, etc.) rendered with paper's accent on
    // white/mint/sepia and night's accent on night-only.
    const activeTokens = themeTokensCatalog[effectiveThemeId] ?? themeTokensCatalog.paper;
    applyTheme(activeTokens, root);

    applyCoreColors(root, themeColors);
    applyModeColors(root, themeColors, isDark);
    // Keep OS-drawn chrome (title bar; the menu bar on Windows) in step with
    // the theme we just applied. Fire-and-forget: it self-dedupes, and a
    // failure must not abort the rest of this effect.
    void syncNativeTheme(isDark);
    applyTypography(
      root,
      appearance.latinFont,
      appearance.cjkFont,
      appearance.monoFont,
      appearance.fontSize,
      appearance.lineHeight,
      appearance.blockSpacing ?? 1,
      appearance.cjkLetterSpacing ?? "0",
      appearance.editorWidth ?? 50,
      blockFontSize
    );

    // Focus Mode dim level → opacity applied to non-focused content on top of
    // the color shift. "standard" = 1 (color-only, current look).
    root.style.setProperty(
      "--focus-dim-opacity",
      FOCUS_DIM_OPACITY[appearance.focusModeDim] ?? "1"
    );

    // Update Mermaid font size when editor font size changes
    if (prevFontSizeRef.current !== null && prevFontSizeRef.current !== appearance.fontSize) {
      updateMermaidFontSize();
      // Font size changed, refresh all preview decorations to re-render with new size
      refreshPreviews();
    }
    prevFontSizeRef.current = appearance.fontSize;
  }, [appearance, blockFontSize, effectiveThemeId]);
}
