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

  /* Alert icons: CSS masks don't print — use pre-colored SVG background-image */
  .alert-block .alert-title::before {
    background-color: transparent !important;
    -webkit-mask-image: none !important;
    mask-image: none !important;
    background-size: contain;
    background-repeat: no-repeat;
  }

  .alert-note .alert-title::before {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%230969da'%3E%3Cpath d='M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z'/%3E%3C/svg%3E");
  }
  .alert-tip .alert-title::before {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%231a7f37'%3E%3Cpath d='M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z'/%3E%3C/svg%3E");
  }
  .alert-important .alert-title::before {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%238250df'%3E%3Cpath d='M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z'/%3E%3C/svg%3E");
  }
  .alert-warning .alert-title::before {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%239a6700'%3E%3Cpath d='M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z'/%3E%3C/svg%3E");
  }
  .alert-caution .alert-title::before {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%23cf222e'%3E%3Cpath d='M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z'/%3E%3C/svg%3E");
  }

  /* Details chevron: CSS mask doesn't print — use pre-colored SVG */
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
