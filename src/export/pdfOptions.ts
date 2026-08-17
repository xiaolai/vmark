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

