// @vitest-environment node
/**
 * Every CSS variable the exported document CONSUMES must be DEFINED in it.
 *
 * A `var(--x)` that resolves to nothing does not fall back to an initial value
 * and does not warn — it invalidates the entire declaration at computed-value
 * time. One missing primitive silently deletes a rule, the PDF renders without
 * it, and every other check stays green.
 *
 * Not hypothetical: the export shipped 26 undefined primitives (`--border-thin`,
 * `--space-*`, `--font-size-*`, `--duration-*`, …) that live only in
 * `src/styles/index.css` and appear in no theme snapshot. `--border-thin` is
 * what `editor.css` uses to draw table borders, so every exported table had no
 * borders at all — in every PDF VMark had ever produced.
 *
 * **This reads the stylesheets from DISK on purpose.** Under Vitest a
 * `?raw` CSS import resolves to an EMPTY STRING (measured: `editor.css?raw` and
 * `index.css?raw` both length 0, while `getEditorContentCSS()` returns only its
 * TS-authored half). A version of this test that imported the bundle passed
 * while examining nothing at all. Disk reading is what makes the assertion real.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { extractRootBlocks } from "../primitiveTokens";
import { getSharedContentCSS, getForceLightThemeCSS } from "../pdfHtmlTemplate";
import { getExportOverrides } from "../exportOverrides";
import { EXPORT_CSS_VARS } from "../themeSnapshot";

const INDEX_CSS = "src/styles/index.css";
const BUNDLE_TS = "src/export/editorCSSBundle.ts";

/** The stylesheets `editorCSSBundle.ts` inlines, resolved to real paths. */
function bundledStylesheets(): string[] {
  const src = readFileSync(BUNDLE_TS, "utf8");
  return [...src.matchAll(/from "@\/([^"?]+)\?raw"/g)].map((m) => `src/${m[1]!}`);
}

/** `var(--x)` with NO fallback — `var(--x, 1px)` is safe by construction. */
function consumedWithoutFallback(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*([,)])/g)) {
    if (m[2] === ")") out.add(m[1]!);
  }
  return out;
}

function declared(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]!));
}

/** Written by buildTypographyCSS at export time, so never in a stylesheet. */
const RUNTIME_VARS = [
  "--editor-font-size",
  "--editor-font-size-sm",
  "--editor-font-size-mono",
  "--editor-font-size-block",
  "--editor-line-height",
  "--editor-line-height-px",
  "--code-padding",
  "--cjk-letter-spacing",
  "--font-sans",
];

describe("exported CSS variable coverage", () => {
  const sheets = bundledStylesheets();
  const bundledCSS = sheets.map((p) => readFileSync(p, "utf8")).join("\n");
  const primitives = extractRootBlocks(readFileSync(INDEX_CSS, "utf8"));

  it("reads a non-empty bundle — guards against the vacuous version", () => {
    expect(sheets.length).toBeGreaterThan(15);
    expect(bundledCSS.length).toBeGreaterThan(20_000);
    expect(primitives.length).toBeGreaterThan(1_000);
  });

  it("defines every variable the bundled editor CSS consumes", () => {
    const defined = new Set<string>([
      ...declared(primitives),
      ...declared(bundledCSS),
      ...declared(getSharedContentCSS()),
      ...declared(getForceLightThemeCSS()),
      ...declared(getExportOverrides()),
      ...EXPORT_CSS_VARS,
      ...RUNTIME_VARS,
    ]);

    const missing = [...consumedWithoutFallback(bundledCSS)]
      .filter((v) => !defined.has(v))
      .sort();

    expect(missing).toEqual([]);
  });

  it("ships the primitive that every table border depends on", () => {
    expect(primitives).toMatch(/--border-thin:\s*1px/);
  });

  it("takes :root only — a themed override must not leak into the export", () => {
    const css = [
      ":root { --a: 1px; }",
      ".dark-theme { --a: 9px; --only-dark: 1; }",
      ":root { --b: 2px; }",
    ].join("\n");
    const out = extractRootBlocks(css);
    expect(out).toContain("--a: 1px");
    expect(out).toContain("--b: 2px");
    expect(out).not.toContain("--only-dark");
    expect(out).not.toContain("9px");
  });

  it("returns empty rather than a bare :root when there is nothing to emit", () => {
    expect(extractRootBlocks(".foo { color: red }")).toBe("");
  });
});

/**
 * The CSS builders return template literals, so a backtick anywhere inside one —
 * including inside a CSS comment — terminates the literal and breaks the build.
 * That happened three times while writing these rules, each time costing a
 * verification cycle. The transform error is loud, but only once someone runs
 * the suite; this makes the same mistake fail on the rule itself, and also
 * catches the quieter variant where a PAIR of backticks balances and silently
 * injects an interpolation into the stylesheet.
 */
describe("generated stylesheets are well-formed", () => {
  const sheets: Array<[string, string]> = [
    ["sharedContentCSS", getSharedContentCSS()],
    ["forceLightThemeCSS", getForceLightThemeCSS()],
    ["exportOverrides", getExportOverrides()],
  ];

  it.each(sheets)("%s contains no backtick", (_name, css) => {
    expect(css).not.toContain("`");
  });

  it.each(sheets)("%s has balanced braces", (_name, css) => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0;
    let min = 0;
    for (const ch of stripped) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        min = Math.min(min, depth);
      }
    }
    expect({ depth, min }).toEqual({ depth: 0, min: 0 });
  });
});

/**
 * `word-break: break-word` collapses a cell's min-content width to one
 * character, so `table-layout: auto` may squeeze any column arbitrarily narrow
 * and break ordinary words — printed headers came out as "Prop erty".
 *
 * The rule is declared TWICE at equal specificity (exportOverrides and
 * sharedContentCSS), so removing it from one had no effect: the other still
 * declared it and last-one-wins applied it. This asserts on the COMBINED
 * stylesheet, which is the only level at which the property is really absent.
 */
describe("table cells do not collapse to one-character columns", () => {
  const combined = [getSharedContentCSS(), getExportOverrides()].join("\n");

  it("declares no word-break on table cells anywhere in the export CSS", () => {
    const offenders: string[] = [];
    const noComments = combined.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of noComments.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const sel = m[1]!;
      const decls = m[2]!;
      if (/\b(td|th)\b/.test(sel) && !/\b(code|kbd)\b/.test(sel) && /word-break/.test(decls)) {
        offenders.push(sel.trim().replace(/\s+/g, " "));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("still lets a long code token break, so one cell cannot overflow the page", () => {
    const noComments = combined.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(noComments).toMatch(/(td|th)\s+code[^{]*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});
