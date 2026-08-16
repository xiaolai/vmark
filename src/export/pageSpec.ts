/**
 * PageSpec — the page geometry that must travel to Rust, in points.
 *
 * Purpose: Windows and Linux ignore `@page { size }` entirely. Measured
 * (WI-PDF0.1): with no API geometry supplied at all, Windows emits US Letter
 * and Linux emits A4 — neither reads the CSS. So the size the user picked has
 * to reach the backend as data, not only as a stylesheet.
 *
 * Key decisions:
 *   - **Points, with orientation already applied.** Landscape is a WIDTH/HEIGHT
 *     SWAP, not a flag: Windows ignored
 *     `COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE` while explicit width and
 *     height were set, and its MediaBox stayed portrait. Swapping is correct
 *     on both platforms.
 *   - **No margins.** Also measured: setting API margins changed the page
 *     count not at all on either platform, while CSS margins changed it on
 *     both. Margins are CSS-driven; putting them here would have dropped the
 *     user's choice silently, behind a valid PDF at the right paper size.
 *   - **One source, two derivations.** The CSS keeps using CSS keywords
 *     (`A4 landscape`) because `pdfHtmlTemplate.ts` records that an explicit
 *     length pair plus an orientation keyword is invalid and silently ignored
 *     by WebKit. Both this table and that one are keyed on the same
 *     `options.pageSize`, and `pageSpec.test.ts` fails if one gains an entry
 *     the other lacks.
 *
 * @coordinates-with pdfHtmlTemplate.ts — the CSS half of the same choice
 * @coordinates-with PdfExportDialog.tsx — builds this for the invoke payload
 * @module export/pageSpec
 */

/** Paper dimensions in PostScript points (1pt = 1/72in), portrait. */
export const PAGE_SIZE_PT: Record<string, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 }, // 210 × 297 mm
  letter: { width: 612, height: 792 }, // 8.5 × 11 in
  a3: { width: 841.89, height: 1190.55 }, // 297 × 420 mm
  legal: { width: 612, height: 1008 }, // 8.5 × 14 in
};

/** The geometry Rust receives. Field names are the wire contract. */
export interface PageSpec {
  widthPt: number;
  heightPt: number;
}

/**
 * Build the spec for a page size and orientation.
 *
 * Unknown sizes fall back to A4, matching `buildPageCSS`'s fallback — the two
 * must degrade the same way or a bad preset would produce a document whose CSS
 * and paper disagree.
 */
export function buildPageSpec(pageSize: string, orientation: string): PageSpec {
  const paper = PAGE_SIZE_PT[pageSize] ?? PAGE_SIZE_PT.a4;
  return orientation === "landscape"
    ? { widthPt: paper.height, heightPt: paper.width }
    : { widthPt: paper.width, heightPt: paper.height };
}
