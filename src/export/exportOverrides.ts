/**
 * Export-Only CSS Overrides
 *
 * Slim set of CSS rules that apply ONLY in the export context.
 * These handle: container layout, page breaks, table overflow for print,
 * hiding interactive elements, and @media print fixes for CSS masks.
 *
 * This file does NOT duplicate editor styles — those come from
 * editorCSSBundle.ts which imports the actual CSS files.
 *
 * @module export/exportOverrides
 * @coordinates-with editorCSSBundle.ts — provides the base editor CSS
 * @coordinates-with pdfHtmlTemplate.ts — injects these overrides into export HTML
 */

/**
 * Get export-only CSS overrides.
 * These rules sit on top of the editor CSS bundle.
 */
export function getExportOverrides(): string {
  return `
/* === Export Container Layout === */

.export-surface {
  max-width: var(--editor-width, 50em);
  margin: 0 auto;
  padding: 2em;
}

.export-surface-editor.tiptap-editor {
  height: auto;
  min-height: auto;
}

.export-surface-editor.tiptap-editor .ProseMirror {
  padding: 0;
}

/* === Hide Interactive Elements === */

.export-surface .ProseMirror-gapcursor,
.export-surface .resize-handle,
.export-surface .table-ui-wrapper,
.export-surface .code-block-edit-header,
.export-surface .code-block-edit-actions,
.export-surface .code-block-live-preview,
.export-surface .code-lang-dropdown {
  display: none !important;
}

.export-surface ::selection {
  background: transparent;
}

/* Remove cursor: pointer in export (non-interactive) */
.export-surface .code-block-preview,
.export-surface .math-block,
.export-surface .math-inline,
.export-surface sup[data-type="footnote_reference"],
.export-surface dl[data-type="footnote_definition"] dt {
  cursor: default;
}

/* Remove hover effects */
.export-surface .code-block-preview:hover,
.export-surface .math-block:hover,
.export-surface .math-inline:hover {
  background-color: inherit;
}

/* Line numbers: controlled by .show-line-numbers class on the wrapper,
   which is propagated from the editor setting. No forced override here. */

/* === Page Break Rules === */

pre, .code-block-wrapper {
  break-inside: avoid;
}
img {
  break-inside: avoid;
}
h1, h2, h3, h4, h5, h6 {
  break-after: avoid;
}

/* === Table Overflow for Print === */

.export-surface .table-scroll-wrapper {
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
.export-surface table {
  width: 100% !important;
  max-width: 100% !important;
  table-layout: auto !important;
}
.export-surface colgroup,
.export-surface col {
  width: auto !important;
}
.export-surface td,
.export-surface th {
  width: auto !important;
  min-width: 0 !important;
  max-width: none !important;
  overflow-wrap: break-word;
  word-break: break-word;
}
.export-surface td img {
  max-width: 100%;
  height: auto;
}

/* === Print Color Adjust === */

@media print {
  .export-surface-editor {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* Alert icon print fallbacks intentionally NOT defined here — alert-block.css
     ships identical @media print rules and flows into the export via
     editorCSSBundle (single source of truth). */

  /* Details chevron: CSS mask doesn't print — use pre-colored SVG.
     details-block.css has no print section, so this lives ONLY here. */
  details > summary::before,
  .details-summary::before {
    background-color: transparent !important;
    -webkit-mask-image: none !important;
    mask-image: none !important;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%23666666'%3E%3Cpath d='M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
  }
}`;
}
