/**
 * Text Transformations
 *
 * Purpose: Pure functions for text line operations, shared between
 * WYSIWYG (Tiptap) and Source (CodeMirror) editors. Case transformations
 * live in caseTransformations.ts and are re-exported here so consumers
 * keep a single import site.
 *
 * Key decisions:
 *   - All functions are pure — no editor state dependency
 *   - Designed for both single-line and multi-line text (line operations
 *     handle newline splitting internally)
 *
 * @coordinates-with utils/caseTransformations.ts — case transforms (re-exported)
 * @coordinates-with toolbarActions/tiptapSelectionActions.ts — WYSIWYG case transforms
 * @coordinates-with sourceContextDetection/formatActions.ts — source mode case transforms
 * @module utils/textTransformations
 */

// ============================================================================
// Case Transformations (see caseTransformations.ts)
// ============================================================================

export {
  toUpperCase,
  toLowerCase,
  toTitleCase,
  toggleCase,
} from "./caseTransformations";

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
 * Get all lines in a range, expanding to full lines.
 * Returns { startLine, endLine, lines, fullStart, fullEnd }.
 *
 * Boundary semantics (CodeMirror line-block convention):
 *   - Offsets are clamped into the document.
 *   - A collapsed cursor belongs to the line it sits on — a cursor at the
 *     exact start of a line selects that line, not the previous one.
 *   - A NON-EMPTY selection ending exactly at the start of a line does not
 *     include that line (`to` is exclusive for non-empty selections).
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
  const len = text.length;

  // Clamp both offsets into the document and keep them ordered.
  const clampedFrom = Math.min(Math.max(from, 0), len);
  let clampedTo = Math.min(Math.max(to, clampedFrom), len);

  // Non-empty selection ending just past a newline merely touches the
  // next line's start — pull `to` back so that line is excluded.
  if (clampedTo > clampedFrom && text[clampedTo - 1] === "\n") {
    clampedTo -= 1;
  }

  let startLine = 0;
  let endLine = 0;
  let fullStart = 0;
  let fullEnd = len;
  let lineStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineEnd = lineStart + lines[i].length;

    // Position lineEnd (the newline slot) belongs to line i; lineEnd + 1
    // is the next line's start, so line ranges never overlap.
    if (clampedFrom >= lineStart && clampedFrom <= lineEnd) {
      startLine = i;
      fullStart = lineStart;
    }
    if (clampedTo >= lineStart && clampedTo <= lineEnd) {
      endLine = i;
      fullEnd = lineEnd;
      break;
    }

    lineStart = lineEnd + 1; // +1 for the newline
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
 * Shared implementation for line sorting — ascending/descending only
 * differ in comparator direction.
 */
function sortLines(
  text: string,
  from: number,
  to: number,
  direction: "asc" | "desc"
): { newText: string; newFrom: number; newTo: number } {
  const { fullStart, fullEnd, lines } = getLinesInRange(text, from, to);

  if (lines.length < 2) {
    return { newText: text, newFrom: from, newTo: to };
  }

  const sorted = [...lines].sort((a, b) =>
    direction === "asc" ? a.localeCompare(b) : b.localeCompare(a)
  );
  const sortedText = sorted.join("\n");

  return {
    newText: text.slice(0, fullStart) + sortedText + text.slice(fullEnd),
    newFrom: fullStart,
    newTo: fullStart + sortedText.length,
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
  return sortLines(text, from, to, "asc");
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
  return sortLines(text, from, to, "desc");
}
