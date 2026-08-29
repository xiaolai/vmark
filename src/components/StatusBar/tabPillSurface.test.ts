// WI-UI3.6 — the active tab pill has a REAL surface: on night the page-vs-bar
// contrast alone is ~1.05:1, so the boundary must come from --control-border.
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

describe("active tab pill surface (WI-UI3.6)", () => {
  it(".tab-pill.active draws its boundary with --control-border", () => {
    const css = readFileSync("src/components/StatusBar/StatusBar.css", "utf8");
    const i = css.indexOf(".tab-pill.active {");
    expect(i).toBeGreaterThan(-1);
    const body = css.slice(i, css.indexOf("}", i));
    expect(body).toContain("var(--control-border)");
  });

  it(".browser-page-tab.active uses the same idiom", () => {
    const css = readFileSync("src/components/Browser/browser-chrome.css", "utf8");
    const i = css.indexOf(".browser-page-tab.active {");
    const body = css.slice(i, css.indexOf("}", i));
    expect(body).toContain("var(--control-border)");
  });

  it("the dark --shadow-sm is deep enough to exist on a dark page — in the CATALOG, because applyTheme writes shadows inline and inline outranks the .dark-theme class rule (Codex #9)", async () => {
    const { darkShadows } = await import("@/theme/tokens");
    expect(darkShadows.sm).toContain("0.4");
    // The CSS static agrees, for pre-mount/print consumers.
    const css = readFileSync("src/styles/index.css", "utf8");
    const dark = css.slice(css.indexOf(".dark-theme {"));
    expect(dark).toMatch(/--shadow-sm:[^;]*0\.4\)/);
  });
});
