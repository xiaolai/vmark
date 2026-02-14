/**
 * Text Transformations
 *
 * Purpose: Pure functions for text case transformations and line operations,
 * shared between WYSIWYG (Tiptap) and Source (CodeMirror) editors.
 *
 * Key decisions:
 *   - Title Case uses Unicode-aware word boundary detection
 *   - All functions are pure — no editor state dependency
 *   - Designed for both single-line and multi-line text (line operations
 *     handle newline splitting internally)
 *
 * @coordinates-with toolbarActions/tiptapSelectionActions.ts — WYSIWYG case transforms
 * @coordinates-with sourceContextDetection/formatActions.ts — source mode case transforms
 * @module utils/textTransformations
 */

// ============================================================================
// Case Transformations
// ============================================================================

/**
 * Convert text to UPPERCASE.
 */
export function toUpperCase(text: string): string {
  return text.toUpperCase();
}

/**
 * Convert text to lowercase.
 */
export function toLowerCase(text: string): string {
  return text.toLowerCase();
}

/**
 * Convert text to Title Case.
 * Capitalizes the first letter of each word.
 */
export function toTitleCase(text: string): string {
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Toggle case: if mostly uppercase, convert to lowercase; otherwise, convert to uppercase.
 */
export function toggleCase(text: string): string {
  const upperCount = (text.match(/[A-Z]/g) || []).length;
  const lowerCount = (text.match(/[a-z]/g) || []).length;

  // If more than half are uppercase (or equal), convert to lowercase
  if (upperCount >= lowerCount) {
    return text.toLowerCase();
  }
  return text.toUpperCase();
}

/**
 * Remove blank lines from text.
 * A blank line is one that contains only whitespace.
 */
export function removeBlankLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .join("\n");
}

// ============================================================================
// Line Operations
// ============================================================================

/**
 * Get line boundaries for a position in text.
 * Returns { lineStart, lineEnd, lineText }.
 */
export function getLineBoundaries(
  text: string,
  pos: number
): { lineStart: number; lineEnd: number; lineText: string } {
  let lineStart = pos;
  while (lineStart > 0 && text[lineStart - 1] !== "\n") {
    lineStart--;
  }

  let lineEnd = pos;
  while (lineEnd < text.length && text[lineEnd] !== "\n") {
    lineEnd++;
  }

  return {
    lineStart,
    lineEnd,
    lineText: text.slice(lineStart, lineEnd),
  };
}

/**
 * Get all lines in a range, expanding to full lines.
 * Returns { startLine, endLine, lines, fullStart, fullEnd }.
 */
export function getLinesInRange(
  text: string,
  from: number,
  to: number
): {
  startLine: number;
  endLine: number;
  lines: string[];
  fullStart: number;
  fullEnd: number;
} {
  const lines = text.split("\n");
  let currentPos = 0;
  let startLine = 0;
  let endLine = 0;
  let fullStart = 0;
  let fullEnd = text.length;

  for (let i = 0; i < lines.length; i++) {
    const lineStart = currentPos;
    const lineEnd = currentPos + lines[i].length;

    // Check if 'from' is within this line
    if (from >= lineStart && from <= lineEnd) {
      startLine = i;
      fullStart = lineStart;
    }

    // Check if 'to' is within this line
    if (to >= lineStart && to <= lineEnd) {
      endLine = i;
      fullEnd = lineEnd;
      break;
    }

    // Also handle case where 'to' is at the newline position
    if (to === lineEnd + 1 && i < lines.length - 1) {
      endLine = i;
      fullEnd = lineEnd;
      break;
    }

    currentPos = lineEnd + 1; // +1 for newline
  }

  // If we didn't find endLine, use the last line
  if (to > fullEnd) {
    endLine = lines.length - 1;
    fullEnd = text.length;
  }

  return {
    startLine,
    endLine,
    lines: lines.slice(startLine, endLine + 1),
    fullStart,
    fullEnd,
  };
}

/**
 * Move lines up within text.
 * Returns { newText, newFrom, newTo } or null if can't move.
 */
export function moveLinesUp(
  text: string,
  from: number,
  to: number
): { newText: string; newFrom: number; newTo: number } | null {
  const { startLine, endLine } = getLinesInRange(text, from, to);

  if (startLine === 0) {
    return null; // Already at top
  }

  const lines = text.split("\n");
  const linesToMove = lines.slice(startLine, endLine + 1);
  const prevLine = lines[startLine - 1];

  // Swap lines
  const newLines = [
    ...lines.slice(0, startLine - 1),
    ...linesToMove,
    prevLine,
    ...lines.slice(endLine + 1),
  ];

  const newText = newLines.join("\n");
  const prevLineLength = prevLine.length + 1; // +1 for newline

  return {
    newText,
    newFrom: from - prevLineLength,
    newTo: to - prevLineLength,
  };
}

/**
 * Move lines down within text.
 * Returns { newText, newFrom, newTo } or null if can't move.
 */
export function moveLinesDown(
  text: string,
  from: number,
  to: number
): { newText: string; newFrom: number; newTo: number } | null {
  const { startLine, endLine } = getLinesInRange(text, from, to);

  const lines = text.split("\n");

  if (endLine >= lines.length - 1) {
    return null; // Already at bottom
  }

  const linesToMove = lines.slice(startLine, endLine + 1);
  const nextLine = lines[endLine + 1];

  // Swap lines
  const newLines = [
    ...lines.slice(0, startLine),
    nextLine,
    ...linesToMove,
    ...lines.slice(endLine + 2),
  ];

  const newText = newLines.join("\n");
  const nextLineLength = nextLine.length + 1; // +1 for newline

  return {
    newText,
    newFrom: from + nextLineLength,
    newTo: to + nextLineLength,
  };
}

/**
 * Duplicate lines.
 * Returns { newText, newFrom, newTo }.
 */
export function duplicateLines(
  text: string,
  from: number,
  to: number
): { newText: string; newFrom: number; newTo: number } {
  const { fullEnd, lines } = getLinesInRange(text, from, to);
  const selectedText = lines.join("\n");

  // Insert duplicate after selected lines
  const before = text.slice(0, fullEnd);
  const after = text.slice(fullEnd);

  const newText = before + "\n" + selectedText + after;
  const duplicateLength = selectedText.length + 1; // +1 for newline

  return {
    newText,
    newFrom: from + duplicateLength,
    newTo: to + duplicateLength,
  };
}

/**
 * Delete lines.
 * Returns { newText, newCursor }.
 */
export function deleteLines(
  text: string,
  from: number,
  to: number
): { newText: string; newCursor: number } {
  const { fullStart, fullEnd } = getLinesInRange(text, from, to);

  let deleteStart = fullStart;
  let deleteEnd = fullEnd;

  // Include the newline after the deleted lines (or before if at end)
  if (deleteEnd < text.length && text[deleteEnd] === "\n") {
    deleteEnd++;
  } else if (deleteStart > 0) {
    deleteStart--;
  }

  const newText = text.slice(0, deleteStart) + text.slice(deleteEnd);
  const newCursor = Math.min(deleteStart, newText.length);

  return { newText, newCursor };
}

/**
 * Join lines (remove newlines in selection or join current line with next).
 * Returns { newText, newFrom, newTo }.
 */
export function joinLines(
  text: string,
  from: number,
  to: number
): { newText: string; newFrom: number; newTo: number } {
  const { startLine, endLine, fullStart, fullEnd, lines } = getLinesInRange(text, from, to);

  if (lines.length === 1) {
    // Single line: join with next line
    const allLines = text.split("\n");
    if (endLine >= allLines.length - 1) {
      // No next line to join
      return { newText: text, newFrom: from, newTo: to };
    }

    const currentLine = allLines[startLine];
    const nextLine = allLines[startLine + 1].trimStart();
    const joined = currentLine + " " + nextLine;

    allLines.splice(startLine, 2, joined);
    return {
      newText: allLines.join("\n"),
      newFrom: from,
      newTo: from,
    };
  }

  // Multiple lines: join them all
  const joined = lines.map((l, i) => (i === 0 ? l : l.trimStart())).join(" ");
  const before = text.slice(0, fullStart);
  const after = text.slice(fullEnd);

  return {
    newText: before + joined + after,
    newFrom: fullStart,
    newTo: fullStart + joined.length,
  };
}

/**
 * Sort lines ascending.
 * Returns { newText, newFrom, newTo }.
 */
export function sortLinesAscending(
  text: string,
  from: number,
  to: number
): { newText: string; newFrom: number; newTo: number } {
  const { fullStart, fullEnd, lines } = getLinesInRange(text, from, to);

  if (lines.length < 2) {
    return { newText: text, newFrom: from, newTo: to };
  }

  const sorted = [...lines].sort((a, b) => a.localeCompare(b));
  const sortedText = sorted.join("\n");

  const before = text.slice(0, fullStart);
  const after = text.slice(fullEnd);

  return {
    newText: before + sortedText + after,
    newFrom: fullStart,
    newTo: fullStart + sortedText.length,
  };
}

/**
 * Sort lines descending.
 * Returns { newText, newFrom, newTo }.
 */
export function sortLinesDescending(
  text: string,
  from: number,
  to: number
): { newText: string; newFrom: number; newTo: number } {
  const { fullStart, fullEnd, lines } = getLinesInRange(text, from, to);

  if (lines.length < 2) {
    return { newText: text, newFrom: from, newTo: to };
  }

  const sorted = [...lines].sort((a, b) => b.localeCompare(a));
  const sortedText = sorted.join("\n");

  const before = text.slice(0, fullStart);
  const after = text.slice(fullEnd);

  return {
    newText: before + sortedText + after,
    newFrom: fullStart,
    newTo: fullStart + sortedText.length,
  };
}
