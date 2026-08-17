/**
 * PDF HTML Template Builder
 *
 * Builds self-contained HTML for the WKWebView PDF renderer. Inlines KaTeX CSS
 * (with base64-embedded woff2 math fonts), captured theme tokens, typography,
 * and @page rules so the off-screen WKWebView renders identically offline.
 * Light theme is forced by default but can be skipped via `useEditorTheme` to
 * preserve the editor's current theme (including dark mode).
 *
 * WebKit's native print pipeline (printOperationWithPrintInfo) respects @page
 * size/margin rules but does NOT implement @page margin boxes (@top-center etc.),
 * so headers/footers/page-number settings are intentionally absent from PdfOptions.
 *
 * @module export/pdfHtmlTemplate
 * @coordinates-with pdf_export/renderer.rs — WKWebView loads this HTML and prints to PDF
 * @coordinates-with PdfExportDialog.tsx — passes options from the dialog UI
 * @coordinates-with katexFontEmbed.ts — rewrites KaTeX @font-face URLs to data URIs
 */

import _katexCSSRaw from "katex/dist/katex.min.css?raw";
import { embedKatexFonts } from "./katexFontEmbed";
import { getPrimitiveTokenCSS } from "./primitiveTokens";
import { PAGE_SIZE_PT } from "./pageSpec";

// Embed KaTeX woff2 fonts as data URIs so math renders offline, without CDN access.
const katexCSS = embedKatexFonts(_katexCSSRaw);

/** Get bundled KaTeX CSS with CDN font URLs (for use in print/export iframes). */
export function getKatexCSS(): string {
  return katexCSS;
}

/** Get light theme CSS overrides (for use in print — always light on paper). */
export function getForceLightThemeCSS(): string {
  return forceLightThemeCSS();
}

/** Get shared content CSS for table/page-break handling (for use in print iframes). */
export function getSharedContentCSS(): string {
  return sharedContentCSS();
}

/** Configuration for PDF page layout and typography. */
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

/** Resolve font name to a CSS font-family value. */
function resolveFontFamily(font: string, fallback: string): string {
  if (!font || font === "system" || font === "System Default") {
    return fallback;
  }
  return font.includes(" ") ? `"${font}"` : font;
}

/** Build @page CSS rules (size + margins only — WebKit print ignores margin boxes). */
function buildPageCSS(options: PdfOptions): string {
  const sizeKeyword = PAGE_SIZE_KEYWORDS[options.pageSize] ?? PAGE_SIZE_KEYWORDS.a4;
  const size = `${sizeKeyword} ${options.orientation}`;
  const margin = `${options.marginTop}mm ${options.marginRight}mm ${options.marginBottom}mm ${options.marginLeft}mm`;

  return `
@page {
  size: ${size};
  margin: ${margin};
}`;
}

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

/** Build typography CSS overrides from options. */
/**
 * Read the editor's block-size RATIO out of the captured theme snapshot.
 *
 * `--editor-font-size-block` is a user setting (`blockFontSize`) multiplied by
 * the editor's base size, stored as an absolute px value so that nesting a list
 * inside a blockquote does not compound. `PdfOptions` has no field for it, so
 * the ratio has to come from the snapshot or it would be silently flattened.
 *
 * Falls back to 1 — blocks the same size as body, which is the app's default —
 * whenever either value is missing or unparseable.
 */
function blockSizeRatio(themeCSS: string): number {
  const px = (name: string): number | null => {
    const m = themeCSS.match(new RegExp(`${name}:\\s*([\\d.]+)px`));
    const n = m ? Number.parseFloat(m[1]!) : Number.NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const base = px("--editor-font-size");
  const block = px("--editor-font-size-block");
  return base && block ? block / base : 1;
}

/**
 * Typography overrides for the exported document.
 *
 * **Every px value in the snapshot that `useTheme.computeTypographyVars`
 * derives from the editor font size must be overridden here.** The snapshot
 * carries ON-SCREEN pixels; body text switches to the chosen pt size, so any
 * variable left behind keeps its screen value and the element renders larger in
 * the PDF than it does in the editor.
 *
 * That is not hypothetical: `--editor-font-size-block` was missing, and since
 * it drives lists, blockquotes and tables (`editor.css`) plus alert and details
 * blocks (their plugin CSS), all five rendered at the editor's 20px against
 * 11pt body text — about 36% oversized — in every PDF VMark has ever exported.
 */
function buildTypographyCSS(options: PdfOptions, themeCSS: string): string {
  const latin = resolveFontFamily(options.latinFont, "system-ui");
  const cjk = resolveFontFamily(options.cjkFont, "system-ui");
  const fontStack = `${latin}, ${cjk}, system-ui, -apple-system, sans-serif`;
  const fs = options.fontSize;
  const lh = options.lineHeight;
  const blockRatio = blockSizeRatio(themeCSS);

  return `
:root {
  --editor-font-size: ${fs}pt;
  --editor-font-size-sm: ${fs * 0.9}pt;
  --editor-font-size-mono: ${fs * 0.85}pt;
  --editor-font-size-block: ${fs * blockRatio}pt;
  --editor-line-height: ${lh};
  --editor-line-height-px: ${fs * lh}pt;
  --code-padding: ${fs}pt;
  --cjk-letter-spacing: ${options.cjkLetterSpacing};
  --font-sans: ${fontStack};
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

/**
 * Build HTML for the Rust WKWebView PDF renderer.
 *
 * All CSS (including KaTeX) is inlined so the off-screen WKWebView needs no
 * network access. WebKit's native print pipeline respects @page size/margin
 * rules for pagination.
 *
 * @coordinates-with renderer.rs — loads HTML via WKWebView, uses printOperationWithPrintInfo
 */
/**
 * Force every details element open for print.
 *
 * A collapsed one exports with its body ABSENT, and a reader cannot click paper
 * open. Already-open elements are left untouched.
 */
export function expandDetails(html: string): string {
  return html.replace(/<details(?![^>]*\bopen\b)([^>]*)>/gi, "<details open$1>");
}

export function buildPdfExportHtml(
  content: string,
  themeCSS: string,
  contentCSS: string,
  options: PdfOptions,
  isDark?: boolean,
): string {
  const pageCSS = buildPageCSS(options);
  const typographyCSS = buildTypographyCSS(options, themeCSS);
  const fitCSS = buildFitCSS(options);
  const lightOverrides = options.useEditorTheme ? "" : forceLightThemeCSS();
  const htmlClass = options.useEditorTheme && isDark ? "dark-theme" : "";

  const printableContent = expandDetails(content);

  return `<!DOCTYPE html>
<html lang="en" class="${htmlClass}">
<head>
  <meta charset="UTF-8">
  <title>PDF Export</title>
  <style>
/* KaTeX (bundled) */
${katexCSS}
  </style>
  <style>
/* Primitive tokens first — the snapshot below overrides what it defines,
   exactly as useTheme's inline styles override index.css in the app. */
${getPrimitiveTokenCSS()}
${themeCSS}
${lightOverrides}
${typographyCSS}
${pageCSS}
${contentCSS}
${fitCSS}

body {
  background: var(--bg-color);
  color: var(--text-color);
  margin: 0;
  padding: 0;
}
${sharedContentCSS()}
  </style>
</head>
<body>
  <div class="export-surface">
    <div class="export-surface-editor tiptap-editor">
${printableContent}
    </div>
  </div>
</body>
</html>`;
}
