/**
 * Shared Toolbar Intent Resolver
 *
 * Maps cursor context → toolbar intent using a unified priority order.
 * Used by both WYSIWYG (Tiptap) and Source (CodeMirror) for consistent behavior.
 *
 * Priority order (canonical):
 * 1. Code block
 * 2. Block math (source only)
 * 3. Table
 * 4. List
 * 5. Blockquote
 * 6. Selection (user-made)
 * 7. Formatted range (auto-select)
 * 8. Link → opens link popup in WYSIWYG, format in source
 * 9. Image → none (has own popup)
 * 10. Inline math
 * 11. Footnote
 * 12. Heading
 * 13. Line start → heading toolbar (level 0 = paragraph)
 * 14. Word (auto-select)
 * 15. Insert (fallback)
 */

import type { CursorContext, ToolbarIntent } from "./types";

/**
 * Resolve toolbar intent from cursor context.
 * Pure function - no side effects, no store access.
 *
 * @param ctx - Cursor context from surface adapter
 * @returns Toolbar intent describing what UI to show
 */
export function resolveToolbarIntent(ctx: CursorContext): ToolbarIntent {
  // 1. Code block (highest priority)
  if (ctx.inCodeBlock) {
    return { type: "code", info: ctx.inCodeBlock };
  }

  // 2. Block math (source mode only)
  if (ctx.surface === "source" && ctx.inBlockMath) {
    return { type: "blockMath", info: ctx.inBlockMath };
  }

  // 3. Table
  if (ctx.inTable) {
    return { type: "table", info: ctx.inTable };
  }

  // 4. List
  if (ctx.inList) {
    return { type: "list", info: ctx.inList };
  }

  // 5. Blockquote
  if (ctx.inBlockquote) {
    return { type: "blockquote", info: ctx.inBlockquote };
  }

  // 6. User selection (not auto-selected)
  if (ctx.hasSelection && ctx.selectionInfo) {
    return {
      type: "format",
      selection: ctx.selectionInfo,
      autoSelected: false,
    };
  }

  // 7. Formatted range (auto-select content)
  if (ctx.inFormattedRange) {
    return {
      type: "format",
      selection: {
        from: ctx.inFormattedRange.contentFrom,
        to: ctx.inFormattedRange.contentTo,
        text: "", // Will be filled by caller
      },
      autoSelected: true,
    };
  }

  // 8. Link
  if (ctx.inLink) {
    // WYSIWYG: open link popup
    if (ctx.surface === "wysiwyg") {
      return { type: "link", info: ctx.inLink };
    }
    // Source: auto-select content and show format toolbar
    return {
      type: "format",
      selection: {
        from: ctx.inLink.contentFrom,
        to: ctx.inLink.contentTo,
        text: ctx.inLink.text,
      },
      autoSelected: true,
    };
  }

  // 9. Image → none (has own popup in both surfaces)
  if (ctx.inImage) {
    return { type: "none" };
  }

  // 10. Inline math
  if (ctx.inInlineMath) {
    return { type: "inlineMath", info: ctx.inInlineMath };
  }

  // 11. Footnote
  if (ctx.inFootnote) {
    return { type: "footnote", info: ctx.inFootnote };
  }

  // 12. Heading
  if (ctx.inHeading) {
    return { type: "heading", info: ctx.inHeading };
  }

  // 13. Line start → heading toolbar (level 0 = paragraph)
  if (ctx.atLineStart) {
    return { type: "heading", info: { level: 0 } };
  }

  // 14. Word (auto-select)
  if (ctx.inWord) {
    return {
      type: "format",
      selection: {
        from: ctx.inWord.from,
        to: ctx.inWord.to,
        text: ctx.inWord.text,
      },
      autoSelected: true,
    };
  }

  // 15. Insert (fallback)
  return { type: "insert", contextMode: ctx.contextMode };
}
