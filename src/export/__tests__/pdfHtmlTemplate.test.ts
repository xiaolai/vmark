// @vitest-environment node
/**
 * Tests for pdfHtmlTemplate @page CSS generation.
 *
 * Focuses on the landscape regression: CSS Paged Media requires a page-size
 * keyword (A4/letter/...) before an orientation keyword, not explicit
 * <length> pairs, otherwise WebKit silently falls back to portrait.
 */

import { describe, it, expect } from "vitest";
import { buildPdfExportHtml, expandDetails, getSharedContentCSS, type PdfOptions } from "../pdfHtmlTemplate";

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

// Issue #1087: the PDF/Print shared CSS must fit tables to the fixed page
// width. Stored ProseMirror colwidth (<col style="width:Npx">) and resized-cell
// inline pixel widths otherwise survive the export re-render and, under
// table-layout: fixed, push the table past the @page box where WebKit clips it.
describe("pdfHtmlTemplate shared content CSS — table fit-to-page", () => {
  const css = getSharedContentCSS();

  it("uses auto table layout, never fixed", () => {
    expect(css).toContain("table-layout: auto");
    expect(css).not.toContain("table-layout: fixed");
  });

  it("resets stored column and cell pixel widths so columns reflow", () => {
    expect(css).toContain("width: auto !important");
    expect(css).toContain("min-width: 0 !important");
  });

  it("keeps cell word-wrapping for long content", () => {
    expect(css).toContain("overflow-wrap: break-word");
    expect(css).toContain("word-break: break-word");
  });

  it("constrains the table to full page width", () => {
    expect(css).toContain("width: 100% !important");
  });
});

// Font embedding is exercised end-to-end by katexFontEmbed.test.ts using real
// woff2 inputs. A template-level assertion can't run here because Vitest's
// transformer returns an empty string for `?raw` imports of katex.min.css
// (a Vite/vitest-specific quirk; the production Vite build loads it correctly).

/**
 * The captured theme CSS carries the ON-SCREEN pixel sizes, and the export's
 * typography block overrides only some of them. Any size variable it forgets
 * keeps the editor's px value while body text switches to the chosen pt size —
 * so the element renders larger in the PDF than it does in the editor.
 *
 * `--editor-font-size-block` drives lists, blockquotes and tables
 * (`editor.css`) plus alert and details blocks (their plugin CSS). It is
 * deliberately an ABSOLUTE value rather than an `em`, so that nesting does not
 * compound — which is exactly why it cannot be left to inherit.
 */
describe("pdfHtmlTemplate buildPdfExportHtml — typography scaling", () => {
  const THEME_CSS = ":root { --editor-font-size: 20px; --editor-font-size-block: 20px; }";

  /** Last wins in CSS, so the effective value is the final declaration. */
  function effective(html: string, varName: string): string | undefined {
    const all = [...html.matchAll(new RegExp(`${varName}:\\s*([^;\n}]+)`, "g"))];
    return all.at(-1)?.[1]?.trim();
  }

  it("overrides every font-size variable the theme snapshot supplies in px", () => {
    const html = buildPdfExportHtml("<p>x</p>", THEME_CSS, "", baseOptions({ fontSize: 11 }), false);
    expect(effective(html, "--editor-font-size")).toBe("11pt");
    expect(effective(html, "--editor-font-size-block")).toBe("11pt");
  });

  it("keeps block text the same size as body text, as the editor does", () => {
    const html = buildPdfExportHtml("<p>x</p>", THEME_CSS, "", baseOptions({ fontSize: 9 }), false);
    const body = effective(html, "--editor-font-size");
    expect(body).toBe("9pt");
    expect(effective(html, "--editor-font-size-block")).toBe(body);
  });

  it("preserves the editor's block-size ratio rather than flattening it", () => {
    // blockFontSize 0.9 in the editor: 18px block against a 20px base.
    const themed = ":root { --editor-font-size: 20px; --editor-font-size-block: 18px; }";
    const html = buildPdfExportHtml("<p>x</p>", themed, "", baseOptions({ fontSize: 10 }), false);
    expect(effective(html, "--editor-font-size-block")).toBe("9pt");
  });

  it("falls back to body size when the snapshot lacks the block variable", () => {
    const html = buildPdfExportHtml("<p>x</p>", ":root { --color: red; }", "", baseOptions({ fontSize: 12 }), false);
    expect(effective(html, "--editor-font-size-block")).toBe("12pt");
  });

  it("scales code-block padding with the export font size, not the screen size", () => {
    const themed = ":root { --editor-font-size: 20px; --code-padding: 20px; }";
    const html = buildPdfExportHtml("<p>x</p>", themed, "", baseOptions({ fontSize: 11 }), false);
    expect(effective(html, "--code-padding")).toBe("11pt");
  });

  it("emits the typography block after the captured theme, so it wins", () => {
    const html = buildPdfExportHtml("<p>x</p>", THEME_CSS, "", baseOptions(), false);
    expect(html.indexOf("--editor-font-size-block: 11pt")).toBeGreaterThan(
      html.indexOf("--editor-font-size-block: 20px"),
    );
  });
});

/**
 * `break-inside: avoid` only relocates a block that FITS somewhere. A figure
 * taller than the content area fits nowhere, so the engine splits it and the
 * reader never sees it whole. These bound it to the printable height instead.
 */
describe("pdfHtmlTemplate buildPdfExportHtml — fitting oversized content", () => {
  /** All emitted bounds, in source order: [wrapper, image]. */
  function bounds(html: string): number[] {
    const all = [...html.matchAll(/max-height:\s*([\d.]+)mm/g)].map((m) =>
      Number.parseFloat(m[1]!),
    );
    if (all.length < 2) throw new Error(`expected wrapper + image bounds, got ${all.length}`);
    return all;
  }
  /** The IMAGE bound — the smaller one, and the one that must leave room. */
  function maxHeightMm(html: string): number {
    return Math.min(...bounds(html));
  }

  it("bounds images to the printable height, not the paper height", () => {
    // A4 is 297mm tall; 25.4mm margins leave 246.2mm, minus the wrapper's own
    // margin and a small allowance.
    const html = buildPdfExportHtml("<p>x</p>", "", "", baseOptions(), false);
    expect(maxHeightMm(html)).toBeCloseTo((297 - 25.4 - 25.4 - 3 - 4) * 0.92, 1);
  });

  /**
   * The invariant that actually decides whether a figure can EVER fit: what
   * must land on the page is the image PLUS its wrapper's margin. Bounding only
   * the image left the block 3.7mm over the content area, so it straddled two
   * pages on WebKit no matter how the bound was written.
   */
  it("leaves room for the wrapper, so image + margin fits the content area", () => {
    // Only the four sizes PdfOptions actually accepts. An invalid one falls
    // back to A4 silently, which would make this assertion pass for the wrong
    // reason — it did, on a first draft that used "a5".
    const MM: Record<string, [number, number]> = {
      a4: [210, 297],
      letter: [215.9, 279.4],
      a3: [297, 420],
      legal: [215.9, 355.6],
    };
    for (const pageSize of Object.keys(MM)) {
      for (const orientation of ["portrait", "landscape"]) {
        for (const margin of [25.4, 10]) {
          const opts = baseOptions({
            pageSize, orientation, marginTop: margin, marginBottom: margin,
          } as Partial<PdfOptions>);
          const html = buildPdfExportHtml("<p>x</p>", "", "", opts, false);
          const [shortMm, longMm] = MM[pageSize]!;
          const heightMm = orientation === "landscape" ? shortMm : longMm;
          const contentMm = heightMm - margin - margin;
          expect(maxHeightMm(html) + 3).toBeLessThanOrEqual(contentMm + 0.01);
        }
      }
    }
  });

  it("shrinks the bound when margins grow", () => {
    const normal = maxHeightMm(buildPdfExportHtml("<p>x</p>", "", "", baseOptions(), false));
    const wide = maxHeightMm(
      buildPdfExportHtml("<p>x</p>", "", "", baseOptions({ marginTop: 50, marginBottom: 50 }), false),
    );
    expect(wide).toBeLessThan(normal);
  });

  it("uses the SHORT edge in landscape", () => {
    const portrait = maxHeightMm(buildPdfExportHtml("<p>x</p>", "", "", baseOptions(), false));
    const landscape = maxHeightMm(
      buildPdfExportHtml("<p>x</p>", "", "", baseOptions({ orientation: "landscape" }), false),
    );
    expect(landscape).toBeLessThan(portrait);
    expect(landscape).toBeCloseTo((210 - 25.4 - 25.4 - 3 - 4) * 0.92, 1);
  });

  it("never emits a negative or absurdly small bound", () => {
    const html = buildPdfExportHtml(
      "<p>x</p>", "", "",
      baseOptions({ marginTop: 200, marginBottom: 200 }),
      false,
    );
    expect(maxHeightMm(html)).toBeGreaterThanOrEqual(20);
  });

  it("wraps long code lines — paper cannot scroll", () => {
    const html = buildPdfExportHtml("<p>x</p>", "", "", baseOptions(), false);
    expect(html).toMatch(/pre[^{]*\{[^}]*white-space:\s*pre-wrap/);
    expect(html).toContain("overflow-wrap: anywhere");
  });

  it("forces a collapsed details block open, so its body is not lost", () => {
    // Asserted on the MARKUP, because that is where the fix lives: CSS alone
    // cannot do it (Chromium hides the body with content-visibility).
    const html = buildPdfExportHtml(
      "<details><summary>s</summary><p>body</p></details>", "", "", baseOptions(), false,
    );
    expect(html).toContain("<details open>");
  });

  it("keeps alert and details blocks off page boundaries", () => {
    const html = buildPdfExportHtml("<p>x</p>", "", "", baseOptions(), false);
    const rule = html.match(/[^}]*\.alert-block[^{]*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("break-inside: avoid");
  });
});

describe("pdfHtmlTemplate expandDetails", () => {
  it("opens a collapsed details element", () => {
    expect(expandDetails('<details class="x"><summary>s</summary><p>body</p></details>'))
      .toContain('<details open class="x">');
  });

  it("leaves an already-open one alone", () => {
    const html = '<details open class="x"><summary>s</summary></details>';
    expect(expandDetails(html)).toBe(html);
  });

  it("is not fooled by an attribute merely containing the letters 'open'", () => {
    const out = expandDetails('<details data-reopened="1"><summary>s</summary></details>');
    expect(out).toContain("<details open data-reopened");
  });

  /**
   * A naive /\bopen\b/ lookahead matches these and leaves the block closed, so
   * its body is absent from the PDF — the exact data loss expandDetails exists
   * to prevent.
   */
  it.each([
    ['<details data-open="false"><summary>s</summary></details>', "data-open"],
    ['<details title="open"><summary>s</summary></details>', "title"],
    ['<details data-state="reopened"><summary>s</summary></details>', "data-state"],
  ])("opens a tag whose ATTRIBUTE VALUE contains 'open' (%s)", (html) => {
    expect(expandDetails(html)).toContain("<details open ");
  });

  it("survives a quoted '>' inside an attribute value", () => {
    const out = expandDetails('<details title="a>b"><summary>s</summary><p>body</p></details>');
    expect(out).toContain("<details open ");
    expect(out).toContain("body");
  });

  it.each([
    '<details title = open><summary>s</summary></details>',
    '<details data-x= open><summary>s</summary></details>',
  ])("opens a tag whose UNQUOTED attribute value is the word open (%s)", (html) => {
    // Stripping only QUOTED values missed these, so the block stayed collapsed.
    expect(expandDetails(html)).toContain("<details open ");
  });

  it("treats a bare OPEN in any case as already open", () => {
    expect(expandDetails("<details OPEN><summary>s</summary></details>")).toBe(
      "<details OPEN><summary>s</summary></details>",
    );
  });

  it("opens every details element, not just the first", () => {
    const out = expandDetails("<details><summary>a</summary></details><details><summary>b</summary></details>");
    expect([...out.matchAll(/<details open/g)]).toHaveLength(2);
  });

  it("reaches the exported document", () => {
    const html = buildPdfExportHtml(
      "<details><summary>s</summary><p>hidden body</p></details>", "", "", baseOptions(), false,
    );
    expect(html).toContain("<details open>");
    expect(html).toContain("hidden body");
  });
});

/**
 * WebKit's print pipeline DROPS `max-height` and honours `max-block-size`.
 * Measured on a real export, every variant asking 150mm: max-height rendered
 * 258.1mm (i.e. unbounded), max-block-size and height both rendered 159.5mm.
 * Emitting only the physical property is why tall images straddled a page break
 * on macOS and Linux while Chromium kept them whole.
 */
describe("pdfHtmlTemplate — WebKit needs the logical sizing property", () => {
  it("emits max-block-size beside every max-height bound", () => {
    const html = buildPdfExportHtml("<p>x</p>", "", "", baseOptions(), false);
    const physical = [...html.matchAll(/max-height:\s*([\d.]+)mm/g)].map((m) => m[1]);
    const logical = [...html.matchAll(/max-block-size:\s*([\d.]+)mm/g)].map((m) => m[1]);
    expect(physical.length).toBeGreaterThan(0);
    expect(logical).toEqual(physical);
  });
});

/**
 * WebKit ignores break-inside in print, so a block that must stay whole has to
 * be made ATOMIC instead. A replaced element already is; an inline SVG inside a
 * div is not, which is why Mermaid diagrams fragmented on macOS and Linux while
 * Chromium relocated them.
 */
describe("pdfHtmlTemplate — diagram previews survive a page boundary", () => {
  it("makes the preview box atomic rather than relying on break-inside", () => {
    const css = getSharedContentCSS();
    const rule = css.slice(css.indexOf(".export-surface .code-block-preview"));
    const decls = rule.slice(0, rule.indexOf("}"));
    expect(decls).toContain("display: inline-block");
    expect(decls).toContain("width: 100%");
  });
});
