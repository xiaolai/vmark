/**
 * CodeMirror Cursor Sync
 *
 * Purpose: Extract and restore cursor position in source mode (CodeMirror)
 * during WYSIWYG <-> Source mode switches.
 *
 * Pipeline: Mode switch triggers getCursorInfoFromCodeMirror() to snapshot
 * position, then restoreCursorInCodeMirror() replays it in the other direction.
 *
 * Key decisions:
 *   - Uses sourceLine (1-indexed) as primary anchor, matching remark parser output
 *   - Block anchors (code blocks, tables) carry sub-block coordinates for precision
 *   - Falls back to context matching -> word matching -> percentage for column
 *
 * @coordinates-with cursorSync/tiptap.ts — the WYSIWYG counterpart of these functions
 * @coordinates-with cursorSync/markdown.ts — provides markdown syntax stripping
 * @module utils/cursorSync/codemirror
 */

import type { EditorView } from "@codemirror/view";
import type { CursorInfo, BlockAnchor } from "@/types/cursorSync";
import {
  detectNodeType,
  stripMarkdownSyntax,
  isInsideCodeBlock,
  findCodeFenceStartLine,
} from "./markdown";
import { extractCursorContext } from "./matching";
import { MIN_CONTEXT_PATTERN_LENGTH } from "./pmHelpers";
import { getTableAnchorForLine, restoreTableColumnFromAnchor } from "./table";

/**
 * Extract code block anchor from source position.
 * Returns line number within the code block and column.
 */
function getCodeBlockAnchor(lines: string[], lineIndex: number, column: number): BlockAnchor | undefined {
  const fenceStart = findCodeFenceStartLine(lines, lineIndex);
  if (fenceStart === null) return undefined;

  // Line within code block (0-based, first content line is 0)
  // fenceStart is the ``` line, so content starts at fenceStart + 1
  const rawLineInBlock = lineIndex - fenceStart - 1;
  const lineInBlock = Math.max(0, rawLineInBlock);

  return {
    kind: "code",
    lineInBlock,
    columnInLine: rawLineInBlock < 0 ? 0 : column,
  };
}

/**
 * Extract cursor info from CodeMirror editor.
 * Uses actual source line number (1-indexed) for sync.
 */
export function getCursorInfoFromCodeMirror(view: EditorView): CursorInfo {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const column = pos - line.from;
  const lineText = line.text;

  // Source line number (1-indexed, matches remark parser)
  const sourceLine = line.number;
  const lineIndex = line.number - 1; // 0-based for array access

  const content = view.state.doc.toString();
  const lines = content.split("\n");

  // Detect node type
  let nodeType = detectNodeType(lineText);

  // Check if inside code block and get block anchor
  let blockAnchor: BlockAnchor | undefined;
  if (isInsideCodeBlock(lines, lineIndex)) {
    nodeType = "code_block";
    blockAnchor = getCodeBlockAnchor(lines, lineIndex, column);
  } else {
    const tableAnchor = getTableAnchorForLine(lines, lineIndex, column);
    if (tableAnchor) {
      nodeType = "table_cell";
      blockAnchor = tableAnchor;
    }
  }

  // Strip markdown syntax for accurate text positioning
  const { text: strippedText, adjustedColumn } = stripMarkdownSyntax(lineText, column);

  // Extract word and context from stripped text
  const context = extractCursorContext(strippedText, adjustedColumn);

  // Calculate percentage position in the stripped text
  const percentInLine = strippedText.length > 0 ? adjustedColumn / strippedText.length : 0;

  return {
    sourceLine,
    wordAtCursor: context.word,
    offsetInWord: context.offsetInWord,
    nodeType,
    percentInLine,
    contextBefore: context.contextBefore,
    contextAfter: context.contextAfter,
    blockAnchor,
  };
}

/**
 * Find the start line of a code block containing the given source line.
 * Returns the 1-indexed line number of the opening fence.
 */
function findCodeBlockStartLine(view: EditorView, targetLine: number): number | null {
  const content = view.state.doc.toString();
  const lines = content.split("\n");

  const fenceStart = findCodeFenceStartLine(lines, targetLine - 1);
  if (fenceStart === null) return null;
  return fenceStart + 1; // Convert to 1-indexed
}

/**
 * Restore cursor in code block using block anchor coordinates.
 */
function restoreCursorInCodeBlockSource(
  view: EditorView,
  sourceLine: number,
  anchor: { lineInBlock: number; columnInLine: number }
): boolean {
  // Find the code block start
  const fenceStartLine = findCodeBlockStartLine(view, sourceLine);
  if (fenceStartLine === null) return false;

  // Calculate target line: fence line + 1 (content start) + lineInBlock
  const targetLineNum = fenceStartLine + 1 + anchor.lineInBlock;

  // Clamp to valid range
  const lineCount = view.state.doc.lines;
  if (targetLineNum < 1 || targetLineNum > lineCount) return false;

  const docLine = view.state.doc.line(targetLineNum);

  // Apply column offset (clamped to line length)
  const column = Math.min(anchor.columnInLine, docLine.text.length);
  const pos = docLine.from + column;

  view.dispatch({
    selection: { anchor: pos },
    scrollIntoView: true,
  });

  return true;
}

/**
 * Restore cursor in a table row using block anchor coordinates.
 */
function restoreCursorInTableSource(
  view: EditorView,
  sourceLine: number,
  anchor: { col: number; offsetInCell: number }
): boolean {
  const lineCount = view.state.doc.lines;
  const targetLine = Math.max(1, Math.min(sourceLine, lineCount));
  const docLine = view.state.doc.line(targetLine);

  const column = restoreTableColumnFromAnchor(docLine.text, anchor);
  if (column === null) return false;

  const pos = docLine.from + column;

  view.dispatch({
    selection: { anchor: pos },
    scrollIntoView: true,
  });

  return true;
}

/**
 * Restore cursor position in CodeMirror from cursor info.
 * Uses sourceLine for direct line lookup - much simpler and more accurate.
 * Uses block anchors for precise positioning in code blocks and tables.
 */
export function restoreCursorInCodeMirror(view: EditorView, cursorInfo: CursorInfo): void {
  const { sourceLine, blockAnchor } = cursorInfo;

  // Try block-specific restoration for code blocks and tables
  if (blockAnchor) {
    if (blockAnchor.kind === "code") {
      if (restoreCursorInCodeBlockSource(view, sourceLine, blockAnchor)) {
        return;
      }
    } else if (blockAnchor.kind === "table") {
      if (restoreCursorInTableSource(view, sourceLine, blockAnchor)) {
        return;
      }
    }
  }

  // Fall back to generic restoration
  // Clamp to valid line range
  const lineCount = view.state.doc.lines;
  const targetLine = Math.max(1, Math.min(sourceLine, lineCount));
  const docLine = view.state.doc.line(targetLine);
  const lineText = docLine.text;

  // Find column within the line using word/context matching (in stripped space)
  const strippedColumn = findColumnInLine(lineText, cursorInfo);

  // Map column from stripped text back to original line
  // Only leading markers (heading #, list -, blockquote >) affect position mapping
  const markerLength = getLeadingMarkerLength(lineText);
  const finalColumn = Math.min(strippedColumn + markerLength, lineText.length);

  const pos = Math.min(docLine.from + finalColumn, docLine.to);

  view.dispatch({
    selection: { anchor: pos },
    scrollIntoView: true,
  });
}

/**
 * Get the length of leading markdown markers (heading #, list -, blockquote >).
 * These are the only markers that affect position mapping.
 */
function getLeadingMarkerLength(lineText: string): number {
  // Check heading markers: # ## ### etc
  const headingMatch = lineText.match(/^(#{1,6})\s+/);
  if (headingMatch) {
    return headingMatch[0].length;
  }

  // Check list markers: - * + or numbered (with optional leading whitespace)
  const listMatch = lineText.match(/^(\s*)([-*+]|\d+\.)\s+/);
  if (listMatch) {
    return listMatch[0].length;
  }

  // Check blockquote markers: > (can be nested)
  const quoteMatch = lineText.match(/^(>\s*)+/);
  if (quoteMatch) {
    return quoteMatch[0].length;
  }

  return 0;
}

/**
 * Find the best column position in a line using word/context matching.
 */
function findColumnInLine(lineText: string, cursorInfo: CursorInfo): number {
  const { text: strippedText } = stripMarkdownSyntax(lineText, 0);

  // Strategy 1: Context match
  const pattern = cursorInfo.contextBefore + cursorInfo.contextAfter;
  if (pattern.length >= MIN_CONTEXT_PATTERN_LENGTH) {
    const idx = strippedText.indexOf(pattern);
    if (idx !== -1) {
      return idx + cursorInfo.contextBefore.length;
    }
  }

  // Strategy 2: Word match
  if (cursorInfo.wordAtCursor) {
    const idx = strippedText.indexOf(cursorInfo.wordAtCursor);
    if (idx !== -1) {
      return idx + cursorInfo.offsetInWord;
    }
  }

  // Strategy 3: Percentage fallback
  return Math.round(cursorInfo.percentInLine * strippedText.length);
}
