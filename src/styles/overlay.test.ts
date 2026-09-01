// WI-UI3.1 — the shared overlay/menu shells: one panel recipe, one backdrop,
// one menu surface. Reads the CSS so a drifted copy fails here, not in review.
// WI-UA3 — the finder backdrop is a real scrim step, never a hover token.
// WI-UA8 — the kbd chip respects the 11px interactive-chrome text floor.
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const css = readFileSync("src/styles/overlay-shared.css", "utf8");

function rule(selector: string): string {
  const start = css.indexOf(selector + " {");
  expect(start, selector).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("vm-overlay (D14)", () => {
  it("the backdrop is fixed, full-inset, at the popup layer", () => {
    const b = rule(".vm-overlay");
    expect(b).toContain("position: fixed");
    expect(b).toContain("inset: 0");
    expect(b).toContain("var(--z-popup)");
  });

  it("the finder backdrop is a real scrim, not a hover token (WI-UA3)", () => {
    const b = rule(".vm-overlay");
    // 8% --hover-bg-strong gave the panel no figure-ground separation over a
    // busy document; the modal variant keeps its own darker 35% scrim.
    expect(b).not.toContain("--hover-bg");
    expect(b).toContain("color-mix(in srgb, black 22%, transparent)");
  });

  it("the kbd chip stays at or above the 11px chrome text floor (WI-UA8)", () => {
    expect(rule(".vm-overlay__kbd")).toContain("var(--font-size-xs)");
  });

  it("the panel carries the shell triple and the viewport clamp", () => {
    const p = rule(".vm-overlay__panel");
    expect(p).toContain("border-radius: var(--radius-lg)");
    expect(p).toContain("box-shadow: var(--popup-shadow)");
    expect(p).toContain("var(--border-color)");
    // Codex #7: the width must clamp to the viewport, not just min(px, vw).
    expect(p).toMatch(/min\(var\(--vm-overlay-width[^)]*\), calc\(100vw - 2 \* var\(--space-4\)\)\)/);
  });

  it("finder rows share one rhythm and R6 selection ink", () => {
    expect(rule(".vm-overlay__row")).toContain("min-height: 36px");
    const sel = css.slice(css.indexOf(".vm-overlay__row.is-selected"));
    expect(sel).toContain("var(--accent-bg)");
  });

  it("the dark shadow override exists", () => {
    expect(css).toMatch(/\.dark-theme \.vm-overlay__panel \{[^}]*var\(--popup-shadow-dark\)/);
  });

  it("vm-menu is the context-menu surface on the CHROME font", () => {
    const m = rule(".vm-menu");
    expect(m).toContain("var(--font-ui)");
    expect(m).toContain("backdrop-filter: blur(20px)");
    expect(m).toContain("var(--radius-lg)");
    expect(css).not.toContain("-apple-system,");
  });
});
