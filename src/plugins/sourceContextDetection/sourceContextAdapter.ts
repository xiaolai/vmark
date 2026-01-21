/**
 * Source Context Adapter
 *
 * Adapts source mode CursorContext to the shared toolbar intent resolver types.
 * Enables source mode to use the unified routing logic.
 */

import type { CursorContext as SourceCursorContext } from "@/types/cursorContext";
import type { CursorContext as SharedCursorContext, ToolbarIntent } from "@/plugins/toolbarContext/types";
import { resolveToolbarIntent } from "@/plugins/toolbarContext";

/**
 * Adapt source mode cursor context to shared cursor context.
 *
 * @param sourceCtx - Source mode cursor context
 * @returns Shared cursor context compatible with resolveToolbarIntent()
 */
export function adaptSourceContext(sourceCtx: SourceCursorContext): SharedCursorContext {
  const ctx: SharedCursorContext = {
    surface: "source",
    hasSelection: sourceCtx.hasSelection,
    atLineStart: sourceCtx.atLineStart,
    contextMode: adaptContextMode(sourceCtx.contextMode),
  };

  // Code block
  if (sourceCtx.inCodeBlock) {
    ctx.inCodeBlock = {
      language: sourceCtx.inCodeBlock.language,
      from: sourceCtx.inCodeBlock.nodePos,
      to: sourceCtx.inCodeBlock.nodePos, // Source mode doesn't track end
    };
  }

  // Block math (source mode only)
  if (sourceCtx.inBlockMath) {
    ctx.inBlockMath = {
      from: sourceCtx.inBlockMath.nodePos,
      to: sourceCtx.inBlockMath.nodePos,
    };
  }

  // Table
  if (sourceCtx.inTable) {
    ctx.inTable = {
      row: sourceCtx.inTable.row,
      col: sourceCtx.inTable.col,
      totalRows: 0, // Source mode doesn't track totals
      totalCols: 0,
    };
  }

  // List
  if (sourceCtx.inList) {
    ctx.inList = {
      listType: sourceCtx.inList.type,
      depth: sourceCtx.inList.depth,
    };
  }

  // Blockquote
  if (sourceCtx.inBlockquote) {
    ctx.inBlockquote = {
      depth: sourceCtx.inBlockquote.depth,
    };
  }

  // Selection
  if (sourceCtx.hasSelection) {
    ctx.selectionInfo = {
      from: sourceCtx.selectionFrom,
      to: sourceCtx.selectionTo,
      text: "", // Text not available without EditorView
    };
  }

  // Formatted range (innermost)
  if (sourceCtx.innermostFormat) {
    ctx.inFormattedRange = {
      markType: sourceCtx.innermostFormat.type,
      from: sourceCtx.innermostFormat.from,
      to: sourceCtx.innermostFormat.to,
      contentFrom: sourceCtx.innermostFormat.contentFrom,
      contentTo: sourceCtx.innermostFormat.contentTo,
    };
  }

  // Link
  if (sourceCtx.inLink) {
    ctx.inLink = {
      href: sourceCtx.inLink.href,
      text: sourceCtx.inLink.text,
      from: sourceCtx.inLink.from,
      to: sourceCtx.inLink.to,
      contentFrom: sourceCtx.inLink.contentFrom,
      contentTo: sourceCtx.inLink.contentTo,
    };
  }

  // Image
  if (sourceCtx.inImage) {
    ctx.inImage = {
      src: sourceCtx.inImage.src,
      alt: sourceCtx.inImage.alt,
      from: sourceCtx.inImage.from,
      to: sourceCtx.inImage.to,
    };
  }

  // Inline math
  if (sourceCtx.inInlineMath) {
    ctx.inInlineMath = {
      from: sourceCtx.inInlineMath.from,
      to: sourceCtx.inInlineMath.to,
      contentFrom: sourceCtx.inInlineMath.contentFrom,
      contentTo: sourceCtx.inInlineMath.contentTo,
    };
  }

  // Footnote
  if (sourceCtx.inFootnote) {
    ctx.inFootnote = {
      label: sourceCtx.inFootnote.label,
      from: sourceCtx.inFootnote.from,
      to: sourceCtx.inFootnote.to,
      contentFrom: sourceCtx.inFootnote.contentFrom,
      contentTo: sourceCtx.inFootnote.contentTo,
    };
  }

  // Heading
  if (sourceCtx.inHeading) {
    ctx.inHeading = {
      level: sourceCtx.inHeading.level,
      lineStart: sourceCtx.inHeading.nodePos,
    };
  }

  // Word
  if (sourceCtx.inWord) {
    ctx.inWord = {
      from: sourceCtx.inWord.from,
      to: sourceCtx.inWord.to,
      text: "", // Text not available without EditorView
    };
  }

  return ctx;
}

/**
 * Adapt source context mode to shared context mode.
 */
function adaptContextMode(
  mode: "format" | "inline-insert" | "block-insert"
): "insert" | "insert-block" {
  switch (mode) {
    case "block-insert":
      return "insert-block";
    case "inline-insert":
    case "format":
    default:
      return "insert";
  }
}

/**
 * Route source context through the shared intent resolver.
 *
 * @param sourceCtx - Source mode cursor context
 * @returns Toolbar intent for the context
 */
export function routeSourceContext(sourceCtx: SourceCursorContext): ToolbarIntent {
  const sharedCtx = adaptSourceContext(sourceCtx);
  return resolveToolbarIntent(sharedCtx);
}
