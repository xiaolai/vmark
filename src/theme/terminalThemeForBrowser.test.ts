// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTerminalThemeId } from "./terminalThemeForBrowser";
import { themes, type ThemeId } from "./themes";

const ALL: ThemeId[] = Object.keys(themes) as ThemeId[];

describe("resolveTerminalThemeId", () => {
  it.each(ALL)("returns %s unchanged when no browser tab is active", (id) => {
    expect(resolveTerminalThemeId(id, false)).toBe(id);
  });

  it.each(ALL.filter((id) => !themes[id].isDark))(
    "collapses light theme %s to the pure-white neutral under a browser tab",
    (id) => {
      expect(resolveTerminalThemeId(id, true)).toBe("white");
    },
  );

  it.each(ALL.filter((id) => themes[id].isDark))(
    "collapses dark theme %s to the dark neutral under a browser tab",
    (id) => {
      expect(resolveTerminalThemeId(id, true)).toBe("night");
    },
  );

  // The whole point of the change: a browser frame must be a TRUE neutral, so
  // a tinted theme must not survive. paper (#eeeded warm grey), mint and sepia
  // are the ones that looked wrong beside a web page.
  it("does not leave a tinted theme in place under a browser tab", () => {
    for (const id of ["paper", "mint", "sepia", "solarized"] as ThemeId[]) {
      expect(resolveTerminalThemeId(id, true)).not.toBe(id);
    }
  });

  it("is idempotent — the neutrals resolve to themselves", () => {
    expect(resolveTerminalThemeId("white", true)).toBe("white");
    expect(resolveTerminalThemeId("night", true)).toBe("night");
  });

  it("falls back to the light neutral for a corrupt persisted id", () => {
    expect(resolveTerminalThemeId("__proto__" as ThemeId, true)).toBe("white");
    expect(resolveTerminalThemeId("nope" as ThemeId, true)).toBe("white");
  });
});

describe("the neutrals match the browser chrome exactly", () => {
  // Audit 20260815-163607 #5. This suite previously compared the theme values to
  // LITERALS copied from the CSS, which pins nothing: editing
  // `--browser-bg-color` leaves it green and the seam returns. Read the real
  // stylesheet, so the assertion has two independent sides.
  const css = readFileSync(resolve(import.meta.dirname, "../styles/index.css"), "utf8");

  /** The `--browser-bg-color` declared in `:root` (light) or in `.dark-theme`. */
  function browserBg(scope: "light" | "dark"): string {
    const block =
      scope === "dark"
        ? /\.dark-theme\s*\{([\s\S]*?)\}/.exec(css)
        : /:root\s*\{([\s\S]*?)\}/.exec(css);
    if (!block) throw new Error(`no ${scope} block in index.css`);
    const decl = /--browser-bg-color\s*:\s*([^;]+)/.exec(block[1]);
    if (!decl) throw new Error(`no --browser-bg-color in the ${scope} block`);
    return decl[1].trim().toLowerCase();
  }

  it("light chrome equals the white theme's background", () => {
    expect(browserBg("light")).toBe(themes.white.color.bg.primary.toLowerCase());
  });

  it("dark chrome equals the night theme's background", () => {
    expect(browserBg("dark")).toBe(themes.night.color.bg.primary.toLowerCase());
  });

  // Guard the guard: if the extractor silently stopped finding a declaration it
  // would throw, but a typo that made both sides read the SAME block would pass
  // both assertions above while proving nothing.
  it("reads two different declarations", () => {
    expect(browserBg("light")).not.toBe(browserBg("dark"));
  });
});
