/**
 * Theme Hook
 *
 * Purpose: Reads appearance settings and computes all CSS custom properties
 *   (design tokens) dynamically — font stacks, sizes, colors, spacing, and
 *   dark/light mode class toggling.
 *
 * Pipeline: settingsStore.appearance changes → this hook recomputes →
 *   sets CSS vars on document.documentElement → all components react via CSS
 *
 * Key decisions:
 *   - Font stacks defined here (latin, CJK, mono families) with system fallbacks
 *   - Editor font size drives dependent tokens (line-height, padding, mono size)
 *   - Mermaid and code preview plugins notified of font size changes
 *   - Dark theme toggled via `.dark-theme` class on documentElement
 *   - Static defaults in :root for print/SSR; this hook overrides at runtime
 *
 * @coordinates-with settingsStore.ts — reads appearance settings
 * @coordinates-with index.css — static token defaults (overridden here)
 * @module hooks/useTheme
 */

import { useEffect, useRef } from "react";
import { useSettingsStore, themes, type ThemeColors, type FocusModeDim } from "@/stores/settingsStore";
import { updateMermaidFontSize } from "@/plugins/mermaid";
import { refreshPreviews } from "@/plugins/codePreview/tiptap";
import { applyTheme, themes as themeTokensCatalog } from "@/theme";
import { legacyLight } from "@/theme/tokens";
import { night } from "@/theme/themes/night";

export const fontStacks = {
  latin: {
    system: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    athelas: "Athelas, Georgia, serif", // Apple Books default
    palatino: "Palatino, 'Palatino Linotype', serif",
    georgia: "Georgia, 'Times New Roman', serif",
    charter: "Charter, Georgia, serif",
    literata: "Literata, Georgia, serif", // Google reading font
  },
  cjk: {
    system: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    pingfang: '"PingFang SC", "PingFang TC", sans-serif', // Apple Books
    songti: '"Songti SC", "STSong", "SimSun", serif',
    kaiti: '"Kaiti SC", "STKaiti", "KaiTi", serif',
    notoserif: '"Noto Serif CJK SC", "Source Han Serif SC", serif',
    sourcehans: '"Source Han Sans SC", "Noto Sans CJK SC", sans-serif',
  },
  mono: {
    system: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace',
    // macOS system fonts
    sfmono: '"SF Mono", ui-monospace, monospace',
    monaco: 'Monaco, ui-monospace, monospace',
    menlo: 'Menlo, ui-monospace, monospace',
    // Cross-platform
    consolas: 'Consolas, "Courier New", monospace',
    // Popular coding fonts (Nerd Font versions for terminal icon support)
    jetbrains: '"JetBrains Mono", ui-monospace, monospace',
    firacode: '"Fira Code", ui-monospace, monospace',
    saucecodepro: '"SauceCodePro Nerd Font Mono", "SauceCodePro NFM", ui-monospace, monospace',
    ibmplexmono: '"IBM Plex Mono", ui-monospace, monospace',
    hack: 'Hack, ui-monospace, monospace',
    inconsolata: 'Inconsolata, ui-monospace, monospace',
  },
};

/**
 * Light mode color defaults — re-exported from the typed catalog
 * (`legacyLight` in `src/theme/tokens.ts`). Identical across all light
 * themes, so it lives once in the catalog layer rather than being
 * hand-maintained here. ADR-014: `src/theme/` is the single source of truth.
 */
const lightModeColors = legacyLight;

/**
 * Dark mode color defaults, derived from the `night` typed theme. Values that
 * are structurally available (semantic, alert, bg/text scales) read straight
 * from `night`; values that intentionally diverge from the structured fields
 * live in `night.color.legacy` (see that file's comment). This keeps the
 * emitted `--*` vars byte-identical to the historical literals while making
 * the typed catalog the single source of truth.
 *
 * Note: `--warning-*`, `--hover-bg*`, `--subtle-bg*`, and `--contrast-text`
 * are intentionally absent — the dark branch of `computeModeColorVars` never
 * emitted them (dark mode inherits the light/`:root` values for those), and
 * that behavior is preserved.
 */
const nightLegacy = night.color.legacy ?? {};
const darkModeColors = {
  "--text-secondary": night.color.text.secondary,
  "--code-text-color": nightLegacy.codeText ?? night.color.text.primary,
  "--selection-color": night.color.selection,
  "--md-char-color": nightLegacy.mdChar ?? "#6a9955",
  "--meta-content-color": nightLegacy.mdChar ?? "#6a9955",
  "--strong-color": night.color.strong,
  "--emphasis-color": night.color.emphasis,
  "--blur-text-color": nightLegacy.blurText ?? "#6b7078",
  "--bg-tertiary": night.color.bg.tertiary,
  "--text-tertiary": night.color.text.tertiary,
  "--accent-bg": nightLegacy.accentBg ?? night.color.accent.bg,
  "--source-mode-bg": nightLegacy.sourceModeBg ?? "rgba(255, 255, 255, 0.02)",
  "--error-color": night.color.semantic.error,
  "--error-color-hover": nightLegacy.errorColorHover ?? night.color.semantic.errorHover,
  "--error-bg": night.color.semantic.errorBg,
  // Success states (adjusted for dark mode)
  "--success-color": night.color.semantic.success,
  "--success-color-hover": nightLegacy.successColorHover ?? night.color.semantic.successHover,
  // Alert block colors (lighter for dark mode)
  "--alert-note": night.color.alert.note,
  "--alert-tip": night.color.alert.tip,
  "--alert-important": night.color.alert.important,
  "--alert-warning": night.color.alert.warning,
  "--alert-caution": night.color.alert.caution,
  // Highlight mark (darker background for dark mode)
  "--highlight-bg": nightLegacy.highlightBg ?? "#5c5c00",
  "--highlight-text": nightLegacy.highlightText ?? "#fff3a3",
};

/** Apply CSS variables from a config object */
function applyVars(root: HTMLElement, vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

// ---------------------------------------------------------------------------
// Pure computation functions — exported for testing, no DOM access
// ---------------------------------------------------------------------------

/**
 * Resolve the monospace font stack for a given `monoFont` setting key. Pure —
 * no DOM access. This is the same mapping `buildFontStack` applies to the
 * editor's `--font-mono`, exposed on its own so the live terminal-font sync can
 * read the new font straight from the setting instead of round-tripping through
 * the CSS var (which `useTheme` only writes in a later effect).
 */
export function resolveMonoFontStack(monoFont: string): string {
  return (
    fontStacks.mono[monoFont as keyof typeof fontStacks.mono] ||
    fontStacks.mono.system
  );
}

/** Build font stacks from font key selections. Pure — no DOM access. */
export function buildFontStack(
  latinFont: string,
  cjkFont: string,
  monoFont: string
): { sans: string; mono: string } {
  const latinStack =
    fontStacks.latin[latinFont as keyof typeof fontStacks.latin] ||
    fontStacks.latin.system;
  const cjkStack =
    fontStacks.cjk[cjkFont as keyof typeof fontStacks.cjk] ||
    fontStacks.cjk.system;
  const monoStack =
    fontStacks.mono[monoFont as keyof typeof fontStacks.mono] ||
    fontStacks.mono.system;

  return {
    sans: `${latinStack}, ${cjkStack}`,
    mono: monoStack,
  };
}

/** Compute core theme color CSS vars. Pure — no DOM access. */
export function computeCoreColorVars(colors: ThemeColors): Record<string, string> {
  return {
    "--bg-color": colors.background,
    "--text-color": colors.foreground,
    "--primary-color": colors.link,
    "--bg-secondary": colors.secondary,
    "--border-color": colors.border,
    "--accent-primary": colors.link,
    "--accent-text": colors.link,
    "--sidebar-bg": colors.secondary,
    "--code-bg-color": colors.secondary,
    "--code-border-color": colors.border,
    "--table-border-color": colors.border,
  };
}

export type ModeColorResult = {
  __isDark: boolean;
  vars: Record<string, string>;
};

/** Compute mode-specific (dark/light) color CSS vars. Pure — no DOM access.
 *  Returns the vars plus a `__isDark` flag for class toggling. */
export function computeModeColorVars(
  colors: ThemeColors,
  isDark: boolean
): ModeColorResult {
  if (isDark) {
    return {
      __isDark: true,
      vars: {
        "--text-secondary": colors.textSecondary ?? darkModeColors["--text-secondary"],
        "--code-text-color": colors.codeText ?? colors.foreground,
        "--selection-color": colors.selection ?? darkModeColors["--selection-color"],
        "--md-char-color": colors.mdChar ?? darkModeColors["--md-char-color"],
        "--meta-content-color": colors.mdChar ?? darkModeColors["--meta-content-color"],
        "--strong-color": colors.strong ?? darkModeColors["--strong-color"],
        "--emphasis-color": colors.emphasis ?? darkModeColors["--emphasis-color"],
        "--blur-text-color": colors.blurText ?? darkModeColors["--blur-text-color"],
        "--bg-tertiary": colors.bgTertiary ?? darkModeColors["--bg-tertiary"],
        "--text-tertiary": colors.textTertiary ?? darkModeColors["--text-tertiary"],
        "--accent-bg": colors.accentBg ?? darkModeColors["--accent-bg"],
        "--source-mode-bg": colors.sourceModeBg ?? darkModeColors["--source-mode-bg"],
        "--error-color": colors.errorColor ?? darkModeColors["--error-color"],
        "--error-color-hover": colors.errorColorHover ?? darkModeColors["--error-color-hover"],
        "--error-bg": colors.errorBg ?? darkModeColors["--error-bg"],
        "--success-color": colors.successColor ?? darkModeColors["--success-color"],
        "--success-color-hover": colors.successColorHover ?? darkModeColors["--success-color-hover"],
        // Alert block colors
        "--alert-note": colors.alertNote ?? darkModeColors["--alert-note"],
        "--alert-tip": colors.alertTip ?? darkModeColors["--alert-tip"],
        "--alert-important": colors.alertImportant ?? darkModeColors["--alert-important"],
        "--alert-warning": colors.alertWarning ?? darkModeColors["--alert-warning"],
        "--alert-caution": colors.alertCaution ?? darkModeColors["--alert-caution"],
        // Highlight mark
        "--highlight-bg": colors.highlightBg ?? darkModeColors["--highlight-bg"],
        "--highlight-text": colors.highlightText ?? darkModeColors["--highlight-text"],
        // Subtle block background for dark mode (light overlay)
        "--block-bg-subtle": colors.blockBgSubtle ?? nightLegacy.blockBgSubtle ?? "rgba(255, 255, 255, 0.03)",
        "--block-bg-subtle-hover": colors.blockBgSubtleHover ?? nightLegacy.blockBgSubtleHover ?? "rgba(255, 255, 255, 0.05)",
      },
    };
  }
  return {
    __isDark: false,
    vars: {
      ...lightModeColors,
      // Use theme-specific optional colors if defined, fallback to defaults
      "--text-secondary": colors.textSecondary ?? lightModeColors["--text-secondary"],
      "--code-text-color": colors.codeText ?? lightModeColors["--code-text-color"],
      "--selection-color": colors.selection ?? lightModeColors["--selection-color"],
      "--md-char-color": colors.mdChar ?? lightModeColors["--md-char-color"],
      "--meta-content-color": colors.mdChar ?? lightModeColors["--meta-content-color"],
      "--strong-color": colors.strong ?? lightModeColors["--strong-color"],
      "--emphasis-color": colors.emphasis ?? lightModeColors["--emphasis-color"],
      // Use theme's border color for bg-tertiary to harmonize with colored themes
      "--bg-tertiary": colors.border,
      // Subtle block background for light mode (dark overlay)
      "--block-bg-subtle": "rgba(0, 0, 0, 0.02)",
      "--block-bg-subtle-hover": "rgba(0, 0, 0, 0.04)",
    },
  };
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
  const appearance = useSettingsStore((state) => state.appearance);
  const blockFontSize = useSettingsStore((state) => state.markdown.blockFontSize);
  const prevFontSizeRef = useRef<number | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    // Guard against invalid theme key (e.g., from corrupted localStorage)
    const themeColors = themes[appearance.theme] ?? themes.paper;
    const isDark = themeColors.isDark ?? false;

    // ADR-014: lay down typed-theme baseline before user-driven overrides.
    // Existing applyCoreColors/applyModeColors layer settings-specific
    // values (theme palette, font sizing) on top of this baseline.
    //
    // Audit fix (H1, 2026-05-25): pass the user's actual theme, not the
    // hardcoded paper/night pair. Without this, App.tsx's typed `cssVars`
    // consumers (drop overlay, etc.) rendered with paper's accent on
    // white/mint/sepia and night's accent on night-only.
    const activeTokens = themeTokensCatalog[appearance.theme] ?? themeTokensCatalog.paper;
    applyTheme(activeTokens, root);

    applyCoreColors(root, themeColors);
    applyModeColors(root, themeColors, isDark);
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
  }, [appearance, blockFontSize]);
}
