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
const PAGE_SIZE_KEYWORDS: Record<string, string> = {
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
.export-surface-editor .table-scroll-wrapper table {
  width: 100% !important;
  table-layout: fixed;
}
.export-surface-editor td,
.export-surface-editor th {
  overflow-wrap: break-word;
  word-break: break-word;
}
.export-surface-editor td img {
  max-width: 100%;
  height: auto;
}

pre, .code-block-wrapper {
  break-inside: avoid;
}
img {
  break-inside: avoid;
}
h1, h2, h3, h4, h5, h6 {
  break-after: avoid;
}`;
}

/** Build typography CSS overrides from options. */
function buildTypographyCSS(options: PdfOptions): string {
  const latin = resolveFontFamily(options.latinFont, "system-ui");
  const cjk = resolveFontFamily(options.cjkFont, "system-ui");
  const fontStack = `${latin}, ${cjk}, system-ui, -apple-system, sans-serif`;
  const fs = options.fontSize;
  const lh = options.lineHeight;

  return `
:root {
  --editor-font-size: ${fs}pt;
  --editor-font-size-sm: ${fs * 0.9}pt;
  --editor-font-size-mono: ${fs * 0.85}pt;
  --editor-line-height: ${lh};
  --editor-line-height-px: ${fs * lh}pt;
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
export function buildPdfExportHtml(
  content: string,
  themeCSS: string,
  contentCSS: string,
  options: PdfOptions,
  isDark?: boolean,
): string {
  const pageCSS = buildPageCSS(options);
  const typographyCSS = buildTypographyCSS(options);
  const lightOverrides = options.useEditorTheme ? "" : forceLightThemeCSS();
  const htmlClass = options.useEditorTheme && isDark ? "dark-theme" : "";

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
${themeCSS}
${lightOverrides}
${typographyCSS}
${pageCSS}
${contentCSS}

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
${content}
    </div>
  </div>
</body>
</html>`;
}
