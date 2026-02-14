/**
 * HTML Export Styles — Content Elements
 *
 * Purpose: CSS for blockquotes, tables, images, horizontal rules,
 * inline marks (bold, italic, highlight, etc.), and alert blocks
 * used in exported HTML documents.
 *
 * @module export/htmlExportStylesContent
 * @coordinates-with htmlExportStyles.ts — composed into getEditorContentCSS()
 */

/** Blockquotes + tables + images + horizontal rules + marks + alerts. */
export function getContentStyles(): string {
  return `
/* Blockquotes */
.export-surface-editor blockquote {
  border-left: 4px solid var(--border-color);
  border-radius: var(--radius-md, 6px);
  margin: 0 0 var(--editor-block-spacing, 1em) 0;
  padding: 0 1em;
  color: var(--meta-content-color, var(--text-secondary));
  line-height: var(--editor-line-height-px);
}

.export-surface-editor blockquote blockquote {
  padding-right: 0;
}

.export-surface-editor blockquote > p {
  margin-bottom: 0.5em;
}

.export-surface-editor blockquote > p:last-child {
  margin-bottom: 0;
}

/* Tables */
.export-surface-editor table {
  padding: 0;
  word-break: initial;
  border-collapse: collapse;
  width: 100%;
  margin: 0 0 var(--editor-block-spacing, 1em) 0;
  table-layout: auto;
  line-height: var(--editor-line-height-px);
}

.export-surface-editor table tr {
  border: 1px solid var(--table-border-color, var(--border-color));
  margin: 0;
  padding: 0;
}

.export-surface-editor th {
  font-weight: bold;
  border: 1px solid var(--table-border-color, var(--border-color));
  border-bottom: 0;
  margin: 0;
  padding: 4px 10px;
  line-height: var(--editor-line-height-px);
  background-color: var(--bg-secondary);
}

.export-surface-editor td {
  border: 1px solid var(--table-border-color, var(--border-color));
  margin: 0;
  padding: 4px 10px;
  line-height: var(--editor-line-height-px);
}

.export-surface-editor th:first-child,
.export-surface-editor td:first-child {
  margin-top: 0;
}

.export-surface-editor th:last-child,
.export-surface-editor td:last-child {
  margin-bottom: 0;
}

/* Table scroll container */
.export-surface-editor .table-scroll-wrapper {
  overflow-x: auto;
  margin: 0 0 var(--editor-block-spacing, 1em) 0;
  position: relative;
}

.export-surface-editor .table-scroll-wrapper table {
  width: max-content;
  min-width: 100%;
  margin: 0;
}

/* Table alignment */
.export-surface-editor td[style*="text-align: center"],
.export-surface-editor th[style*="text-align: center"] {
  text-align: center;
}

.export-surface-editor td[style*="text-align: right"],
.export-surface-editor th[style*="text-align: right"] {
  text-align: right;
}

/* Images */
.export-surface-editor img {
  max-width: 100%;
  height: auto;
}

.export-surface-editor .block-image {
  margin: 1em 0;
  text-align: center;
}

.export-surface-editor .block-image img {
  display: block;
  margin: 0 auto;
}

.export-surface-editor .inline-image {
  display: inline;
  vertical-align: middle;
}

.export-surface-editor .broken-image {
  display: inline-block;
  padding: 1em 2em;
  background: var(--bg-secondary);
  border: 1px dashed var(--border-color);
  border-radius: 4px;
  color: var(--text-tertiary);
  font-style: italic;
}

.export-surface-editor .image-error {
  opacity: 0.5;
  filter: grayscale(100%);
}

/* Horizontal rule */
.export-surface-editor hr {
  border: none;
  height: 2px;
  background-color: var(--border-color);
  margin: var(--editor-block-spacing, 1em) 0;
}

/* Marks */
.export-surface-editor strong {
  font-weight: 600;
  color: var(--strong-color);
}

.export-surface-editor em {
  font-style: italic;
  color: var(--emphasis-color);
}

.export-surface-editor mark,
.export-surface-editor .md-highlight {
  background: var(--highlight-bg);
  color: var(--highlight-text, inherit);
  padding: 0.1em 0.2em;
  border-radius: 2px;
}

.export-surface-editor s,
.export-surface-editor del,
.export-surface-editor .md-strikethrough {
  text-decoration: line-through;
  color: var(--meta-content-color, var(--text-secondary));
}

.export-surface-editor sub,
.export-surface-editor .md-subscript {
  font-size: 0.75em;
  vertical-align: sub;
}

.export-surface-editor sup,
.export-surface-editor .md-superscript {
  font-size: 0.75em;
  vertical-align: super;
}

.export-surface-editor u,
.export-surface-editor .md-underline {
  text-decoration: underline;
}

/* Alert blocks */
.export-surface-editor .alert-block {
  border-left: 4px solid var(--alert-border);
  background-color: var(--alert-bg);
  padding: 0.75em 1em;
  margin: 0 0 var(--editor-block-spacing, 1em) 0;
  border-radius: var(--radius-md, 6px);
}

.export-surface-editor .alert-block .alert-title {
  font-weight: 600;
  line-height: var(--editor-line-height-px);
  color: var(--alert-title);
  margin-bottom: 0.5em;
  display: flex;
  align-items: center;
  gap: 0.5em;
}

.export-surface-editor .alert-block .alert-title::before {
  content: "";
  width: 16px;
  height: 16px;
  background-color: var(--alert-title);
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

.export-surface-editor .alert-block .alert-content > *:first-child {
  margin-top: 0;
}

.export-surface-editor .alert-block .alert-content > *:last-child {
  margin-bottom: 0;
}

.export-surface-editor .alert-block .alert-content > p {
  margin-bottom: 0.5em;
}

/* Alert types with colors and icons */
.export-surface-editor .alert-note {
  --alert-border: var(--alert-note);
  --alert-bg: color-mix(in srgb, var(--alert-note) 10%, transparent);
  --alert-title: var(--alert-note);
}

.export-surface-editor .alert-note .alert-title::before {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z'/%3E%3C/svg%3E");
}

.export-surface-editor .alert-tip {
  --alert-border: var(--alert-tip);
  --alert-bg: color-mix(in srgb, var(--alert-tip) 10%, transparent);
  --alert-title: var(--alert-tip);
}

.export-surface-editor .alert-tip .alert-title::before {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z'/%3E%3C/svg%3E");
}

.export-surface-editor .alert-important {
  --alert-border: var(--alert-important);
  --alert-bg: color-mix(in srgb, var(--alert-important) 10%, transparent);
  --alert-title: var(--alert-important);
}

.export-surface-editor .alert-important .alert-title::before {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z'/%3E%3C/svg%3E");
}

.export-surface-editor .alert-warning {
  --alert-border: var(--alert-warning);
  --alert-bg: color-mix(in srgb, var(--alert-warning) 10%, transparent);
  --alert-title: var(--alert-warning);
}

.export-surface-editor .alert-warning .alert-title::before {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z'/%3E%3C/svg%3E");
}

.export-surface-editor .alert-caution {
  --alert-border: var(--alert-caution);
  --alert-bg: color-mix(in srgb, var(--alert-caution) 10%, transparent);
  --alert-title: var(--alert-caution);
}

.export-surface-editor .alert-caution .alert-title::before {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z'/%3E%3C/svg%3E");
}`;
}
