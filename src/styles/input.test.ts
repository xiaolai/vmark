// WI-UI3.3 — the `.vm-input` primitive: three treatments, one home.
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const css = readFileSync("src/styles/input-shared.css", "utf8");

function rule(selector: string): string {
  const start = css.indexOf(selector + " {");
  expect(start, selector).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("vm-input (R7)", () => {
  it("the base is the bottom-border transparent field at --font-size-sm", () => {
    const b = rule(".vm-input");
    expect(b).toContain("background: transparent");
    expect(b).toContain("border-bottom: var(--border-thin) solid var(--border-color)");
    expect(b).toContain("font-size: var(--font-size-sm)");
  });

  it("focus is the accent bottom border (rule 33 §3)", () => {
    expect(css).toMatch(/\.vm-input:focus \{[^}]*border-bottom-color: var\(--primary-color\)/);
  });

  it("--field is the fully-bordered tinted variant on --control-border", () => {
    const f = rule(".vm-input--field");
    expect(f).toContain("var(--control-border)");
    expect(f).toContain("var(--bg-tertiary)");
    expect(css).toMatch(/\.vm-input--field:focus \{[^}]*border-color: var\(--primary-color\)/);
  });

  it("--bare is caret-only, and says so", () => {
    const i = css.indexOf(".vm-input--bare,");
    expect(i).toBeGreaterThan(-1);
    expect(css.slice(Math.max(0, i - 300), i)).toContain("focus: caret-only");
  });
});
