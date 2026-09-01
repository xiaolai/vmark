// @vitest-environment node
// WI-UI2.2 — the @theme inline bridge: one type scale for chrome (D1/R4).
/**
 * Tailwind v4 utilities are variable-backed, so the bridge retargets every
 * `text-*`/`font-*`/`shadow-*` usage onto VMark's tokens with zero TSX edits.
 * This reads index.css (never node_modules — permission-denied in some
 * sessions) and asserts each namespace VMark uses resolves onto a token.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles/index.css", "utf8");
const themeBlock = (() => {
  const start = css.indexOf("@theme inline {");
  expect(start, "@theme inline block present").toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
})();

function mapped(name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(themeBlock);
  expect(m, name).not.toBeNull();
  return m![1].trim();
}

describe("@theme inline bridge (D1)", () => {
  it("maps the text scale onto the chrome type tokens — text-xs stays 12, text-sm becomes 13", () => {
    // WI-UB2 (re-audit 20260901): 10px is retired — the token, its bridge
    // utility and every consumer are gone; interactive text floors at 11px.
    expect(themeBlock).not.toContain("--text-2xs");
    expect(mapped("--text-xs")).toBe("var(--font-size-sm)");
    expect(mapped("--text-sm")).toBe("var(--font-size-base)");
    expect(mapped("--text-base")).toBe("var(--font-size-md)");
    expect(mapped("--text-lg")).toBe("var(--font-size-lg)");
    expect(mapped("--text-xl")).toBe("var(--font-size-lg)");
  });

  it("every text step carries its line-height companion (mandatory — text-* sets leading too)", () => {
    for (const step of ["xs", "sm", "base", "lg", "xl"]) {
      expect(mapped(`--text-${step}--line-height`)).toMatch(/^var\(--line-height-/);
    }
  });

  it("font-sans is the CHROME face and shadow-popup self-names onto the adaptive runtime var", () => {
    expect(mapped("--font-sans")).toBe("var(--font-ui)");
    expect(mapped("--font-mono")).toBe("var(--font-mono)");
    // NOT var(--popup-shadow): that is the static LIGHT literal, and `inline`
    // would bake it into every shadow-popup utility. Self-naming resolves to
    // the theme-adaptive --shadow-popup applyTheme() writes at runtime.
    expect(mapped("--shadow-popup")).toBe("var(--shadow-popup)");
  });

  it("bare `rounded` (a 0.25rem Tailwind literal) still equals --radius-sm", () => {
    // rounded-sm/md/lg resolve through our identically-named :root tokens;
    // bare `rounded` is the one literal. Pin the equality so a --radius-sm
    // retint cannot silently strand 32 usages at the old 4px.
    const m = /--radius-sm:\s*([^;]+);/.exec(css);
    expect(m![1].trim()).toBe("4px"); // 0.25rem
  });
});
