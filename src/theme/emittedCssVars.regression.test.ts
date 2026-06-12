// WI-3.2 / WI-3.3 — lock the legacy `--*` CSS vars that useTheme.ts emits
// per theme. The night dark-mode overrides moved out of useTheme.ts into the
// typed `night` theme; this test is the behavior-preserving contract: every
// emitted var name + value is frozen so a future catalog edit that would
// change the rendered output fails loudly here.
//
// These are the LEGACY var names the app's CSS actually consumes
// (`--bg-color`, `--accent-bg`, `--alert-note`, …) — NOT the typed
// `--color-*` names written by applyTheme(). The snapshot below was captured
// from the pre-refactor implementation and must not drift.

import { describe, it, expect } from "vitest";
import {
  computeCoreColorVars,
  computeModeColorVars,
} from "@/hooks/useTheme";
import { themes } from "@/stores/settingsStore";
import type { ThemeId } from "@/stores/settingsStore";

/** Full emitted legacy-var map for a theme = core colors + mode colors. */
function emittedVars(id: ThemeId): Record<string, string> {
  const colors = themes[id];
  const isDark = colors.isDark ?? false;
  const { vars } = computeModeColorVars(colors, isDark);
  return { ...computeCoreColorVars(colors), ...vars };
}

const ALL_THEMES: ThemeId[] = ["white", "paper", "mint", "sepia", "night", "solarized"];

describe("emitted legacy CSS vars (behavior-preserving contract)", () => {
  it.each(ALL_THEMES)("%s theme emits the frozen var set", (id) => {
    expect(emittedVars(id)).toMatchSnapshot();
  });

  it("night --accent-bg stays the legacy value (not color.accent.bg)", () => {
    // Guards the intentional divergence: night.color.accent.bg is
    // rgba(88,166,255,…) but the consumed --accent-bg is rgba(90,168,255,…).
    expect(emittedVars("night")["--accent-bg"]).toBe("rgba(90, 168, 255, 0.12)");
    expect(themes.night.background).toBe("#23262b");
  });

  it("night --error-color-hover / --success-color-hover keep legacy tints", () => {
    const night = emittedVars("night");
    expect(night["--error-color-hover"]).toBe("#fca5a5");
    expect(night["--success-color-hover"]).toBe("#86efac");
  });

  it("solarized (2nd dark theme) renders its OWN legacy values, not night's", () => {
    // Proves the per-theme dark-legacy projection: a second dark theme
    // does not silently inherit night's accent/blur/highlight overrides.
    const sol = emittedVars("solarized");
    const night = emittedVars("night");
    expect(sol["--bg-color"]).toBe("#002b36");
    expect(sol["--accent-bg"]).toBe("rgba(38, 139, 210, 0.14)");
    expect(sol["--accent-bg"]).not.toBe(night["--accent-bg"]);
    expect(sol["--md-char-color"]).toBe("#859900");
    expect(sol["--highlight-bg"]).toBe("#4a4a00");
    expect(sol["--alert-important"]).toBe("#6c71c4");
  });

  it("dark mode does NOT emit --warning-* / --contrast-text / --subtle-bg", () => {
    // Preserves the historical quirk: dark mode inherits these from :root.
    const night = emittedVars("night");
    expect(night["--warning-color"]).toBeUndefined();
    expect(night["--contrast-text"]).toBeUndefined();
    expect(night["--subtle-bg"]).toBeUndefined();
  });

  it("dark mode emits white-tint hover feedback (audit 20260612 H15)", () => {
    // Deliberate change: the old quirk inherited light black tints, which
    // are near-invisible on dark backgrounds.
    const night = emittedVars("night");
    expect(night["--hover-bg"]).toBe("rgba(255, 255, 255, 0.08)");
    expect(night["--hover-bg-strong"]).toBe("rgba(255, 255, 255, 0.12)");
  });
});
