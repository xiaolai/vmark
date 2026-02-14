/**
 * HTML Export Styles — Extra Elements
 *
 * Purpose: CSS for details/collapsible blocks, math rendering,
 * mermaid previews, footnotes, wiki links, CJK spacing,
 * syntax highlighting (light and dark), and dark theme alert overrides
 * used in exported HTML documents.
 *
 * @module export/htmlExportStylesExtra
 * @coordinates-with htmlExportStyles.ts — composed into getEditorContentCSS()
 */

/** Details + math + footnotes + wiki + CJK + syntax highlighting + dark overrides. */
export function getExtraStyles(): string {
  return `
/* Details blocks */
.export-surface-editor .details-block {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 6px);
  margin: 0 0 var(--editor-block-spacing, 1em) 0;
  overflow: hidden;
  line-height: var(--editor-line-height-px);
}

.export-surface-editor .details-block > summary,
.export-surface-editor .details-summary {
  padding: 0.625em 0.75em;
  cursor: pointer;
  font-weight: 600;
  background-color: var(--bg-secondary);
  border-bottom: 1px solid transparent;
  display: flex;
  align-items: center;
  gap: 0.5em;
  list-style: none;
}

.export-surface-editor .details-block > summary::-webkit-details-marker,
.export-surface-editor .details-summary::-webkit-details-marker {
  display: none;
}

.export-surface-editor .details-block > summary::before,
.export-surface-editor .details-summary::before {
  content: "";
  width: 16px;
  height: 16px;
  background-color: currentColor;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z'/%3E%3C/svg%3E");
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  flex-shrink: 0;
  transition: transform 0.15s ease-out;
}

.export-surface-editor .details-block > summary:hover,
.export-surface-editor .details-summary:hover {
  background-color: var(--bg-tertiary, var(--bg-secondary));
}

.export-surface-editor .details-block[open] > summary::before {
  transform: rotate(90deg);
}

.export-surface-editor .details-block[open] > summary {
  border-bottom-color: var(--border-color);
}

.export-surface-editor .details-block > *:not(summary):not(.details-summary):not(ul):not(ol):not(blockquote):not(pre) {
  padding: 0.75em 1em;
}

.export-surface-editor .details-block > *:not(summary):not(.details-summary):not(ul):not(ol):not(:last-child) {
  padding-bottom: 0;
}

.export-surface-editor .details-block > p:not(.details-summary) {
  margin-bottom: 0.5em;
}

.export-surface-editor .details-block > p:not(.details-summary):last-child {
  margin-bottom: 0;
}

/* Lists inside details - explicit padding for proper indentation */
.export-surface-editor .details-block > ul,
.export-surface-editor .details-block > ol {
  margin: 0.5em 0;
  padding-left: 2.5em;
  padding-right: 1em;
}

.export-surface-editor .details-block > ul:first-of-type,
.export-surface-editor .details-block > ol:first-of-type {
  margin-top: 0;
  padding-top: 0.75em;
}

.export-surface-editor .details-block > ul:last-child,
.export-surface-editor .details-block > ol:last-child {
  margin-bottom: 0;
  padding-bottom: 0.75em;
}

/* Blockquote inside details */
.export-surface-editor .details-block > blockquote {
  margin: 0.5em 1em;
  padding: 0 1em;
}

.export-surface-editor .details-block > blockquote:first-of-type {
  margin-top: 0.75em;
}

.export-surface-editor .details-block > blockquote:last-child {
  margin-bottom: 0.75em;
}

/* Code blocks inside details */
.export-surface-editor .details-block > pre {
  margin: 0.5em 1em;
}

.export-surface-editor .details-block > pre:first-of-type {
  margin-top: 0.75em;
}

.export-surface-editor .details-block > pre:last-child {
  margin-bottom: 0.75em;
}

/* Math - inline and block */
.export-surface-editor .math-inline {
  display: inline;
}

.export-surface-editor .math-inline-preview {
  display: inline;
}

.export-surface-editor .math-block {
  display: block;
  margin: 1em 0;
  text-align: center;
  overflow-x: auto;
}

/* Code preview (rendered math/mermaid) */
.export-surface-editor .code-block-preview {
  margin: 1em 0;
  text-align: center;
}

.export-surface-editor .mermaid-preview {
  margin: 1em 0;
}

.export-surface-editor .mermaid-preview svg {
  max-width: 100%;
  height: auto;
}

/* Footnotes - References */
.export-surface-editor [data-type="footnote_reference"],
.export-surface-editor .footnote-ref {
  font-size: 0.75em;
  vertical-align: super;
  color: var(--primary-color);
  cursor: default;
}

.export-surface-editor [data-type="footnote_reference"]::before,
.export-surface-editor .footnote-ref::before {
  content: "[";
}

.export-surface-editor [data-type="footnote_reference"]::after,
.export-surface-editor .footnote-ref::after {
  content: "]";
}

/* Hide the inner link text styling - brackets are added via ::before/::after */
.export-surface-editor [data-type="footnote_reference"] a {
  color: inherit;
  text-decoration: none;
}

/* Footnotes - Definitions */
.export-surface-editor [data-type="footnote_definition"],
.export-surface-editor .footnote-def {
  font-size: 0.9em;
  margin: 0.5em 0;
  padding: 0.5em 0;
  border-bottom: 1px solid var(--border-color);
}

.export-surface-editor [data-type="footnote_definition"] dt,
.export-surface-editor .footnote-def-label {
  display: inline;
  font-weight: 600;
  color: var(--primary-color);
  margin-right: 0.5em;
}

.export-surface-editor [data-type="footnote_definition"] dt::before,
.export-surface-editor .footnote-def-label::before {
  content: "[";
}

.export-surface-editor [data-type="footnote_definition"] dt::after,
.export-surface-editor .footnote-def-label::after {
  content: "]:";
}

.export-surface-editor [data-type="footnote_definition"] dd,
.export-surface-editor .footnote-def-content {
  display: inline;
  margin: 0;
}

/* Make paragraph inside dd inline to keep footnote on one line */
.export-surface-editor [data-type="footnote_definition"] dd p {
  display: inline;
  margin: 0;
}

.export-surface-editor .footnote-backref {
  color: var(--primary-color);
  text-decoration: none;
  margin-left: 0.25em;
  /* Arrow is already in innerHTML from vmark-reader.js, no ::after needed */
}

.export-surface-editor [data-type="footnote_definition"]:first-of-type,
.export-surface-editor .footnote-def:first-of-type {
  margin-top: 2em;
  padding-top: 1em;
  border-top: 1px solid var(--border-color);
}

/* Wiki links */
.export-surface-editor .wiki-link {
  color: var(--primary-color);
  background: var(--accent-bg);
  padding: 0.1em 0.3em;
  border-radius: 3px;
  text-decoration: none;
}

/* CJK letter spacing */
.export-surface-editor .cjk-spacing {
  letter-spacing: var(--cjk-letter-spacing, 0.05em);
}

.export-surface-editor pre .cjk-spacing,
.export-surface-editor code .cjk-spacing {
  letter-spacing: 0;
}

/* Syntax highlighting (Highlight.js) - Light theme */
.export-surface-editor .hljs-keyword { color: #d73a49; }
.export-surface-editor .hljs-string { color: #032f62; }
.export-surface-editor .hljs-number { color: #005cc5; }
.export-surface-editor .hljs-comment { color: #6a737d; font-style: italic; }
.export-surface-editor .hljs-function { color: #6f42c1; }
.export-surface-editor .hljs-title { color: #6f42c1; }
.export-surface-editor .hljs-params { color: #24292e; }
.export-surface-editor .hljs-built_in { color: #005cc5; }
.export-surface-editor .hljs-literal { color: #005cc5; }
.export-surface-editor .hljs-type { color: #d73a49; }
.export-surface-editor .hljs-meta { color: #6a737d; }
.export-surface-editor .hljs-attr { color: #005cc5; }
.export-surface-editor .hljs-attribute { color: #005cc5; }
.export-surface-editor .hljs-selector-tag { color: #22863a; }
.export-surface-editor .hljs-selector-class { color: #6f42c1; }
.export-surface-editor .hljs-selector-id { color: #005cc5; }
.export-surface-editor .hljs-variable { color: #e36209; }
.export-surface-editor .hljs-template-variable { color: #e36209; }
.export-surface-editor .hljs-tag { color: #22863a; }
.export-surface-editor .hljs-name { color: #22863a; }
.export-surface-editor .hljs-punctuation { color: #24292e; }
.export-surface-editor .hljs-subst { color: #24292e; }

/* Syntax highlighting - Dark theme */
.dark-theme .export-surface-editor .hljs-keyword { color: #ff7b72; }
.dark-theme .export-surface-editor .hljs-string { color: #a5d6ff; }
.dark-theme .export-surface-editor .hljs-number { color: #79c0ff; }
.dark-theme .export-surface-editor .hljs-comment { color: #8b949e; font-style: italic; }
.dark-theme .export-surface-editor .hljs-function { color: #d2a8ff; }
.dark-theme .export-surface-editor .hljs-title { color: #d2a8ff; }
.dark-theme .export-surface-editor .hljs-params { color: #c9d1d9; }
.dark-theme .export-surface-editor .hljs-built_in { color: #79c0ff; }
.dark-theme .export-surface-editor .hljs-literal { color: #79c0ff; }
.dark-theme .export-surface-editor .hljs-type { color: #ff7b72; }
.dark-theme .export-surface-editor .hljs-meta { color: #8b949e; }
.dark-theme .export-surface-editor .hljs-attr { color: #79c0ff; }
.dark-theme .export-surface-editor .hljs-attribute { color: #79c0ff; }
.dark-theme .export-surface-editor .hljs-selector-tag { color: #7ee787; }
.dark-theme .export-surface-editor .hljs-selector-class { color: #d2a8ff; }
.dark-theme .export-surface-editor .hljs-selector-id { color: #79c0ff; }
.dark-theme .export-surface-editor .hljs-variable { color: #ffa657; }
.dark-theme .export-surface-editor .hljs-template-variable { color: #ffa657; }
.dark-theme .export-surface-editor .hljs-tag { color: #7ee787; }
.dark-theme .export-surface-editor .hljs-name { color: #7ee787; }
.dark-theme .export-surface-editor .hljs-punctuation { color: #c9d1d9; }
.dark-theme .export-surface-editor .hljs-subst { color: #c9d1d9; }

/* Dark theme alert backgrounds */
.dark-theme .export-surface-editor .alert-note {
  --alert-border: var(--alert-note-dark, #58a6ff);
  --alert-bg: color-mix(in srgb, var(--alert-note-dark, #58a6ff) 8%, transparent);
  --alert-title: var(--alert-note-dark, #58a6ff);
}

.dark-theme .export-surface-editor .alert-tip {
  --alert-border: var(--alert-tip-dark, #3fb950);
  --alert-bg: color-mix(in srgb, var(--alert-tip-dark, #3fb950) 8%, transparent);
  --alert-title: var(--alert-tip-dark, #3fb950);
}

.dark-theme .export-surface-editor .alert-important {
  --alert-border: var(--alert-important-dark, #a371f7);
  --alert-bg: color-mix(in srgb, var(--alert-important-dark, #a371f7) 8%, transparent);
  --alert-title: var(--alert-important-dark, #a371f7);
}

.dark-theme .export-surface-editor .alert-warning {
  --alert-border: var(--alert-warning-dark, #d29922);
  --alert-bg: color-mix(in srgb, var(--alert-warning-dark, #d29922) 8%, transparent);
  --alert-title: var(--alert-warning-dark, #d29922);
}

.dark-theme .export-surface-editor .alert-caution {
  --alert-border: var(--alert-caution-dark, #f85149);
  --alert-bg: color-mix(in srgb, var(--alert-caution-dark, #f85149) 8%, transparent);
  --alert-title: var(--alert-caution-dark, #f85149);
}`;
}
