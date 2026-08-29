// @vitest-environment node
/**
 * The exported reader's dark palette is DERIVED, and every token it consumes
 * resolves to something.
 *
 * WI-DS3 (dev-docs/plans/20260815-design-system-remediation.md). The reader ships
 * its own dark palette because `themeSnapshot` captures only the ONE theme the
 * user exported with, while the reader offers a theme toggle inside the exported
 * document. That second palette is legitimate; hand-writing it was not.
 *
 * Measured drift when this was written: EIGHT tokens, including `--strong-color`
 * #569cd6 vs #6cb6ff and `--md-char-color` #6a9955 vs #7aa874 (the reader still
 * carried VS Code Dark+ values), and `--hover-bg` 0.06 vs the app's 0.08 — a fix
 * the app made in audit 20260612 H15 that never reached the export bundle. Two
 * further tokens had been corrected by hand days earlier and would have drifted
 * again. Nothing in the codebase imports this stylesheet, so the only symptom was
 * a dark export that looked subtly wrong.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readerDarkPaletteCSS } from "./readerDarkPalette";
import { getReaderCSS } from "./readerBundle";
import { themesAsColors } from "@/theme/themeColorsAdapter";
import { computeCoreColorVars, computeModeColorVars } from "@/theme/legacyModeColors";

const staticCss = () =>
  readFileSync(resolve(import.meta.dirname, "vmark-reader.css"), "utf8");

/** `--token: value` pairs declared by a CSS string's `.dark-theme` rule. */
function declaredIn(css: string): Record<string, string> {
  const block = /\.dark-theme\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!block) return {};
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

describe("generated reader dark palette", () => {
  const generated = declaredIn(readerDarkPaletteCSS());

  it("declares a substantial palette", () => {
    // Guard the guard: a parse failure would make the cases below vacuous.
    expect(Object.keys(generated).length).toBeGreaterThanOrEqual(25);
  });

  it("equals what the app writes for night, token for token", () => {
    const colors = themesAsColors.night;
    const app: Record<string, string> = {
      ...computeCoreColorVars(colors),
      ...computeModeColorVars(colors, true).vars,
    };
    for (const [token, value] of Object.entries(generated)) {
      expect(value, token).toBe(app[token]);
    }
  });

  // The regression that motivated this: these eight were hand-written and wrong.
  it.each([
    ["--text-secondary", "#a2a8ad"],
    ["--code-text-color", "#d1d5db"],
    ["--md-char-color", "#7aa874"],
    ["--strong-color", "#6cb6ff"],
    ["--emphasis-color", "#d29c69"],
    ["--hover-bg", "rgba(255, 255, 255, 0.08)"],
    ["--hover-bg-strong", "rgba(255, 255, 255, 0.12)"],
    ["--accent-primary", "#61abff"],
  ])("%s carries the app's value, not the stale hand-written one", (token, expected) => {
    expect(generated[token]).toBe(expected);
  });
});

describe("night theme swatch", () => {
  it("advertises night's accent, derived rather than written out", () => {
    const css = readerDarkPaletteCSS();
    expect(css).toMatch(/\.vmark-reader-theme-circle\.theme-night\.active\s*\{/);
    // themesAsColors.night.link is the app's night accent.
    expect(css).toContain(themesAsColors.night.link);
  });

  it("is not left behind in the static stylesheet", () => {
    expect(staticCss()).not.toMatch(/\.vmark-reader-theme-circle\.theme-night\.active\s*\{/);
  });

  // The whole point of the swatch having its own rule: the generic `.active`
  // ring uses the ACTIVE theme's accent, which would make the night circle
  // advertise the wrong colour while a light theme is showing.
  it("does not use the active theme's accent", () => {
    const rule = /\.vmark-reader-theme-circle\.theme-night\.active\s*\{([^}]*)\}/.exec(
      readerDarkPaletteCSS(),
    );
    expect(rule?.[1]).not.toContain("--primary-color");
  });
});

describe("the static stylesheet no longer hand-writes the palette", () => {
  it("has no `.dark-theme` token block of its own", () => {
    // Two blocks would mean the later one silently wins — which is exactly how a
    // generated palette could land and change nothing.
    expect(Object.keys(declaredIn(staticCss()))).toEqual([]);
  });

  it("keeps its non-token `.dark-theme` component rules", () => {
    // The palette moved out; the component overrides that USE it must not have.
    expect(staticCss()).toMatch(/\.dark-theme\s+\.vmark-reader-/);
  });
});

describe("assembled bundle", () => {
  const bundle = getReaderCSS();

  it("includes the generated palette exactly once", () => {
    expect(bundle.match(/\.dark-theme\s*\{\s*\n\s*--/g) ?? []).toHaveLength(1);
  });

  /**
   * The property that actually matters: every custom property the reader's own
   * stylesheet READS is declared somewhere the export ships — either the
   * generated dark palette, or `themeSnapshot`'s `:root` for the exported theme.
   * A token in neither renders as nothing at all.
   */
  it("declares every token the stylesheet consumes", () => {
    const snapshotVars = new Set(
      readFileSync(resolve(import.meta.dirname, "../themeSnapshot.ts"), "utf8")
        .split("] as const")[0]
        .match(/"--[a-z0-9-]+"/g)
        ?.map((s) => s.replaceAll('"', "")) ?? [],
    );
    const declared = new Set([...Object.keys(declaredIn(bundle)), ...snapshotVars]);
    const consumed = new Set(
      [...staticCss().matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1] as string),
    );
    const orphans = [...consumed].filter((t) => !declared.has(t)).sort();
    expect(orphans).toEqual([]);
  });
});
