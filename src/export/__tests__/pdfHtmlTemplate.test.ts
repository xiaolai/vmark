/**
 * Tests for pdfHtmlTemplate @page CSS generation.
 *
 * Focuses on the landscape regression: CSS Paged Media requires a page-size
 * keyword (A4/letter/...) before an orientation keyword, not explicit
 * <length> pairs, otherwise WebKit silently falls back to portrait.
 */

import { describe, it, expect } from "vitest";
import { buildPdfExportHtml, type PdfOptions } from "../pdfHtmlTemplate";

function baseOptions(overrides: Partial<PdfOptions> = {}): PdfOptions {
  return {
    pageSize: "a4",
    orientation: "portrait",
    marginTop: 25.4,
    marginRight: 25.4,
    marginBottom: 25.4,
    marginLeft: 25.4,
    fontSize: 11,
    lineHeight: 1.6,
    cjkLetterSpacing: "0.05em",
    latinFont: "system",
    cjkFont: "system",
    useEditorTheme: false,
    ...overrides,
  };
}

function getPageCss(html: string): string {
  const match = html.match(/@page\s*{[^}]*}/);
  if (!match) throw new Error("No @page rule found in output HTML");
  return match[0];
}

describe("pdfHtmlTemplate buildPdfExportHtml — @page size", () => {
  it.each([
    { pageSize: "a4", expectedKeyword: "A4" },
    { pageSize: "letter", expectedKeyword: "letter" },
    { pageSize: "a3", expectedKeyword: "A3" },
    { pageSize: "legal", expectedKeyword: "legal" },
  ] as const)("emits keyword '$expectedKeyword' for pageSize=$pageSize", ({ pageSize, expectedKeyword }) => {
    const html = buildPdfExportHtml("", "", "", baseOptions({ pageSize }));
    const pageCss = getPageCss(html);
    expect(pageCss).toContain(`size: ${expectedKeyword} portrait`);
  });

  it("emits a valid 'A4 landscape' for landscape orientation (not '210mm 297mm landscape')", () => {
    const html = buildPdfExportHtml("", "", "", baseOptions({ orientation: "landscape" }));
    const pageCss = getPageCss(html);
    expect(pageCss).toContain("size: A4 landscape");
    // Explicit regression guard: the invalid length+orientation mix must be gone.
    expect(pageCss).not.toMatch(/\d+mm\s+\d+mm\s+landscape/);
  });

  it("emits the configured margins in mm", () => {
    const html = buildPdfExportHtml(
      "",
      "",
      "",
      baseOptions({ marginTop: 10, marginRight: 15, marginBottom: 20, marginLeft: 25 }),
    );
    const pageCss = getPageCss(html);
    expect(pageCss).toContain("margin: 10mm 15mm 20mm 25mm");
  });
});

// Font embedding is exercised end-to-end by katexFontEmbed.test.ts using real
// woff2 inputs. A template-level assertion can't run here because Vitest's
// transformer returns an empty string for `?raw` imports of katex.min.css
// (a Vite/vitest-specific quirk; the production Vite build loads it correctly).
