/**
 * Theme Snapshot
 *
 * Captures computed CSS variables at export time to ensure
 * exported HTML matches the user's current theme exactly.
 */

/**
 * CSS variables to capture for export.
 * These are the variables that affect content rendering.
 */
export const EXPORT_CSS_VARS = [
  // Core colors
  "--bg-color",
  "--text-color",
  "--text-secondary",
  "--text-tertiary",
  "--primary-color",
  "--border-color",
  "--selection-color",
  "--contrast-text",

  // Background variants
  "--bg-secondary",
  "--bg-tertiary",
  "--sidebar-bg",

  // Accent colors
  "--accent-primary",
  "--accent-bg",
  "--accent-text",

  // Code blocks
  "--code-bg-color",
  "--code-text-color",
  "--code-border-color",

  // Syntax elements
  "--md-char-color",
  "--meta-content-color",

  // Text emphasis
  "--strong-color",
  "--emphasis-color",

  // Alert colors
  "--alert-note",
  "--alert-tip",
  "--alert-important",
  "--alert-warning",
  "--alert-caution",
  "--alert-note-dark",
  "--alert-tip-dark",
  "--alert-important-dark",
  "--alert-warning-dark",
  "--alert-caution-dark",

  // Highlight
  "--highlight-bg",
  "--highlight-text",

  // Error/warning/success states
  "--error-color",
  "--error-bg",
  "--warning-color",
  "--warning-bg",
  "--warning-border",
  "--success-color",

  // Hover states
  "--hover-bg",
  "--hover-bg-strong",

  // Tables
  "--table-border-color",

  // Focus mode
  "--blur-text-color",
  "--blur-image-opacity",

  // Typography
  "--font-sans",
  "--font-mono",
  "--editor-font-size",
  "--editor-font-size-sm",
  "--editor-font-size-mono",
  "--editor-line-height",
  "--editor-line-height-px",
  "--editor-content-padding",
  "--editor-width",

  // Border radius
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--popup-radius",

  // Shadows
  "--shadow-sm",
  "--shadow-md",
  "--popup-shadow",
  "--popup-shadow-dark",

  // Spacing
  "--spacing-1",
  "--spacing-2",
  "--spacing-3",
  "--list-indent",
] as const;

export type CSSVarName = (typeof EXPORT_CSS_VARS)[number];
export type ThemeSnapshot = Record<CSSVarName, string>;

/**
 * Capture current computed CSS variables for export.
 *
 * Reads the actual computed values from the document root,
 * ensuring we capture the exact values after any runtime
 * modifications (theme changes, font size adjustments, etc.)
 *
 * @returns Record of CSS variable names to their computed values
 *
 * @example
 * ```ts
 * const snapshot = captureThemeSnapshot();
 * // snapshot['--bg-color'] === '#ffffff'
 * // snapshot['--editor-font-size'] === '16px'
 * ```
 */
export function captureThemeSnapshot(): ThemeSnapshot {
  const style = getComputedStyle(document.documentElement);
  const snapshot: Partial<ThemeSnapshot> = {};

  for (const varName of EXPORT_CSS_VARS) {
    const value = style.getPropertyValue(varName).trim();
    snapshot[varName] = value || "";
  }

  return snapshot as ThemeSnapshot;
}

/**
 * Generate a CSS string from a theme snapshot.
 *
 * Creates a `:root { ... }` block that can be embedded
 * in exported HTML to preserve the exact theme.
 *
 * @param snapshot - The captured theme snapshot
 * @returns CSS string with :root variables
 *
 * @example
 * ```ts
 * const css = generateThemeCSS(snapshot);
 * // Returns:
 * // :root {
 * //   --bg-color: #ffffff;
 * //   --text-color: #1a1a1a;
 * //   ...
 * // }
 * ```
 */
export function generateThemeCSS(snapshot: ThemeSnapshot): string {
  const lines = Object.entries(snapshot)
    .filter(([, value]) => value !== "")
    .map(([name, value]) => `  ${name}: ${value};`);

  return `:root {\n${lines.join("\n")}\n}`;
}

/**
 * Capture theme snapshot as inline CSS for embedding.
 *
 * Convenience function that captures and generates CSS in one call.
 *
 * @returns CSS string ready to embed in <style> tag
 */
export function captureThemeCSS(): string {
  const snapshot = captureThemeSnapshot();
  return generateThemeCSS(snapshot);
}

/**
 * Check if the current theme is dark mode.
 *
 * @returns true if dark theme is active
 */
export function isDarkTheme(): boolean {
  return document.documentElement.classList.contains("dark-theme") ||
         document.documentElement.classList.contains("dark");
}

