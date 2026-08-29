// @vitest-environment node
// WI-UI1.1 — theme-keyed emission: isDark stops choosing colours.
// WI-UI1.3 — the --quote-text role (readable prose, never the syntax green).
/**
 * The legacy writer used to emit DIFFERENT key sets per branch — dark omitted
 * the warning family, contrast-text and the subtle backgrounds, so :root's
 * LIGHT literals leaked onto dark themes (#9a6700 warning text at 3.1:1 on
 * night). These tests pin the fix: one key set, per-theme values from the
 * catalog, and the static fallbacks UNREACHABLE for the families the six
 * shipped themes provide.
 */
import { describe, it, expect } from "vitest";
import { computeCoreColorVars, computeModeColorVars } from "./legacyModeColors";
import { themesAsColors } from "./themeColorsAdapter";
import { themes, type ThemeId } from "./themes";

const ALL: ThemeId[] = ["white", "paper", "mint", "sepia", "night", "solarized"];

function emitted(id: ThemeId): Record<string, string> {
  const colors = themesAsColors[id];
  return {
    ...computeCoreColorVars(colors),
    ...computeModeColorVars(colors, colors.isDark ?? false).vars,
  };
}

describe("key-set equality (R2)", () => {
  it("every theme emits the SAME key set — isDark adds a class, never chooses keys", () => {
    const reference = Object.keys(emitted("paper")).sort();
    for (const id of ALL) {
      expect(Object.keys(emitted(id)).sort(), id).toEqual(reference);
    }
  });
});

describe("per-theme values for the families the dark branch used to omit", () => {
  it("night renders its OWN warning family, not the light leak", () => {
    const night = emitted("night");
    expect(night["--warning-color"]).toBe(themes.night.color.semantic.warning);
    expect(night["--warning-color"]).not.toBe("#9a6700"); // the 3.1:1 light leak
    expect(night["--warning-bg"]).toBe(themes.night.color.semantic.warningBg);
    expect(night["--warning-border"]).toBe(themes.night.color.semantic.warningBorder);
  });

  it("night subtle backgrounds are visible white tints, not black-on-black", () => {
    const night = emitted("night");
    expect(night["--subtle-bg"]).toBe("rgba(255, 255, 255, 0.04)");
    expect(night["--subtle-bg-hover"]).toBe("rgba(255, 255, 255, 0.06)");
  });

  it("contrast text is per theme: white on light accents, dark ink on pastel dark accents", () => {
    expect(emitted("paper")["--contrast-text"]).toBe("white");
    expect(emitted("night")["--contrast-text"]).toBe("#23262b"); // 7.0:1 on #58a6ff
    expect(emitted("solarized")["--contrast-text"]).toBe(themes.solarized.color.contrastText);
  });

  it("mint and sepia render their CATALOG accent tint and selection, not the shared blue", () => {
    expect(emitted("mint")["--accent-bg"]).toBe("rgba(26, 107, 74, 0.1)");
    expect(emitted("mint")["--selection-color"]).toBe("rgba(26, 107, 74, 0.2)");
    expect(emitted("sepia")["--accent-bg"]).toBe("rgba(139, 69, 19, 0.1)");
    expect(emitted("sepia")["--selection-color"]).toBe("rgba(139, 69, 19, 0.2)");
  });

  it("--quote-text is the theme's readable secondary ink, never the syntax green", () => {
    for (const id of ALL) {
      expect(emitted(id)["--quote-text"], id).toBe(themes[id].color.text.secondary);
      expect(emitted(id)["--quote-text"], id).not.toBe(emitted(id)["--md-char-color"]);
    }
  });

  it("--bg-tertiary is the catalog value on every theme (the border alias is gone)", () => {
    for (const id of ALL) {
      expect(emitted(id)["--bg-tertiary"], id).toBe(themes[id].color.bg.tertiary);
    }
  });

  it("night's legacy accentBg divergence is collapsed into accent.bg", () => {
    expect(themes.night.color.legacy?.accentBg).toBeUndefined();
    expect(emitted("night")["--accent-bg"]).toBe(themes.night.color.accent.bg);
  });

  it("dark error/success hovers are live semantic values, not legacy shadows", () => {
    expect(themes.night.color.semantic.errorHover).toBe("#fca5a5");
    expect(themes.night.color.semantic.successHover).toBe("#86efac");
    expect(emitted("night")["--error-color-hover"]).toBe("#fca5a5");
    expect(emitted("solarized")["--error-color-hover"]).toBe(themes.solarized.color.semantic.errorHover);
  });
});

describe("the static fallbacks are unreachable for the shipped themes", () => {
  // The fallback chain stays for a FUTURE dark theme that omits a legacy key;
  // for the six shipped themes every projected family must come from the
  // catalog, so mutating the fallback must change NOTHING they emit.
  const FAMILIES = [
    "--selection-color", "--accent-bg", "--text-tertiary", "--bg-tertiary",
    "--contrast-text", "--warning-color", "--warning-bg", "--warning-border",
    "--subtle-bg", "--subtle-bg-hover", "--hover-bg", "--hover-bg-strong",
  ];
  it("every family var is provided by the adapter for all six themes", () => {
    for (const id of ALL) {
      const colors = themesAsColors[id];
      expect(colors.selection, id).toBeDefined();
      expect(colors.accentBg, id).toBeDefined();
      expect(colors.textTertiary, id).toBeDefined();
      expect(colors.bgTertiary, id).toBeDefined();
      expect(colors.contrastText, id).toBeDefined();
      expect(colors.warningColor, id).toBeDefined();
      expect(colors.warningBg, id).toBeDefined();
      expect(colors.warningBorder, id).toBeDefined();
      expect(colors.subtleBg, id).toBeDefined();
      expect(colors.subtleBgHover, id).toBeDefined();
      expect(colors.hoverBg, id).toBeDefined();
      expect(colors.hoverBgStrong, id).toBeDefined();
      for (const key of FAMILIES) expect(emitted(id)[key], `${id} ${key}`).toBeTruthy();
    }
  });
});
