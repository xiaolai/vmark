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
