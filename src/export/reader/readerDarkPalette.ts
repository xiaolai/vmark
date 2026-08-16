/**
 * readerDarkPalette — the exported reader's `.dark-theme` block, DERIVED.
 *
 * The reader needs its own dark palette because `themeSnapshot` captures only
 * the ONE theme the user exported with, while the reader offers a theme toggle
 * inside the exported document. That second palette is legitimate. Hand-writing
 * it was not: nothing in the codebase imports this stylesheet, so it drifted
 * from the app for months and the only symptom was an exported document that
 * looked subtly wrong in dark mode — the most public artefact VMark produces.
 *
 * Measured drift at the time this was written (WI-DS3): eight tokens, including
 * `--strong-color` #569cd6 vs #6cb6ff and `--md-char-color` #6a9955 vs #7aa874
 * (the reader still carried VS Code Dark+ values), plus `--hover-bg` at 0.06
 * against the app's 0.08 — a fix the app made in audit 20260612 H15, on the
 * grounds that a black tint on a dark background is barely perceivable, which
 * never reached the export bundle. Two more had been corrected by hand days
 * earlier and would have drifted again.
 *
 * Deriving it means the class is gone rather than the instances fixed.
 *
 * @coordinates-with theme/legacyModeColors.ts — the same computation the app uses
 * @coordinates-with readerBundle.ts — prepends this to the static stylesheet
 * @module export/reader/readerDarkPalette
 */

import { themesAsColors } from "@/theme/themeColorsAdapter";
import { computeCoreColorVars, computeModeColorVars } from "@/theme/legacyModeColors";

/**
 * Every CSS variable the app writes when the night theme is active, as a
 * `.dark-theme` rule for the exported document.
 *
 * Emits the WHOLE night var set rather than the subset the reader's stylesheet
 * happens to consume today. A superset costs a few hundred bytes of unused
 * custom properties; a hand-curated subset costs a silent hole the next time the
 * reader's CSS starts consuming a token nobody remembered to add.
 */
export function readerDarkPaletteCSS(): string {
  const colors = themesAsColors.night;
  const vars: Record<string, string> = {
    ...computeCoreColorVars(colors),
    ...computeModeColorVars(colors, true).vars,
  };
  const decls = Object.entries(vars)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");

  // The night swatch's active ring. It lives HERE rather than in the stylesheet
  // because it is the one rule whose colour must be night's regardless of the
  // active theme — the picker draws a circle per theme, and the night circle has
  // to advertise night's accent even while a light theme is showing.
  // `var(--primary-color)` would be the ACTIVE theme's accent, which is why this
  // was hand-written as a literal and went stale. Emitting the whole rule keeps
  // the derivation and its only consumer together, and leaves no custom property
  // that the CSS-reading token gate would rightly call undefined.
  const swatch =
    `.vmark-reader-theme-circle.theme-night.active {\n` +
    `  box-shadow: inset 0 0 0 2px ${colors.link}, inset 0 0 0 3px rgba(255, 255, 255, 0.3);\n}\n`;

  return (
    `/* GENERATED from the app's night theme (readerDarkPalette.ts).\n` +
    `   Do not hand-edit: this drifted eight tokens while it was hand-written. */\n` +
    `.dark-theme {\n${decls}\n}\n\n${swatch}`
  );
}
