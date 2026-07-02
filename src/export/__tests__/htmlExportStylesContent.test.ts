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

  it("enables word wrapping in table cells", () => {
    expect(css).toContain("overflow-wrap: break-word");
    expect(css).toContain("word-break: break-word");
  });

  it("constrains images in table cells", () => {
    expect(css).toMatch(/td img[^}]*max-width:\s*100%/s);
  });

  it("hides interactive elements in export", () => {
    expect(css).toContain("ProseMirror-gapcursor");
    expect(css).toContain("display: none !important");
  });

  it("includes print alert icon fallbacks", () => {
    expect(css).toContain("alert-note");
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
