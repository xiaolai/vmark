// @vitest-environment node
import { describe, expect, it } from "vitest";
import { themes } from "./themes";
import type { ThemeId } from "./themes";
import {
  NON_MAC_THEME_IDS,
  coerceThemeId,
  selectableThemeIds,
} from "./themeAvailability";

const ALL_IDS = Object.keys(themes) as ThemeId[];

describe("selectableThemeIds", () => {
  it("offers the whole catalog on macOS", () => {
    expect(selectableThemeIds(true)).toEqual(ALL_IDS);
  });

  it("offers only white and night off macOS", () => {
    expect(selectableThemeIds(false)).toEqual(["white", "night"]);
  });

  // Windows/Linux title bars are light-or-dark only, so every offered theme
  // must map onto one of those without ambiguity.
  it("offers exactly one light and one dark option off macOS", () => {
    const offered = selectableThemeIds(false);
    const dark = offered.filter((id) => themes[id].isDark);
    const light = offered.filter((id) => !themes[id].isDark);
    expect(dark).toHaveLength(1);
    expect(light).toHaveLength(1);
  });

  it("only offers themes that exist in the catalog", () => {
    for (const id of selectableThemeIds(false)) {
      expect(themes[id]).toBeDefined();
    }
  });

  it("does not let callers mutate the shared list", () => {
    const first = selectableThemeIds(false);
    first.push("sepia" as ThemeId);
    expect(selectableThemeIds(false)).toEqual(["white", "night"]);
  });
});

describe("coerceThemeId", () => {
  it("leaves every theme untouched on macOS", () => {
    for (const id of ALL_IDS) {
      expect(coerceThemeId(id, true)).toBe(id);
    }
  });

  it("keeps the two supported themes off macOS", () => {
    for (const id of NON_MAC_THEME_IDS) {
      expect(coerceThemeId(id, false)).toBe(id);
    }
  });

  // A user who picked sepia on macOS, then synced settings to Windows, must
  // land on a theme of the same polarity — not be flipped from light to dark.
  it("maps an unsupported light theme to white", () => {
    for (const id of ALL_IDS.filter((i) => !themes[i].isDark)) {
      expect(coerceThemeId(id, false)).toBe("white");
    }
  });

  it("maps an unsupported dark theme to night", () => {
    for (const id of ALL_IDS.filter((i) => themes[i].isDark)) {
      expect(coerceThemeId(id, false)).toBe("night");
    }
  });

  it("never returns an unsupported theme off macOS", () => {
    for (const id of ALL_IDS) {
      expect(NON_MAC_THEME_IDS).toContain(coerceThemeId(id, false));
    }
  });

  // Corrupted localStorage is a real source of unknown ids (the existing
  // useTheme code already guards against it), so this must not throw.
  it("falls back to white for an unknown id", () => {
    expect(coerceThemeId("does-not-exist" as ThemeId, false)).toBe("white");
  });

  it("passes an unknown id through untouched on macOS", () => {
    // macOS keeps its existing behavior: useTheme's own `?? themes.paper`
    // guard handles unknown ids there, so this must not silently rewrite it.
    expect(coerceThemeId("does-not-exist" as ThemeId, true)).toBe(
      "does-not-exist"
    );
  });
});
