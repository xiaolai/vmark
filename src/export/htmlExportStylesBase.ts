/**
 * HTML Export Styles — Base
 *
 * Purpose: CSS for container layout, typography, code blocks, lists,
 * and task lists used in exported HTML documents.
 *
 * @module export/htmlExportStylesBase
 * @coordinates-with htmlExportStyles.ts — composed into getEditorContentCSS()
 */

/** Container layout + base typography + code blocks + lists + task lists. */
export function getBaseStyles(): string {
  return `
/* Container layout */
.export-surface {
  max-width: var(--editor-width, 50em);
  margin: 0 auto;
  padding: 2em;
}

/* Base content styles */
.export-surface-editor {
  font-family: var(--font-sans);
  font-size: var(--editor-font-size, 16px);
  line-height: var(--editor-line-height, 1.6);
  color: var(--text-color);
  background: var(--bg-color);
}

/* Typography */
.export-surface-editor h1,
.export-surface-editor h2,
.export-surface-editor h3,
.export-surface-editor h4,
.export-surface-editor h5,
.export-surface-editor h6 {
  font-weight: 600;
  line-height: 1.3;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}

.export-surface-editor h1 {
  font-size: 1.8em;
  margin-top: 1.75em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid var(--border-color);
}
.export-surface-editor h2 { font-size: 1.5em; }
.export-surface-editor h3 { font-size: 1.25em; }
.export-surface-editor h4 { font-size: 1em; }
.export-surface-editor h5 { font-size: 0.875em; }
.export-surface-editor h6 {
  font-size: 0.85em;
  color: var(--text-tertiary);
}

.export-surface-editor p {
  margin: 0 0 1em 0;
}

/* Links */
.export-surface-editor a {
  color: var(--primary-color);
  text-decoration: none;
}

.export-surface-editor a:hover {
  text-decoration: underline;
}

/* Inline code */
.export-surface-editor code {
  font-family: var(--font-mono);
  font-size: var(--editor-font-size-mono, 0.85em);
  background: var(--code-bg-color);
  color: var(--code-text-color);
  padding: 0.2em 0.4em;
  border-radius: var(--radius-sm, 3px);
}

/* Code blocks */
.export-surface-editor pre {
  font-family: var(--font-mono);
  font-size: var(--editor-font-size-mono, 0.85em);
  background: var(--code-bg-color);
  padding: var(--code-padding, 18px);
  border-radius: var(--radius-md, 6px);
  overflow-x: auto;
  margin: 0 0 var(--editor-block-spacing, 1em) 0;
  line-height: var(--code-line-height, 1.45);
}

.export-surface-editor pre code {
  background: none;
  padding: 0;
  font-size: inherit;
}

/* Code block wrapper with line numbers - uses flexbox like editor */
.export-surface-editor .code-block-wrapper {
  display: flex;
  position: relative;
  margin: 0 0 var(--editor-block-spacing, 1em) 0;
  background: var(--code-bg-color);
  border-radius: var(--radius-md, 6px);
}

.export-surface-editor .code-block-wrapper pre {
  margin: 0;
  padding: var(--code-padding, 18px);
  flex: 1;
  min-width: 0;
  border-radius: 0;
  background: transparent;
  line-height: var(--code-line-height, 1.45);
}

.export-surface-editor .code-line-numbers {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 2em;
  padding: var(--code-padding, 18px) 0.5em;
  text-align: right;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: var(--editor-font-size-mono, 0.85em);
  line-height: var(--code-line-height, 1.45);
  user-select: none;
  border-right: 1px solid var(--border-color);
  background: var(--code-bg-color);
}

.export-surface-editor .code-line-numbers .line-num {
  line-height: inherit;
}

.export-surface-editor .code-lang-selector {
  position: absolute;
  top: 0.5em;
  right: 0.5em;
  font-size: 0.75em;
  color: var(--text-tertiary);
  background: var(--bg-secondary);
  padding: 0.2em 0.5em;
  border-radius: 3px;
}

/* Code block with preview only (math/mermaid) */
.export-surface-editor .code-block-preview-only {
  background: transparent;
}

.export-surface-editor .code-block-preview-only pre {
  display: none;
}

.export-surface-editor .code-block-preview-only .code-line-numbers,
.export-surface-editor .code-block-preview-only .code-lang-selector {
  display: none;
}

/* Lists */
.export-surface-editor ul,
.export-surface-editor ol {
  --list-indent: 1em;
  margin: 0 0 var(--editor-block-spacing, 1em) 0;
  padding-left: var(--list-indent);
}

.export-surface-editor li {
  margin: 0.25em 0;
}

.export-surface-editor li > ul,
.export-surface-editor li > ol {
  margin: 0.25em 0;
}

.export-surface-editor li > p {
  margin: 0;
}

.export-surface-editor li > p + p {
  margin-top: 0.5em;
}

/* Task lists - checkbox aligned to line height like editor */
.export-surface-editor .task-list-item {
  --checkbox-size: 0.85em;
  --checkbox-gap: calc(var(--checkbox-size) * 0.4);
  list-style-type: none;
  display: flex;
  align-items: flex-start;
  gap: var(--checkbox-gap);
  margin-left: calc(-1 * var(--list-indent, 1em));
}

.export-surface-editor .task-list-checkbox {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: var(--editor-line-height-px, 28.8px);
}

.export-surface-editor .task-list-checkbox input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
  width: var(--checkbox-size);
  height: var(--checkbox-size);
  border: 1px solid var(--border-color);
  border-radius: calc(var(--checkbox-size) * 0.2);
  background: var(--bg-color);
  cursor: default;
  position: relative;
}

.export-surface-editor .task-list-checkbox input[type="checkbox"]:checked {
  background: var(--primary-color);
  border-color: var(--primary-color);
}

.export-surface-editor .task-list-checkbox input[type="checkbox"]:checked::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 45%;
  width: calc(var(--checkbox-size) * 0.25);
  height: calc(var(--checkbox-size) * 0.5);
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: translate(-50%, -50%) rotate(45deg);
}

.export-surface-editor .task-list-content {
  flex: 1;
  min-width: 0;
  line-height: var(--editor-line-height-px, 28.8px);
}

.export-surface-editor .task-list-content > p {
  margin: 0;
  line-height: inherit;
}`;
}
