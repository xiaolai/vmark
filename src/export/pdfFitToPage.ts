/**
 * Fitting oversized blocks to the sheet.
 *
 * Purpose: `break-inside: avoid` only relocates a block that fits SOMEWHERE. A
 * figure taller than the content area fits nowhere, so the engine cuts it in
 * half and the reader never sees it whole. This bounds images and diagram
 * previews to the printable height, computed from the same page size and
 * margins that generate the @page rule.
 *
 * Split from `pdfPrintCss.ts` at the 300-line limit; that module keeps the
 * page-break and layout rules, this one the sizing arithmetic.
 *
 * @module export/pdfFitToPage
 * @coordinates-with pdfPrintCss.ts — the other half of the print stylesheet
 * @coordinates-with pageSpec.ts — the page dimensions this is derived from
 */

import type { PdfOptions } from "./pdfOptions";
import { PAGE_SIZE_PT } from "./pageSpec";

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
export { buildFitCSS };
