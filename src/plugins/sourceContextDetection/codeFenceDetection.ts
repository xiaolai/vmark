/**
 * Code Fence Detection
 *
 * Detects if cursor is inside a code fence (``` ... ```)
 * and provides information for modifying the language.
 */

import type { EditorView } from "@codemirror/view";

export interface CodeFenceInfo {
  /** Current language (empty string if none) */
  language: string;
  /** Line number of opening ``` (1-indexed) */
  startLine: number;
  /** Line number of closing ``` (1-indexed) */
  endLine: number;
  /** Document position of the opening ``` */
  fenceStartPos: number;
  /** Document position right after ``` where language starts */
  languageStartPos: number;
  /** Document position at end of language (or same as languageStartPos if no language) */
  languageEndPos: number;
}

/**
 * Pattern to match opening code fence with optional language.
 * Captures: [1] fence chars (``` or more), [2] language (optional)
 */
const FENCE_OPEN_PATTERN = /^(\s*)(```+)(\w*)?/;

/**
 * Get code fence info if cursor is inside a code fence.
 * Returns null if cursor is not in a code fence.
 */
export function getCodeFenceInfo(view: EditorView): CodeFenceInfo | null {
  const { from } = view.state.selection.main;
  const doc = view.state.doc;

  // Find the line containing cursor
  const cursorLine = doc.lineAt(from);
  const cursorLineNum = cursorLine.number;

  // Search backwards for opening fence
  let openingLine: { number: number; text: string; from: number } | null = null;
  let fenceLength = 0;
  let indent = "";

  for (let lineNum = cursorLineNum; lineNum >= 1; lineNum--) {
    const line = doc.line(lineNum);
    const match = line.text.match(FENCE_OPEN_PATTERN);

    if (match && match[2]) {
      // Found a potential opening fence
      const potentialIndent = match[1];
      const potentialFenceChars = match[2];

      // Check if this is actually an opening (not a closing) by looking for its pair
      const isOpening = isOpeningFence(doc, lineNum);

      if (isOpening) {
        openingLine = { number: lineNum, text: line.text, from: line.from };
        fenceLength = potentialFenceChars.length;
        indent = potentialIndent;
        break;
      }
    }
  }

  if (!openingLine) {
    return null; // No opening fence found above cursor
  }

  // Search forwards for closing fence
  let closingLine: { number: number; text: string } | null = null;
  const totalLines = doc.lines;

  for (let lineNum = openingLine.number + 1; lineNum <= totalLines; lineNum++) {
    const line = doc.line(lineNum);
    const trimmed = line.text.trim();

    // Closing fence must have at least as many backticks as opening
    if (trimmed.match(new RegExp(`^\`{${fenceLength},}$`))) {
      closingLine = { number: lineNum, text: line.text };
      break;
    }
  }

  if (!closingLine) {
    return null; // No closing fence found
  }

  // Check if cursor is between opening and closing (inclusive of opening line)
  if (cursorLineNum < openingLine.number || cursorLineNum > closingLine.number) {
    return null;
  }

  // Parse the opening line for language
  const openMatch = openingLine.text.match(FENCE_OPEN_PATTERN);
  if (!openMatch) return null;

  const indentLength = indent.length;
  const fenceChars = openMatch[2];
  const language = openMatch[3] || "";

  // Calculate positions
  const fenceStartPos = openingLine.from + indentLength;
  const languageStartPos = fenceStartPos + fenceChars.length;
  const languageEndPos = languageStartPos + language.length;

  return {
    language,
    startLine: openingLine.number,
    endLine: closingLine.number,
    fenceStartPos,
    languageStartPos,
    languageEndPos,
  };
}

/**
 * Check if a fence at given line is an opening fence (not closing).
 * Uses fence counting: fences alternate between opening and closing.
 * Even count before = opening, odd count before = closing.
 */
function isOpeningFence(
  doc: { line: (n: number) => { text: string }; lines: number },
  lineNum: number
): boolean {
  const line = doc.line(lineNum);
  const match = line.text.match(FENCE_OPEN_PATTERN);

  if (!match) return false;

  // If line has language identifier, it's definitely an opening
  if (match[3]) return true;

  // For fence without language, count fences from start to determine parity.
  // Fences pair up: 1st=open, 2nd=close, 3rd=open, 4th=close, etc.
  // So if even count (0, 2, 4...) before this line, this fence is opening.
  // If odd count (1, 3, 5...) before this line, this fence is closing.
  let fenceCount = 0;
  for (let i = 1; i < lineNum; i++) {
    const checkLine = doc.line(i);
    if (FENCE_OPEN_PATTERN.test(checkLine.text)) {
      fenceCount++;
    }
  }

  // Even count before means this is an opening fence
  return fenceCount % 2 === 0;
}
