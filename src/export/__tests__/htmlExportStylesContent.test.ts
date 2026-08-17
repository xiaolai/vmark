// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getExportOverrides } from "../exportOverrides";
import { getEditorContentCSS } from "../htmlExportStyles";

describe("getExportOverrides", () => {
  const css = getExportOverrides();

  it("includes an @media print block", () => {
    expect(css).toContain("@media print");
  });

  // Issue #1087: editor "fit to width" is ephemeral DOM state with no markdown
  // representation, so it never survives the fresh re-render into export HTML,
  // and stored ProseMirror colwidth / resized-cell pixel widths would push the
  // table past the @page box where WebKit clips it. Export CSS must fit every
  // table to the page by neutralizing fixed pixel sizing.
  it("fits tables to the page width for print (no fixed pixel columns)", () => {
    expect(css).toContain("table-layout: auto");
    expect(css).not.toContain("table-layout: fixed");
    // <col> pixel widths and resized-cell min-widths are reset so columns reflow
    expect(css).toContain("width: auto !important");
    expect(css).toContain("min-width: 0 !important");
  });

  it("forces table scroll wrapper to visible overflow", () => {
    expect(css).toContain("overflow-x: visible");
  });

  it("wraps long content in table cells without collapsing column widths", () => {
    // `overflow-wrap: break-word` breaks a word only when it cannot fit a line
    // by itself, and leaves min-content at the longest word.
    expect(css).toContain("overflow-wrap: break-word");
  });

  it("declares no word-break on cells — it collapses min-content to one char", () => {
    // This assertion is the inverse of the one it replaces. `word-break:
    // break-word` behaves like `overflow-wrap: anywhere`, dropping a cell's
    // min-content width to a SINGLE CHARACTER, so `table-layout: auto` could
    // squeeze any column arbitrarily narrow — printed table headers came out as
    // "Prop erty" and "Autho rity". The property was declared here AND in
    // sharedContentCSS at equal specificity, so removing it from one alone
    // changed nothing; both had to go.
    const cellRule = css.slice(css.indexOf(".export-surface td,"));
    const decls = cellRule.slice(0, cellRule.indexOf("}")).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(decls).not.toContain("word-break");
  });

  it("constrains images in table cells", () => {
    expect(css).toMatch(/td img[^}]*max-width:\s*100%/s);
  });

  it("hides interactive elements in export", () => {
    expect(css).toContain("ProseMirror-gapcursor");
    expect(css).toContain("display: none !important");
  });

  it("does NOT duplicate alert print icon fallbacks (they come from alert-block.css via the bundle)", () => {
    // Single source of truth: alert-block.css already ships identical
    // @media print alert-icon fallbacks, and editorCSSBundle keeps @media
    // print blocks. Duplicating them here caused two competing definitions
    // for the same print behavior (see editorCSSBundle.test.ts).
    expect(css).not.toContain(".alert-note");
    expect(css).not.toContain(".alert-block .alert-title::before");
  });

  it("keeps the details chevron print fallback (defined only here)", () => {
    // details-block.css has no @media print section, so this fallback's
    // single source of truth IS exportOverrides.
    expect(css).toContain("details > summary::before");
    expect(css).toContain("background-image: url(");
  });

  it("does not force line numbers visible", () => {
    // Line numbers should respect editor setting, not be forced on
    expect(css).not.toMatch(/\.export-surface .code-line-numbers\s*\{[^}]*display:\s*flex/);
  });
});

describe("getEditorContentCSS (composed)", () => {
  const css = getEditorContentCSS();

  it("returns a non-empty string", () => {
    // In test env, ?raw CSS imports may return empty strings.
    // This test verifies the composition works; the overrides portion
    // is always populated since it's a TS template string.
    expect(css.length).toBeGreaterThan(0);
  });

  it("includes export overrides in the composed output", () => {
    // The overrides portion is always present (not from ?raw imports)
    expect(css).toContain("ProseMirror-gapcursor");
    expect(css).toContain("@media print");
  });
});
