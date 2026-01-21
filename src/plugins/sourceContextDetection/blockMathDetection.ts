/**
 * Block Math Detection for Source Mode
 *
 * Detects if cursor is inside a block math region ($$...$$).
 */

import type { EditorView } from "@codemirror/view";

export interface BlockMathInfo {
  /** Start position of the block (including $$) */
  from: number;
  /** End position of the block (including $$) */
  to: number;
  /** Line number where block starts */
  startLine: number;
  /** Line number where block ends */
  endLine: number;
  /** The math content (without $$) */
  content: string;
}

/**
 * Detect if cursor is inside a block math region ($$...$$).
 */
export function getBlockMathInfo(view: EditorView): BlockMathInfo | null {
  const { state } = view;
  const { from } = state.selection.main;
  const doc = state.doc;
  const currentLine = doc.lineAt(from);
  const currentLineNum = currentLine.number;

  // Scan upward to find opening $$
  let openLine: number | null = null;
  let openPos: number | null = null;

  for (let lineNum = currentLineNum; lineNum >= 1; lineNum--) {
    const line = doc.line(lineNum);
    const text = line.text.trim();

    // Check for $$ at start of line (opening)
    if (text.startsWith("$$")) {
      // Check if this is an opening delimiter (not a closing one)
      // It's opening if it's before our cursor
      openLine = lineNum;
      openPos = line.from;
      break;
    }
  }

  if (openLine === null || openPos === null) {
    return null;
  }

  // Scan downward to find closing $$
  let closeLine: number | null = null;
  let closePos: number | null = null;
  const totalLines = doc.lines;

  for (let lineNum = openLine + 1; lineNum <= totalLines; lineNum++) {
    const line = doc.line(lineNum);
    const text = line.text.trim();

    // Check for $$ (closing)
    if (text === "$$" || text.endsWith("$$")) {
      closeLine = lineNum;
      closePos = line.to;
      break;
    }
  }

  if (closeLine === null || closePos === null) {
    return null;
  }

  // Check if cursor is within the block math region
  if (currentLineNum < openLine || currentLineNum > closeLine) {
    return null;
  }

  // Get the content between $$
  const content: string[] = [];
  for (let lineNum = openLine; lineNum <= closeLine; lineNum++) {
    const line = doc.line(lineNum);
    let text = line.text;
    if (lineNum === openLine) {
      text = text.replace(/^\s*\$\$/, "");
    }
    if (lineNum === closeLine) {
      text = text.replace(/\$\$\s*$/, "");
    }
    if (text.trim() !== "" || (lineNum !== openLine && lineNum !== closeLine)) {
      content.push(text);
    }
  }

  return {
    from: openPos,
    to: closePos,
    startLine: openLine,
    endLine: closeLine,
    content: content.join("\n").trim(),
  };
}
