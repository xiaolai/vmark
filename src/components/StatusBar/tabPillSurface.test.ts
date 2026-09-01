// WI-UA1 — active tab pill: raised --bg-tertiary surface + --control-border
//          ring (audit 20260901; reverses the 2026-08-31 borderless exception).
// WI-UA2 — tab hover speaks the R6 hover vocabulary, not ink inversion.
//
// The tab-strip pill surface contract.
//
// History: WI-UI3.6 drew the active pill's boundary with a --control-border
// ring; the maintainer superseded that on 2026-08-31 (borderless raised card,
// negative hover). The 2026-09-01 UI audit measured the cost — ~1.05:1
// page-vs-bar contrast on Night left the active tab findable only by a shadow —
// and the maintainer ratified the reversal: the active pill lifts onto
// --bg-tertiary and carries the control-border ring (authored ≥ 3:1 per theme,
// D8) as an inset box-shadow so pill geometry does not change. Hover uses
// --hover-bg-strong + text ink, the same vocabulary as every other hover in
// the chrome (C9), instead of a one-off ink inversion.
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

describe("tab-strip pill surface (raised + ringed, audit 20260901)", () => {
  it(".tab-pill.active lifts onto --bg-tertiary with a control-border ring and the shadow", () => {
    const body = ruleBody(statusBarCss(), ".tab-pill.active {");
    expect(body).toContain("var(--bg-tertiary)");
    expect(body).toContain("var(--control-border)");
    expect(body).toContain("var(--shadow-sm)");
    // The ring must be an inset box-shadow, not a border — a border would
    // change the pill's box and make the strip jump on tab switch.
    expect(body).not.toMatch(/(^|[^-])border:/);
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
