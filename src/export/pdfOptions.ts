/**
 * The options the PDF export dialog produces, and the tables keyed on them.
 *
 * Split from `pdfHtmlTemplate.ts` so the CSS builders can take the type without
 * importing the document composer, which would be circular.
 *
 * @module export/pdfOptions
 */

export interface PdfOptions {
  pageSize: "a4" | "letter" | "a3" | "legal";
  orientation: "portrait" | "landscape";
  marginTop: number;    // mm
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  fontSize: number;
  lineHeight: number;
  cjkLetterSpacing: string;
  latinFont: string;
  cjkFont: string;
  /** When true, use the editor's current theme instead of forcing light. */
  useEditorTheme: boolean;
  /** Where the page number sits, or "none" to omit it. */
  pageNumberPosition: PageNumberPosition;
  /** How the page number reads. */
  pageNumberFormat: PageNumberFormat;
  /** Leave page 1 unnumbered — title pages conventionally are. */
  pageNumberSkipFirst: boolean;
}

/**
 * Page numbers are stamped onto the finished PDF by the Rust side, not laid out
 * in CSS: they belong in `@page` margin boxes, which WebKit does not implement,
 * so a CSS approach would have worked on Chromium alone.
 */
export type PageNumberPosition = "none" | "bottom-center" | "bottom-right";

/** `7`, `7 / 12`, or the localized `Page 7 of 12`. */
export type PageNumberFormat = "plain" | "with-total" | "verbose";

/** The wire shape the `export_pdf` command takes. Field names are the contract. */
export interface PageNumberSpec {
  position: PageNumberPosition;
  format: PageNumberFormat;
  skipFirst: boolean;
  fontSizePt: number;
  bottomMarginPt: number;
  sideMarginPt: number;
  /**
   * Localized template for the verbose format. Substituted backend-side because
   * the page COUNT is not known until the render is done.
   *
   * A template the base-14 font cannot draw — any CJK — is refused there and
   * falls back to the numeric form rather than being stamped as blanks.
   */
  verboseTemplate: string;
}

/** Millimetres to PostScript points. */
function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

/**
 * Build the page-number spec, or `null` when the user turned it off.
 *
 * The number is sized relative to body text rather than fixed, so a 9pt export
 * does not get a footer nearly as large as its prose, and floored so it stays
 * legible at small body sizes.
 */
export function buildPageNumberSpec(
  options: PdfOptions,
  verboseTemplate: string,
): PageNumberSpec | null {
  if (options.pageNumberPosition === "none") return null;
  return {
    position: options.pageNumberPosition,
    format: options.pageNumberFormat,
    skipFirst: options.pageNumberSkipFirst,
    fontSizePt: Math.max(7, options.fontSize * 0.85),
    bottomMarginPt: mmToPt(options.marginBottom),
    sideMarginPt: mmToPt(options.marginRight),
    verboseTemplate,
  };
}

/** Named margin presets (values in mm). */
export const MARGIN_PRESETS: Record<string, { top: number; right: number; bottom: number; left: number }> = {
  normal: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
  narrow: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
  wide:   { top: 25.4, right: 38.1, bottom: 25.4, left: 38.1 },
};

// CSS Paged Media `@page size` accepts a named page-size keyword followed by an
// orientation keyword (e.g. `A4 landscape`). Mixing explicit <length> pairs with
// an orientation keyword (`210mm 297mm landscape`) is invalid and silently
// ignored by WebKit, which is why the previous landscape mode produced portrait PDFs.
export const PAGE_SIZE_KEYWORDS: Record<string, string> = {
  a4: "A4",
  letter: "letter",
  a3: "A3",
  legal: "legal",
};

