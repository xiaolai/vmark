// WI-UC1 — active tab pill is the NEGATIVE treatment (maintainer direction
//          2026-09-02): ink face, page-colour text — contrast is the body
//          pair's own ratio, AA by construction on every theme. Supersedes
//          WI-UA1's --bg-tertiary + ring version of 2026-09-01.
// WI-UA2 — tab hover speaks the R6 hover vocabulary, not ink inversion —
//          which is exactly why active-as-negative is unambiguous now.
//
// The tab-strip pill surface contract.
//
// History: WI-UI3.6 ringed the active pill with --control-border; 2026-08-31
// made it a borderless raised card with NEGATIVE hover; the 2026-09-01 audit
// (WI-UA1/UA2) restored a ring on a --bg-tertiary lift and moved hover to the
// R6 vocabulary; 2026-09-02 the maintainer moved the NEGATIVE treatment onto
// the ACTIVE state itself: ink face, page text, no ring, no shadow. That is
// stronger than the ring on precisely the dark themes the audit flagged, and
// unambiguous now that hover no longer uses the inversion. Inside the ink
// face the dirty dot flips to page ink, and the focus bar paints in
// --bg-color (the accent bar would sink into a near-black face on light
// themes) — the ACTIVE pill is the roving-tabindex stop, so its focus
// indicator is the keyboard-visible one.
//
// The embedded browser's own page tabs (.browser-page-tab) keep their
// WI-UI3.6 control-border idiom — real-browser chrome, separate system.
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const statusBarCss = () => readFileSync("src/components/StatusBar/StatusBar.css", "utf8");

function ruleBody(css: string, selector: string): string {
  const i = css.indexOf(selector);
  expect(i, selector).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf("}", i));
}

describe("tab-strip pill surface (negative active, maintainer 2026-09-02)", () => {
  it(".tab-pill.active is the negative: ink face, page text, no ring, no shadow", () => {
    const body = ruleBody(statusBarCss(), ".tab-pill.active {");
    expect(body).toContain("background-color: var(--text-color)");
    expect(body).toContain("color: var(--bg-color)");
    expect(body).not.toContain("var(--control-border)");
    expect(body).not.toContain("var(--shadow-sm)");
    expect(body).not.toContain("var(--bg-tertiary)");
  });

  it("the ACTIVE pill's focus bar and dirty dot flip to page ink — accent sinks into an ink face", () => {
    const css = statusBarCss();
    const focus = ruleBody(css, ".tab-pill.active:focus-visible {");
    expect(focus).toContain("inset 0 -2px 0 var(--bg-color)");
    // …and it must be declared AFTER the active rule, or active's own
    // declarations swallow it for the roving-tabindex stop.
    expect(css.indexOf(".tab-pill.active {")).toBeLessThan(css.indexOf(".tab-pill.active:focus-visible {"));
    const dot = ruleBody(css, ".tab-pill.active .tab-dirty-dot {");
    expect(dot).toContain("var(--bg-color)");
  });

  it(".tab-pill:hover uses the R6 hover vocabulary — no ink inversion", () => {
    const body = ruleBody(statusBarCss(), ".tab-pill:hover {");
    expect(body).toContain("var(--hover-bg-strong)");
    expect(body).toContain("color: var(--text-color)");
    expect(body).not.toContain("background-color: var(--text-color)");
  });

  it(".browser-workspace-tab:hover speaks the same hover language", () => {
    const body = ruleBody(statusBarCss(), ".browser-workspace-tab:hover {");
    expect(body).toContain("var(--hover-bg-strong)");
    expect(body).not.toContain("background-color: var(--text-color)");
  });

  it(".browser-workspace-tab.active speaks the same ACTIVE language — one strip, one vocabulary", () => {
    const body = ruleBody(statusBarCss(), ".browser-workspace-tab.active {");
    expect(body).toContain("var(--text-color)");
    expect(body).toContain("var(--bg-color)");
    expect(body).not.toContain("var(--accent-bg)");
  });

  it("the active rule still OUTRANKS hover (declared later, equal specificity)", () => {
    const css = statusBarCss();
    // .tab-pill:hover and .tab-pill.active tie at (0,2,0); source order is
    // what keeps the active card stable under the pointer.
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
