/**
 * Print-only CSS for the PDF export.
 *
 * Purpose: the rules that exist ONLY because the medium is paper — page-break
 * behaviour, fitting oversized figures to the sheet, table layout under a fixed
 * width, and the forced light palette. They are split out of
 * `pdfHtmlTemplate.ts` because that file crossed the 300-line limit; the
 * document composer stays there, the paper-specific stylesheets live here.
 *
 * Every builder returns a template literal, so a BACKTICK anywhere inside one —
 * including inside a CSS comment — terminates the literal and breaks the build.
 * `exportCssVarCoverage.test.ts` asserts against that and against unbalanced
 * braces.
 *
 * @module export/pdfPrintCss
 * @coordinates-with pdfHtmlTemplate.ts — composes these into the document
 */

import type { PdfOptions } from "./pdfOptions";
import { PAGE_SIZE_PT } from "./pageSpec";

/** Shared CSS for table layout, page breaks, and content surface. */
function sharedContentCSS(): string {
  return `
.export-surface {
  max-width: none;
  padding: 0;
}

.export-surface-editor .table-scroll-wrapper {
  overflow-x: visible;
}
/*
 * Fit every table to the fixed printable page width (issue #1087). Editor
 * "fit to width" is ephemeral DOM state with no markdown representation, so it
 * never survives the fresh re-render into export HTML; and stored ProseMirror
 * colwidth (<col style="width:Npx">) plus resized-cell inline widths would
 * otherwise force the table past the @page box, where WebKit's print pipeline
 * clips the overflow. Neutralize all fixed pixel sizing so columns reflow.
 */
.export-surface-editor table {
  width: 100% !important;
  max-width: 100% !important;
  table-layout: auto !important;
}
.export-surface-editor colgroup,
.export-surface-editor col {
  width: auto !important;
}
.export-surface-editor td,
.export-surface-editor th {
  width: auto !important;
  min-width: 0 !important;
  max-width: none !important;
  /*
   * overflow-wrap: break-word breaks a word ONLY when it cannot fit a line by
   * itself, and leaves min-content width alone. word-break: break-word, which
   * used to sit here, behaves like overflow-wrap: anywhere and collapses
   * min-content to a SINGLE CHARACTER — so table-layout: auto was free to
   * squeeze any column arbitrarily narrow, and a six-column table rendered its
   * headers as "Prop erty" and "brea k-insid e". Dropping it restores
   * longest-word column sizing while still preventing one long token from
   * overflowing the page box (issue #1087).
   *
   * hyphens: auto is deliberately NOT set: it re-opens the same hole from the
   * other side, since a hyphenation opportunity inside a word also lowers
   * min-content. It turned the headers into Au-thori-ty and Ori-enta-tion.
   */
  overflow-wrap: break-word;
}

/*
 * When a table's min-content width genuinely exceeds the printable width, the
 * browser must shrink columns below their longest word and starts breaking
 * ordinary prose — the six-column table rendered its headers as Prop erty and
 * Autho rity. The excess is almost always long unbreakable CODE tokens
 * (ShouldPrintBackgrounds, print-color-adjust) monopolising width, so the break
 * is aimed at THEM: anywhere lowers min-content for code spans only, freeing
 * the layout to give prose columns their whole words.
 */
.export-surface-editor td code,
.export-surface-editor th code,
.export-surface-editor td kbd,
.export-surface-editor th kbd {
  overflow-wrap: anywhere;
  word-break: break-all;
}
.export-surface-editor td img {
  max-width: 100%;
  height: auto;
}

pre, .code-block-wrapper {
  break-inside: avoid;
}
/* An <img> is atomic, but the things that actually straddled a page boundary
   are not images: a Mermaid diagram is an inline <svg> inside
   .code-block-preview, display math is .katex-display, and a block image is
   wrapped in .block-image. A rule naming only the img element covered none of them. */
img,
svg,
figure,
.block-image,
.code-block-preview,
.katex-display,
.alert-block,
.details-block,
blockquote {
  /* Both spellings for coverage across engine versions. Note what this does
     NOT buy: WebKit ignores break-inside in its print pipeline under EITHER
     name — measured, a near-full-page image straddled two pages on macOS and
     Linux while Chromium moved it to a fresh page. Do not read these two lines
     as a guarantee; on WebKit they are inert. */
  page-break-inside: avoid;
  break-inside: avoid;
}
h1, h2, h3, h4, h5, h6 {
  page-break-after: avoid;
  break-after: avoid;
}

/*
 * The code-block chrome OVERLAYS the block on screen: .code-block-actions is
 * absolutely positioned at top 4px, which is right for a hover affordance and
 * wrong for paper, where it printed the language chip on top of the block's
 * first line and border. On paper there is no hover, so it goes back in flow —
 * it precedes the <pre> in the DOM, so it lands above the code where a listing
 * label belongs. The copy and run buttons are dropped outright: they are
 * actions, and paper has none.
 */
.export-surface .code-copy-btn {
  display: none !important;
}
.export-surface .code-block-wrapper {
  flex-wrap: wrap;
}
.export-surface .code-block-actions {
  position: static;
  order: -1;
  flex: 0 0 100%;
  justify-content: flex-end;
  padding-bottom: 2px;
}

/*
 * Paper does not scroll. In the editor a long code line sits in a
 * horizontally scrollable box; printed, the overflow is simply CLIPPED and the
 * text is GONE — measured on the showcase, where uuid::Uuid::n and
 * errors.pdf.tempWriteFa ended at the page edge mid-identifier. Wrapping is
 * the only lossless option in a fixed-width medium.
 */
pre, pre code, .code-block-wrapper pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow-x: visible;
}

/*
 * A details element exports COLLAPSED, so its body is missing from the PDF entirely.
 * A reader cannot click paper open, which makes the closed state pure data
 * loss. Done in the MARKUP by expandDetails(), not here: Chromium hides the
 * contents with content-visibility rather than display, so a display override
 * alone changed nothing — measured, the body was still absent from the Windows
 * PDF. The open attribute is the one mechanism both engines agree on.
 */
details[open] > *:not(summary),
.details-block > *:not(summary) {
  display: block !important;
}`;
}
/**
 * Constrain oversized blocks to the printable area.
 *
 * `break-inside: avoid` moves a block to the next page only if it FITS there.
 * An image taller than the content area fits nowhere, so the engine must split
 * it — the top half on one page, the rest on the next, with no way to read it
 * whole. Scaling it down is the only thing that keeps it intact.
 *
 * The bound is computed, not guessed: the same page size and margins that
 * generate the `@page` rule give the exact content height.
 */
function buildFitCSS(options: PdfOptions): string {
  const paper = PAGE_SIZE_PT[options.pageSize] ?? PAGE_SIZE_PT.a4!;
  const landscape = options.orientation === "landscape";
  const heightPt = landscape ? paper.width : paper.height;
  const heightMm = (heightPt * 25.4) / 72;
  // The bound applies to the IMAGE, but what has to fit on the page is the
  // image PLUS its wrapper's margin. Editor blocks carry a bottom margin of
  // `--editor-block-spacing`, an em value the export cannot convert to
  // millimetres — so the wrapper is given an explicit margin here and exactly
  // that much is subtracted. Measured before this: the figure rendered 249.9mm
  // against a 246.2mm content area, over by precisely the margin it added, so
  // it could never fit on any page however tight the image bound was.
  const WRAPPER_MM = 3;
  // What decides whether a figure survives is that a replaced element is
  // ATOMIC: if it FITS it relocates to the next page whole, with or without a
  // break-inside rule (measured — an isolated probe had no such rule and still
  // moved it). If it fits nowhere, it must be split.
  //
  // **WebKit's print pipeline DROPS `max-height` and honours `max-block-size`.**
  // The two are the same property in horizontal writing mode, but they take
  // different code paths there. Measured on the real export, all asking 150mm:
  //
  //     max-height: 150mm       -> 258.1mm   ignored
  //     max-block-size: 150mm   -> 159.5mm   honoured
  //     height: 150mm           -> 159.5mm   honoured
  //
  // 258.1mm is what an unbounded figure happens to render at, so `max-height`
  // alone did nothing at all — which is why a tall image straddled a page break
  // on macOS and Linux while Chromium, which honours both, kept it whole. Emit
  // BOTH: neither engine minds the other's spelling.
  //
  // WebKit then renders ~6% ABOVE whatever bound it is given — measured twice
  // on the real export: ask 100mm, get 105.7mm; ask 239.2mm, get 255.0mm. That
  // is enough to push a near-full-page figure past the content area, and it
  // straddles even when a forced `break-before: page` starts it at the very top
  // of a fresh page (tested). So the bound is set below the content area by
  // more than the overshoot.
  //
  // An earlier version of this multiplier was added, seen to change nothing,
  // and reverted — correctly at the time, because `max-height` alone was inert
  // so NO bound had any effect. It only becomes meaningful once the logical
  // property above actually binds. Chromium honours the bound exactly and pays
  // 8% of image height for this; that is the price of one rule that works on
  // all three engines.
  const WEBKIT_OVERSHOOT = 0.92;
  const usableMm = Math.max(
    20,
    (heightMm - options.marginTop - options.marginBottom - WRAPPER_MM - 4) *
      WEBKIT_OVERSHOOT,
  );

  return `
figure,
.block-image,
.code-block-preview {
  margin-top: 0;
  margin-bottom: ${WRAPPER_MM}mm;
  max-height: ${(usableMm + WRAPPER_MM).toFixed(2)}mm;
  max-block-size: ${(usableMm + WRAPPER_MM).toFixed(2)}mm;
}

img,
svg,
.block-image img,
.code-block-preview svg,
.code-block-preview img {
  max-height: ${usableMm.toFixed(2)}mm;
  max-block-size: ${usableMm.toFixed(2)}mm;
  max-width: 100%;
  height: auto;
  object-fit: contain;
}`;
}
/**
 * Force light theme CSS variables for PDF output.
 * Ensures readable output even when the app is in dark theme,
 * because captureThemeCSS() captures the current (possibly dark) computed values.
 */
function forceLightThemeCSS(): string {
  return `
:root {
  --bg-color: #ffffff;
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --bg-tertiary: #f0f0f0;
  --text-color: #1a1a1a;
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --text-tertiary: #999999;
  --primary-color: #0066cc;
  --border-color: #d5d4d4;
  --code-bg-color: #f5f5f5;
  --code-text-color: #1a1a1a;
  --code-border-color: #d5d4d4;
  --strong-color: rgb(63,86,99);
  --emphasis-color: rgb(91,4,17);
  --md-char-color: #777777;
  --table-border-color: #d5d4d4;
  --highlight-bg: #fff3a3;
  --highlight-text: inherit;
  --accent-primary: #0066cc;
  --accent-bg: rgba(0,102,204,0.1);
  --error-color: #cf222e;
  --warning-color: #9a6700;
  --success-color: #16a34a;
  --alert-note: #0969da;
  --alert-tip: #1a7f37;
  --alert-important: #8250df;
  --alert-warning: #9a6700;
  --alert-caution: #cf222e;
}`;
}
export { sharedContentCSS, buildFitCSS, forceLightThemeCSS };
