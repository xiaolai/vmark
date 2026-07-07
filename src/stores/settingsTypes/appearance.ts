/**
 * Appearance settings types — theme colors, fonts, spacing, editor width.
 *
 * Extracted from settingsTypes.ts, which remains the stable entry point.
 *
 * @module stores/settingsTypes/appearance
 */

import type { ThemeId } from "@/theme/themes";

// ---------------------------------------------------------------------------
// Theme types
// ---------------------------------------------------------------------------

/** Available theme identifiers for the editor color scheme. Re-exported here
 *  for backward compatibility; the canonical union lives in the theme module
 *  (`@/theme/themes`, derived from the `themes` catalog). Imported (not
 *  re-exported) so `ThemeId` is also bound locally for `AppearanceSettings`. */
export type { ThemeId };

/** Color palette for a single theme — background, foreground, link, and
 *  optional dark-mode overrides. The canonical definition lives in the theme
 *  module (`@/theme/themeColorsAdapter`); re-exported here so settings-side
 *  importers keep their stable path without a second drift-prone copy. */
export type { ThemeColors } from "@/theme/themeColorsAdapter";

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

/** CJK letter spacing in em units (0 = off). */
type CJKLetterSpacingValue = "0" | "0.02" | "0.03" | "0.05" | "0.08" | "0.10" | "0.12";

/** How strongly Focus Mode dims non-focused content (on top of the color
 *  shift): "standard" keeps the color-only look, "strong"/"stronger" add
 *  progressively lower opacity. */
export type FocusModeDim = "standard" | "strong" | "stronger";

/** Visual appearance preferences — theme, fonts, spacing, and editor width. */
export interface AppearanceSettings {
  theme: ThemeId;
  latinFont: string;
  cjkFont: string;
  monoFont: string;
  fontSize: number;
  lineHeight: number;
  blockSpacing: number; // Visual gap between blocks in "lines" (1 = one line-height)
  cjkLetterSpacing: CJKLetterSpacingValue; // Letter spacing for CJK characters (em)
  editorWidth: number; // Max content width in em (0 = unlimited)
  showFilenameInTitlebar: boolean; // Show filename in window titlebar
  autoHideStatusBar: boolean; // Auto-hide status bar when not interacting
  focusModeDim: FocusModeDim; // How strongly Focus Mode dims non-focused content
}
