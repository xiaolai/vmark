/**
 * Cursor Context Computation for Source Mode
 *
 * Computes the full cursor context by calling all detection functions.
 * Called on every selection change, result is cached in store.
 */

import type { EditorView } from "@codemirror/view";
import type {
  CursorContext,
  CodeBlockContext,
  TableContext,
  ListContext,
  BlockquoteContext,
  HeadingContext,
  LinkContext,
  ImageContext,
  InlineMathContext,
  FootnoteContext,
  FormattedRangeContext,
} from "@/types/cursorContext";
import type { FormatType } from "./formatActions";
import { getCodeFenceInfo } from "./codeFenceDetection";
import { getBlockMathInfo } from "./blockMathDetection";
import { getSourceTableInfo } from "./tableDetection";
import { getListItemInfo } from "./listDetection";
import { getBlockquoteInfo } from "./blockquoteDetection";
import { getHeadingInfo } from "./headingDetection";
import { getInlineElementAtCursor } from "./inlineDetection";
import { getFormattedRangeAtCursor } from "./formatRangeDetection";
import { getWordAtCursor } from "./wordSelection";
import { isAtParagraphLineStart } from "./paragraphDetection";
import { getContextModeSource } from "./positionUtils";

/**
 * Check if cursor is at a blank line (empty or whitespace only).
 */
function isAtBlankLine(view: EditorView): boolean {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  return line.text.trim() === "";
}

/**
 * Check if cursor is adjacent to whitespace.
 */
function isNearSpace(view: EditorView): boolean {
  const { from } = view.state.selection.main;
  const doc = view.state.doc;

  // Check character before cursor
  if (from > 0) {
    const charBefore = doc.sliceString(from - 1, from);
    if (/\s/.test(charBefore)) return true;
  }

  // Check character after cursor
  if (from < doc.length) {
    const charAfter = doc.sliceString(from, from + 1);
    if (/\s/.test(charAfter)) return true;
  }

  return false;
}

/**
 * Check if cursor is adjacent to punctuation (including CJK).
 */
function isNearPunctuation(view: EditorView): boolean {
  const { from } = view.state.selection.main;
  const doc = view.state.doc;

  // ASCII and CJK punctuation
  const punctuationRegex = /[\p{P}]/u;

  // Check character before cursor
  if (from > 0) {
    const charBefore = doc.sliceString(from - 1, from);
    if (punctuationRegex.test(charBefore)) return true;
  }

  // Check character after cursor
  if (from < doc.length) {
    const charAfter = doc.sliceString(from, from + 1);
    if (punctuationRegex.test(charAfter)) return true;
  }

  return false;
}

/**
 * Get all formatted ranges containing the cursor (for nested formats).
 * Returns empty array if not in any formatted range.
 */
function getAllFormattedRanges(view: EditorView): FormattedRangeContext[] {
  // For now, just return the innermost. Can be extended for nested detection.
  const innermost = getFormattedRangeAtCursor(view);
  if (!innermost) return [];

  return [
    {
      type: innermost.type,
      from: innermost.from,
      to: innermost.to,
      contentFrom: innermost.contentFrom,
      contentTo: innermost.contentTo,
    },
  ];
}

/**
 * Get active format types from format ranges.
 */
function getActiveFormats(ranges: FormattedRangeContext[]): FormatType[] {
  return ranges.map((r) => r.type);
}

/**
 * Convert CodeFenceInfo to CodeBlockContext.
 */
function toCodeBlockContext(
  info: ReturnType<typeof getCodeFenceInfo>
): CodeBlockContext | null {
  if (!info) return null;
  return {
    language: info.language,
    nodePos: info.fenceStartPos,
  };
}

/**
 * Convert SourceTableInfo to TableContext.
 */
function toTableContext(
  info: ReturnType<typeof getSourceTableInfo>
): TableContext | null {
  if (!info) return null;
  return {
    row: info.rowIndex,
    col: info.colIndex,
    isHeader: info.rowIndex === 0,
    nodePos: info.start,
  };
}

/**
 * Convert ListItemInfo to ListContext.
 */
function toListContext(
  info: ReturnType<typeof getListItemInfo>
): ListContext | null {
  if (!info) return null;
  return {
    type: info.type,
    depth: info.indent + 1, // Convert 0-based to 1-based
    nodePos: info.lineStart,
  };
}

/**
 * Convert BlockquoteInfo to BlockquoteContext.
 */
function toBlockquoteContext(
  info: ReturnType<typeof getBlockquoteInfo>
): BlockquoteContext | null {
  if (!info) return null;
  return {
    depth: info.level,
    nodePos: info.from,
  };
}

/**
 * Convert HeadingInfo to HeadingContext.
 */
function toHeadingContext(
  info: ReturnType<typeof getHeadingInfo>
): HeadingContext | null {
  if (!info) return null;
  return {
    level: info.level,
    nodePos: info.lineStart,
  };
}

/**
 * Compute full cursor context for source mode.
 * Called on every selection change.
 */
export function computeSourceCursorContext(view: EditorView): CursorContext {
  const { from, to } = view.state.selection.main;
  const hasSelection = from !== to;

  // Block contexts
  const codeFence = getCodeFenceInfo(view);
  const blockMath = getBlockMathInfo(view);
  const table = getSourceTableInfo(view);
  const list = getListItemInfo(view);
  const blockquote = getBlockquoteInfo(view);
  const heading = getHeadingInfo(view);

  // Inline context
  const inlineElement = getInlineElementAtCursor(view);

  // Format ranges
  const formatRanges = getAllFormattedRanges(view);
  const innermostFormat = formatRanges[0] ?? null;
  const activeFormats = getActiveFormats(formatRanges);

  // Position helpers
  const atLineStart = isAtParagraphLineStart(view);
  const atBlankLine = isAtBlankLine(view);
  const wordRange = getWordAtCursor(view);
  const contextMode = getContextModeSource(view);

  // Boundary detection
  const nearSpace = isNearSpace(view);
  const nearPunctuation = isNearPunctuation(view);

  // Build inline context based on type
  let inLink: LinkContext | null = null;
  let inImage: ImageContext | null = null;
  let inInlineMath: InlineMathContext | null = null;
  let inFootnote: FootnoteContext | null = null;

  if (inlineElement) {
    switch (inlineElement.type) {
      case "link":
        inLink = {
          href: "", // Would need to parse from content
          text: view.state.doc.sliceString(
            inlineElement.contentFrom,
            inlineElement.contentTo
          ),
          from: inlineElement.from,
          to: inlineElement.to,
          contentFrom: inlineElement.contentFrom,
          contentTo: inlineElement.contentTo,
        };
        break;
      case "image":
        inImage = {
          src: "", // Would need to parse from content
          alt: view.state.doc.sliceString(
            inlineElement.contentFrom,
            inlineElement.contentTo
          ),
          from: inlineElement.from,
          to: inlineElement.to,
        };
        break;
      case "math":
        inInlineMath = {
          from: inlineElement.from,
          to: inlineElement.to,
          contentFrom: inlineElement.contentFrom,
          contentTo: inlineElement.contentTo,
        };
        break;
      case "footnote":
        inFootnote = {
          label: view.state.doc.sliceString(
            inlineElement.contentFrom,
            inlineElement.contentTo
          ),
          from: inlineElement.from,
          to: inlineElement.to,
          contentFrom: inlineElement.contentFrom,
          contentTo: inlineElement.contentTo,
        };
        break;
    }
  }

  return {
    // Block contexts
    inCodeBlock: toCodeBlockContext(codeFence),
    inBlockMath: blockMath ? { nodePos: blockMath.from } : null,
    inTable: toTableContext(table),
    inList: toListContext(list),
    inBlockquote: toBlockquoteContext(blockquote),
    inHeading: toHeadingContext(heading),

    // Inline contexts
    inLink,
    inImage,
    inInlineMath,
    inFootnote,

    // Format marks
    activeFormats,
    formatRanges,
    innermostFormat,

    // Position
    atLineStart,
    atBlankLine,
    inWord: wordRange,
    contextMode,

    // Boundaries
    nearSpace,
    nearPunctuation,

    // Selection state
    hasSelection,
    selectionFrom: from,
    selectionTo: to,
  };
}
