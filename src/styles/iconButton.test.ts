// WI-UI2.3 — the `.vm-icon-btn` primitive: the size triple resolves to the
// icon-size tokens, the hit-target floor is real, and `.popup-icon-btn` is an
// alias of the md variant rather than a second recipe.
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const css = readFileSync("src/styles/icon-button-shared.css", "utf8");
const index = readFileSync("src/styles/index.css", "utf8");

function tokenValue(name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(index);
  expect(m, name).not.toBeNull();
  return m![1].trim().split("/*")[0].trim();
}

function rule(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("vm-icon-btn (D2/R7/R9)", () => {
  it("the size triple resolves to the icon-size tokens, sm at the 24px floor", () => {
    expect(rule(".vm-icon-btn--sm")).toContain("var(--icon-size-sm)");
    expect(rule(".vm-icon-btn--lg")).toContain("var(--icon-size-lg)");
    // md is the BASE — .popup-icon-btn aliases it, so the base must carry md.
    expect(rule(".vm-icon-btn,")).toContain("var(--icon-size-md)");
    expect(tokenValue("--icon-size-sm")).toBe("24px");
    expect(tokenValue("--icon-size-md")).toBe("26px");
    expect(tokenValue("--icon-size-lg")).toBe("28px");
    expect(tokenValue("--target-min")).toBe("24px");
  });

  it("popup-icon-btn is an alias, not a second recipe", () => {
    // Every base declaration block names both selectors...
    expect(css).toMatch(/\.vm-icon-btn,\s*\n\.popup-icon-btn \{/);
    // ...and popup-shared.css no longer defines the class at all.
    const popupShared = readFileSync("src/styles/popup-shared.css", "utf8");
    expect(popupShared).not.toContain(".popup-icon-btn");
  });

  it("rest/hover/pressed/disabled speak the state vocabulary", () => {
    const base = rule(".vm-icon-btn,");
    expect(base).toContain("color: var(--text-secondary)");
    expect(base).toContain("cursor: default");
    expect(css).toMatch(/:hover:not\(:disabled\)[^}]*var\(--hover-bg\)/);
    expect(css).toMatch(/:active:not\(:disabled\)[^}]*var\(--hover-bg-strong\)/);
    expect(css).toMatch(/:disabled[^}]*var\(--opacity-disabled\)/);
  });

  it("focus is the flat 2px bar (D4), not a U underline", () => {
    expect(css).toMatch(/focus-visible::after[^}]*height: 2px/);
    expect(css).not.toContain("border-bottom:");
  });

  it("the bordered variant uses --control-border", () => {
    expect(rule(".vm-icon-btn--bordered")).toContain("var(--control-border)");
  });

  it("glyphs are 14px and no stroke-width override survives", () => {
    expect(css).toMatch(/svg \{[^}]*var\(--size-icon-xs\)/);
    expect(css).not.toContain("stroke-width");
    const popupShared = readFileSync("src/styles/popup-shared.css", "utf8");
    expect(popupShared).not.toContain("stroke-width");
  });

  it("the shared expander centres a --target-min hit box", () => {
    expect(css).toMatch(/\.vm-hit-expand::before \{[^}]*var\(--target-min\)/);
  });
});
