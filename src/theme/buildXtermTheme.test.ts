// @vitest-environment node
// WI-UI1.4 — the terminal palette as measured data: derivations and the bold flag.
import { describe, it, expect } from "vitest";
import { buildXtermThemeForId, drawBoldTextInBrightColorsForId, withAlpha } from "./buildXtermTheme";
import { themes, type ThemeId } from "./themes";

const ALL = Object.keys(themes) as ThemeId[];

describe("withAlpha", () => {
  it("re-alphas rgba() and hex, passes through anything else", () => {
    expect(withAlpha("rgba(26, 107, 74, 0.2)", 0.25)).toBe("rgba(26, 107, 74, 0.25)");
    expect(withAlpha("#d6d9de", 0.4)).toBe("rgba(214, 217, 222, 0.4)");
    expect(withAlpha("white", 0.4)).toBe("white");
  });
});

describe("derived selection (the field is gone from the catalog)", () => {
  it("terminal selection IS the app selection at canvas alpha .25, per theme", () => {
    for (const id of ALL) {
      expect(buildXtermThemeForId(id).selectionBackground, id).toBe(
        withAlpha(themes[id].color.selection, 0.25),
      );
    }
  });

  it("mint's terminal selection is mint's green, not the dead shared blue", () => {
    expect(buildXtermThemeForId("mint").selectionBackground).toBe("rgba(26, 107, 74, 0.25)");
  });
});

describe("derived scrollbar (xterm's .2/.4/.5 rule over the text ink)", () => {
  it("thumb alphas derive from text.primary for every theme", () => {
    for (const id of ALL) {
      const t = buildXtermThemeForId(id);
      const ink = themes[id].color.text.primary;
      expect(t.scrollbarSliderBackground, id).toBe(withAlpha(ink, 0.2));
      expect(t.scrollbarSliderHoverBackground, id).toBe(withAlpha(ink, 0.4));
      expect(t.scrollbarSliderActiveBackground, id).toBe(withAlpha(ink, 0.5));
    }
  });
});

describe("drawBoldTextInBrightColors (D10)", () => {
  it("is false for solarized (bright slots are text tiers) and true elsewhere", () => {
    expect(drawBoldTextInBrightColorsForId("solarized")).toBe(false);
    for (const id of ALL.filter((x) => x !== "solarized")) {
      expect(drawBoldTextInBrightColorsForId(id), id).toBe(true);
    }
  });
});

describe("bright rows are distinguishable (the C1d Δ rule, in the app tier)", () => {
  const PAIRS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
  it("every light theme's bright slot sits ≥ 15 max-channel Δ from its normal slot", () => {
    const rgb = (c: string) => {
      const n = parseInt(c.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    for (const id of ALL) {
      if (themes[id].isDark) continue; // dark themes were already distinct; solarized is D10-exempt
      for (const name of PAIRS) {
        const bright = ("bright" + name[0].toUpperCase() + name.slice(1)) as keyof (typeof themes)[typeof id]["terminal"]["ansi"];
        const a = rgb(themes[id].terminal.ansi[name]);
        const b = rgb(themes[id].terminal.ansi[bright]);
        const delta = Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i])));
        expect(delta, `${id} ${bright}`).toBeGreaterThanOrEqual(15);
      }
    }
  });
});
