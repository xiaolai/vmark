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
 * so nothing in this file can draw a running header or footer. Page numbers are
 * therefore not CSS at all: `PdfOptions` carries the request, and Rust STAMPS
 * the finished PDF (`pdf_export/page_numbers.rs`) so all three engines agree.
 *
 * @module export/pdfHtmlTemplate
 * @coordinates-with pdf_export/renderer.rs — WKWebView loads this HTML and prints to PDF
 * @coordinates-with PdfExportDialog.tsx — passes options from the dialog UI
 * @coordinates-with katexFontEmbed.ts — rewrites KaTeX @font-face URLs to data URIs
 */

import _katexCSSRaw from "katex/dist/katex.min.css?raw";
import { embedKatexFonts } from "./katexFontEmbed";
import { getPrimitiveTokenCSS } from "./primitiveTokens";
import { buildFontStack } from "@/utils/fontStacks";
import { sharedContentCSS, forceLightThemeCSS } from "./pdfPrintCss";
import { buildFitCSS } from "./pdfFitToPage";
import { type PdfOptions, PAGE_SIZE_KEYWORDS } from "./pdfOptions";

// Re-exported so existing importers keep one entry point for the export API.
export { MARGIN_PRESETS, PAGE_SIZE_KEYWORDS } from "./pdfOptions";
export type { PdfOptions } from "./pdfOptions";

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
  // The dialog stores font KEYS ("pingfang", "songti"), not CSS family names.
  // Emitting the key verbatim produced `font-family: pingfang, ...`, which
  // matches no installed family, so every non-system choice silently fell back
  // — and the leading `system-ui` meant the CJK stack was never reached either.
  // buildFontStack is the app's own resolver and already handles both.
  const { sans: fontStack } = buildFontStack(
    options.latinFont,
    options.cjkFont,
    "system",
  );
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
  // Attribute-aware, because a naive /\bopen\b/ lookahead matches the wrong
  // things: `data-open="false"` and `title="open"` both contain the token, so a
  // collapsed block stayed collapsed and its body was absent from the PDF —
  // the same data loss this function exists to prevent. A quoted `>` inside an
  // attribute value also truncated the tag.
  return html.replace(/<details\b([^>]*(?:"[^"]*"[^>]*|'[^']*'[^>]*)*)>/gi, (tag, attrs: string) => {
    // Strip every attribute VALUE — quoted or bare — before looking for a
    // standalone `open`. Quoted alone was not enough: `title = open` has an
    // unquoted value, and treating that as the boolean attribute left the block
    // collapsed and its body out of the PDF.
    const bare = attrs
      .replace(/=\s*"[^"]*"/g, "")
      .replace(/=\s*'[^']*'/g, "")
      .replace(/=\s*[^\s>]+/g, "");
    return /(^|\s)open(\s|$)/i.test(bare) ? tag : `<details open${attrs}>`;
  });
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
