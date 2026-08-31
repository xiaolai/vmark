// The tab-strip pill surface contract.
//
// WI-UI3.6 originally drew the active pill's boundary with a --control-border
// ring. The maintainer superseded that on 2026-08-31: the strip's pills are
// BORDERLESS — the active pill is a raised --shadow-sm card sharing the page
// surface, and hover is a photographic NEGATIVE (ink and page swap tokens, so
// the pair's contrast is the body ratio, AA by construction in every theme).
// The dark --shadow-sm depth is therefore MORE load-bearing than before: it is
// now the active pill's only boundary on a dark page.
//
// The embedded browser's own page tabs (.browser-page-tab) deliberately KEEP
// the WI-UI3.6 control-border idiom — real-browser chrome, separate system.
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const statusBarCss = () => readFileSync("src/components/StatusBar/StatusBar.css", "utf8");

function ruleBody(css: string, selector: string): string {
  const i = css.indexOf(selector);
  expect(i, selector).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf("}", i));
}

describe("tab-strip pill surface (borderless + negative hover, 2026-08-31)", () => {
  it(".tab-pill.active is a borderless raised card — no control-border ring", () => {
    const body = ruleBody(statusBarCss(), ".tab-pill.active {");
    expect(body).not.toContain("var(--control-border)");
    expect(body).toContain("var(--shadow-sm)");
    expect(body).toContain("var(--bg-color)");
  });

  it(".tab-pill:hover inverts — ink background, page-colour text", () => {
    const body = ruleBody(statusBarCss(), ".tab-pill:hover {");
    expect(body).toContain("background-color: var(--text-color)");
    expect(body).toContain("color: var(--bg-color)");
  });

  it(".browser-workspace-tab:hover speaks the same negative hover language", () => {
    const body = ruleBody(statusBarCss(), ".browser-workspace-tab:hover {");
    expect(body).toContain("var(--text-color)");
    expect(body).toContain("var(--bg-color)");
  });

  it("the active rule still OUTRANKS the hover inversion (declared later, equal specificity)", () => {
    const css = statusBarCss();
    // .tab-pill:hover and .tab-pill.active tie at (0,2,0); source order is
    // what keeps the active card stable under the pointer. A refactor that
    // reorders them would make hovering the active tab invert it.
    expect(css.indexOf(".tab-pill:hover {")).toBeLessThan(css.indexOf(".tab-pill.active {"));
  });

  it(".browser-page-tab.active KEEPS the control-border idiom (browser chrome is a separate system)", () => {
    const css = readFileSync("src/components/Browser/browser-chrome.css", "utf8");
    const body = ruleBody(css, ".browser-page-tab.active {");
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
