/**
 * Paragraph Detection for Source Mode
 *
 * Detects if cursor is at line start of a paragraph (not in container nodes).
 * Used to determine when to show heading toolbar at line start.
 */

import type { EditorView } from "@codemirror/view";
import { getSourceTableInfo } from "./tableDetection";
import { getCodeFenceInfo } from "./codeFenceDetection";

/**
 * Check if cursor is at line start of a paragraph.
 * Returns true if cursor is at line start AND the line is a plain paragraph
 * (not a heading, list item, blockquote, table cell, or in code block).
 */
export function isAtParagraphLineStart(view: EditorView): boolean {
  const { state } = view;
  const { from } = state.selection.main;
  const doc = state.doc;
  const line = doc.lineAt(from);

  // Must be at line start (or only whitespace before cursor on line)
  const textBeforeCursor = line.text.slice(0, from - line.from);
  if (textBeforeCursor.trim() !== "") {
    return false;
  }

  const lineText = line.text;
  const trimmed = lineText.trim();

  // Skip empty lines (those show block-insert toolbar)
  if (trimmed === "") {
    return false;
  }

  // Skip if already a heading
  if (/^#{1,6}\s/.test(lineText)) {
    return false;
  }

  // Skip list items (unordered: -, *, +)
  if (/^\s*[-*+]\s/.test(lineText)) {
    return false;
  }

  // Skip list items (ordered: 1., 2., etc.)
  if (/^\s*\d+\.\s/.test(lineText)) {
    return false;
  }

  // Skip task list items
  if (/^\s*[-*+]\s*\[[ xX]\]\s/.test(lineText)) {
    return false;
  }

  // Skip blockquote lines
  if (/^\s*>/.test(lineText)) {
    return false;
  }

  // Skip if in a table
  if (getSourceTableInfo(view)) {
    return false;
  }

  // Skip if in a code fence
  if (getCodeFenceInfo(view)) {
    return false;
  }

  // Skip horizontal rules
  if (/^\s*([-*_])\s*\1\s*\1\s*$/.test(lineText)) {
    return false;
  }

  return true;
}
