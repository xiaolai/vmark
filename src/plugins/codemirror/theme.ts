/**
 * CodeMirror Theme Configuration
 *
 * Styling for the Source mode editor.
 * Includes syntax highlighting for code blocks.
 */

import { EditorView } from "@codemirror/view";
import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * Syntax highlight style for code blocks.
 * Uses CSS classes for theme-aware colors.
 */
export const codeHighlightStyle = HighlightStyle.define([
  // Keywords (if, else, for, while, function, class, etc.)
  { tag: tags.keyword, class: "cm-hl-keyword" },
  // Built-in types (int, string, bool, void, etc.)
  { tag: tags.typeName, class: "cm-hl-type" },
  // Type parameters and annotations
  { tag: tags.annotation, class: "cm-hl-type" },
  // Function/method definitions
  { tag: tags.definition(tags.function(tags.variableName)), class: "cm-hl-function" },
  // Function calls
  { tag: tags.function(tags.variableName), class: "cm-hl-function" },
  // Property names
  { tag: tags.propertyName, class: "cm-hl-property" },
  // Variable names
  { tag: tags.variableName, class: "cm-hl-variable" },
  // Strings
  { tag: tags.string, class: "cm-hl-string" },
  // Numbers
  { tag: tags.number, class: "cm-hl-number" },
  // Boolean values
  { tag: tags.bool, class: "cm-hl-number" },
  // null/undefined
  { tag: tags.null, class: "cm-hl-number" },
  // Operators (+, -, *, /, =, ==, etc.)
  { tag: tags.operator, class: "cm-hl-operator" },
  // Punctuation (brackets, commas, semicolons)
  { tag: tags.punctuation, class: "cm-hl-punctuation" },
  // Comments
  { tag: tags.comment, class: "cm-hl-comment" },
  { tag: tags.lineComment, class: "cm-hl-comment" },
  { tag: tags.blockComment, class: "cm-hl-comment" },
  // Regex
  { tag: tags.regexp, class: "cm-hl-string" },
  // Escape characters in strings
  { tag: tags.escape, class: "cm-hl-escape" },
  // Special variables (this, self)
  { tag: tags.self, class: "cm-hl-keyword" },
  // Constants/enums
  { tag: tags.constant(tags.variableName), class: "cm-hl-constant" },
  // Labels
  { tag: tags.labelName, class: "cm-hl-function" },
  // Namespace/module names
  { tag: tags.namespace, class: "cm-hl-type" },
  // Class names
  { tag: tags.className, class: "cm-hl-type" },
  // Attribute names (HTML/XML)
  { tag: tags.attributeName, class: "cm-hl-attribute" },
  // Attribute values (HTML/XML)
  { tag: tags.attributeValue, class: "cm-hl-string" },
  // HTML/XML tags
  { tag: tags.tagName, class: "cm-hl-tag" },
  // Links
  { tag: tags.link, class: "cm-hl-link" },
  // Headings
  { tag: tags.heading, fontWeight: "bold" },
  // Emphasis (italic in markdown)
  { tag: tags.emphasis, fontStyle: "italic" },
  // Strong (bold in markdown)
  { tag: tags.strong, fontWeight: "bold" },
  // Strikethrough
  { tag: tags.strikethrough, textDecoration: "line-through" },
  // Code/monospace
  { tag: tags.monospace, fontFamily: "var(--font-mono)" },
  // Invalid/error syntax
  { tag: tags.invalid, class: "cm-hl-invalid" },
]);

/**
 * Custom theme for the Source mode editor.
 * Uses CSS variables for theming compatibility.
 */
export const sourceEditorTheme = EditorView.theme({
  "&": {
    // Source mode is all mono/code, so use 0.9x to match WYSIWYG code blocks
    fontSize: "calc(var(--editor-font-size) * 0.9)",
    height: "100%",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    lineHeight: "var(--editor-line-height)",
    caretColor: "var(--text-color)",
    padding: "0",
  },
  ".cm-line": {
    padding: "0",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--selection-color, rgba(0, 122, 255, 0.2)) !important",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--text-color)",
    borderLeftWidth: "2px",
  },
  // Secondary cursors for multi-cursor
  ".cm-cursor-secondary": {
    borderLeftColor: "var(--primary-color)",
    borderLeftWidth: "2px",
  },
});
