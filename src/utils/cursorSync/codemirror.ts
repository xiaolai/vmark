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
 * @coordinates-with cursorSync/fenceIndex.ts — which code block a line is in
 * @coordinates-with cursorSync/pmHelpers.ts — the column matcher both editors share
 * @module utils/cursorSync/codemirror
 */

import type { EditorView } from "@codemirror/view";
import type { CursorInfo, BlockAnchor } from "@/types/cursorSync";
import { detectNodeType, stripMarkdownSyntax } from "./markdown";
import { extractCursorContext } from "./matching";
import { findColumnInLine } from "./pmHelpers";
import { getTableAnchorForLine, restoreTableColumnFromAnchor } from "./table";
import { fenceStartLineAt } from "./fenceIndex";

/**
 * Code block anchor for a line inside the block opened at `fenceLine`
 * (both 1-indexed): the line within the block and the column.
 */
function getCodeBlockAnchor(fenceLine: number, sourceLine: number, column: number): BlockAnchor {
  // Line within code block (0-based, first content line is 0). The fence line
  // itself is line -1, which anchors to the start of the first content line.
  const rawLineInBlock = sourceLine - fenceLine - 1;
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
 *
 * Runs on every keystroke and cursor move, so it reads the cursor's line and
 * its table neighbours through the document's line API and never joins the
 * document into a string.
 */
export function getCursorInfoFromCodeMirror(view: EditorView): CursorInfo {
  const { doc } = view.state;
  const pos = view.state.selection.main.head;
  const line = doc.lineAt(pos);
  const column = pos - line.from;
  const lineText = line.text;

  // Source line number (1-indexed, matches remark parser)
  const sourceLine = line.number;

  // Detect node type
  let nodeType = detectNodeType(lineText);

  // Check if inside code block and get block anchor
  let blockAnchor: BlockAnchor | undefined;
  const fenceLine = fenceStartLineAt(view.state, sourceLine);
  if (fenceLine !== null) {
    nodeType = "code_block";
    blockAnchor = getCodeBlockAnchor(fenceLine, sourceLine, column);
  } else {
    const lines = { length: doc.lines, at: (index: number) => doc.line(index + 1).text };
    const tableAnchor = getTableAnchorForLine(lines, sourceLine - 1, column);
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
 * Restore cursor in code block using block anchor coordinates.
 */
function restoreCursorInCodeBlockSource(
  view: EditorView,
  sourceLine: number,
  anchor: { lineInBlock: number; columnInLine: number },
  scrollIntoView: boolean,
): boolean {
  // Find the code block start
  const fenceStartLine = fenceStartLineAt(view.state, sourceLine);
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
    scrollIntoView,
  });

  return true;
}

/**
 * Restore cursor in a table row using block anchor coordinates.
 */
function restoreCursorInTableSource(
  view: EditorView,
  sourceLine: number,
  anchor: { col: number; offsetInCell: number },
  scrollIntoView: boolean,
): boolean {
  const lineCount = view.state.doc.lines;
  const targetLine = Math.max(1, Math.min(sourceLine, lineCount));
  const docLine = view.state.doc.line(targetLine);

  const column = restoreTableColumnFromAnchor(docLine.text, anchor);
  if (column === null) return false;

  const pos = docLine.from + column;

  view.dispatch({
    selection: { anchor: pos },
    scrollIntoView,
  });

  return true;
}

/**
 * Restore cursor position in CodeMirror from cursor info.
 * Uses sourceLine for direct line lookup - much simpler and more accurate.
 * Uses block anchors for precise positioning in code blocks and tables.
 * `scrollIntoView = false` places the caret without moving the viewport, for a
 * restore whose reading position is put back separately (#1556).
 */
export function restoreCursorInCodeMirror(
  view: EditorView,
  cursorInfo: CursorInfo,
  scrollIntoView = true,
): void {
  const { sourceLine, blockAnchor } = cursorInfo;

  // Try block-specific restoration for code blocks and tables
  if (blockAnchor) {
    /* v8 ignore next -- @preserve reason: false branch ("table" anchor kind) not exercised in cursor sync tests */
    if (blockAnchor.kind === "code") {
      if (restoreCursorInCodeBlockSource(view, sourceLine, blockAnchor, scrollIntoView)) {
        return;
      }
    /* v8 ignore start -- @preserve "table" block anchor kind not reached in tests */
    } else if (blockAnchor.kind === "table") {
      if (restoreCursorInTableSource(view, sourceLine, blockAnchor, scrollIntoView)) {
        return;
      }
    }
    /* v8 ignore stop */
  }

  // Fall back to generic restoration
  // Clamp to valid line range
  const lineCount = view.state.doc.lines;
  const targetLine = Math.max(1, Math.min(sourceLine, lineCount));
  const docLine = view.state.doc.line(targetLine);
  const lineText = docLine.text;

  // Find column within the line using word/context matching (in stripped space)
  const { text: strippedText } = stripMarkdownSyntax(lineText, lineText.length);
  const strippedColumn = findColumnInLine(strippedText, cursorInfo);

  // Map column from stripped text back to original line
  // Only leading markers (heading #, list -, blockquote >) affect position mapping
  const markerLength = getLeadingMarkerLength(lineText);
  const finalColumn = Math.min(strippedColumn + markerLength, lineText.length);

  const pos = Math.min(docLine.from + finalColumn, docLine.to);

  view.dispatch({
    selection: { anchor: pos },
    scrollIntoView,
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

  let total = 0;
  let text = lineText;

  // Check blockquote markers first (before list) so nested `> - item` accumulates both
  const quoteMatch = text.match(/^(>\s*)+/);
  if (quoteMatch) {
    total += quoteMatch[0].length;
    text = text.slice(quoteMatch[0].length);
  }

  // Check list markers: - * + or numbered (with optional leading whitespace)
  const listMatch = text.match(/^(\s*)([-*+]|\d+\.)\s+/);
  if (listMatch) {
    total += listMatch[0].length;
  }

  return total;
}
