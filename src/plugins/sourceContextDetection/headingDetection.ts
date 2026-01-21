/**
 * Heading Detection for Source Mode
 *
 * Utilities to detect if selection is in a markdown heading
 * and change heading levels.
 */

import type { EditorView } from "@codemirror/view";
export interface HeadingInfo {
  level: number; // 1-6, or 0 for paragraph
  lineStart: number;
  lineEnd: number;
}

/**
 * Detect if the current line is a heading and get its info.
 */
export function getHeadingInfo(view: EditorView, pos?: number): HeadingInfo | null {
  const { state } = view;
  const from = typeof pos === "number" ? pos : state.selection.main.from;
  const doc = state.doc;

  // Get current line
  const line = doc.lineAt(from);
  const lineText = line.text;

  // Check if line starts with # (heading)
  const headingMatch = lineText.match(/^(#{1,6})\s/);
  if (headingMatch) {
    return {
      level: headingMatch[1].length,
      lineStart: line.from,
      lineEnd: line.to,
    };
  }

  return null;
}

/**
 * Change heading level on the current line.
 * @param level 0 = paragraph (remove heading), 1-6 = heading level
 */
export function setHeadingLevel(
  view: EditorView,
  info: HeadingInfo,
  newLevel: number
): void {
  const doc = view.state.doc;
  const line = doc.lineAt(info.lineStart);
  const lineText = line.text;

  // Remove existing heading markers
  const textWithoutHeading = lineText.replace(/^#{1,6}\s*/, "");

  // Build new line
  let newLine: string;
  if (newLevel === 0) {
    // Convert to paragraph
    newLine = textWithoutHeading;
  } else {
    // Add heading markers
    const markers = "#".repeat(newLevel);
    newLine = `${markers} ${textWithoutHeading}`;
  }

  view.dispatch({
    changes: { from: line.from, to: line.to, insert: newLine },
  });

  view.focus();
}

/**
 * Convert current line to a heading (for non-heading lines).
 * @param level 1-6 = heading level
 */
export function convertToHeading(view: EditorView, level: number, pos?: number): void {
  if (level < 1 || level > 6) return;

  const from = typeof pos === "number" ? pos : view.state.selection.main.from;
  const doc = view.state.doc;
  const line = doc.lineAt(from);
  const lineText = line.text;

  // Remove any existing heading markers (in case called on heading line)
  const textWithoutHeading = lineText.replace(/^#{1,6}\s*/, "");

  // Add heading markers
  const markers = "#".repeat(level);
  const newLine = `${markers} ${textWithoutHeading}`;

  view.dispatch({
    changes: { from: line.from, to: line.to, insert: newLine },
  });

  view.focus();
}
