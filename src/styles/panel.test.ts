// WI-UI3.4 — panel/chip/switch/spinner/scrollbar primitives.
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const css = readFileSync("src/styles/panel-shared.css", "utf8");

function rule(selector: string): string {
  const start = css.indexOf(selector + " {");
  expect(start, selector).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("panel primitives (WI-UI3.4)", () => {
  it("the header rhythm is 8/12 with a --font-size-md title", () => {
    expect(rule(".vm-panel__header")).toContain("var(--spacing-2) var(--spacing-3)");
    expect(rule(".vm-panel__title")).toContain("var(--font-size-md)");
  });

  it("vm-chip is a pill on --control-border at --font-size-xs", () => {
    const c = rule(".vm-chip");
    expect(c).toContain("var(--radius-pill)");
    expect(c).toContain("var(--control-border)");
    expect(c).toContain("var(--font-size-xs)");
    expect(rule(".vm-chip--toggle")).toContain("var(--radius-sm)");
  });

  it("vm-switch is a BORDERLESS 36x20 track with a page-colour knob (maintainer 2026-09-02)", () => {
    const s = rule(".vm-switch");
    expect(s).toContain("width: 36px");
    expect(s).toContain("height: 20px");
    expect(s).toContain("border: none");
    expect(s).toContain("var(--hover-bg-strong)");
    expect(rule(".vm-switch__knob")).toContain("var(--bg-color)");
  });

  // The knob is centred by ARITHMETIC, so assert the insets rather than the
  // literals — this fails on any future retune of the track or the travel that
  // reintroduces #1391's asymmetry, not merely on a changed `top`.
  it("the switch knob sits centred in its track, off and on", () => {
    const px = (block: string, prop: string): number => {
      const m = new RegExp(`(?:^|[;{\\s])${prop}:\\s*(-?\\d+(?:\\.\\d+)?)px`).exec(block);
      expect(m, `${prop} in ${block}`).not.toBeNull();
      return Number(m![1]);
    };

    const track = rule(".vm-switch");
    const knob = rule(".vm-switch__knob");
    const checked = rule('.vm-switch[aria-checked="true"] .vm-switch__knob');

    const trackW = px(track, "width");
    const trackH = px(track, "height");
    const knobW = px(knob, "width");
    const knobH = px(knob, "height");
    const top = px(knob, "top");
    const left = px(knob, "left");
    const travel = Number(/translateX\((-?\d+(?:\.\d+)?)px\)/.exec(checked)?.[1]);

    expect(travel).not.toBeNaN();
    // Vertical: equal air above and below.
    expect(trackH - top - knobH).toBe(top);
    // Horizontal: the off-state left inset equals the on-state right inset.
    expect(trackW - (left + travel) - knobW).toBe(left);
  });

  it("vm-spinner is the one spinner", () => {
    const s = rule(".vm-spinner");
    expect(s).toContain("var(--border-medium)");
    expect(s).toContain("border-top-color: var(--primary-color)");
    expect(css).toContain("@keyframes vm-spin");
  });

  it("vm-scroll--thin narrows the scrollbar to 2px", () => {
    expect(css).toMatch(/\.vm-scroll--thin::-webkit-scrollbar \{[^}]*width: 2px/);
  });
});
