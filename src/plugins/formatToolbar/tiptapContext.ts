/**
 * Tiptap Context Extraction
 *
 * Purpose: Extracts CursorContext from Tiptap/ProseMirror state for use with the shared
 * toolbar intent resolver. Pure function — reads state, produces context, no side effects.
 *
 * Pipeline: EditorState → extractTiptapContext() → CursorContext → resolveToolbarIntent()
 *
 * @coordinates-with tiptapContextHelpers.ts — helper functions for mark/position detection
 * @coordinates-with toolbarContext/types.ts — CursorContext type definition
 * @coordinates-with toolbarContext/toolbarIntent.ts — consumes CursorContext to resolve toolbar state
 * @module plugins/formatToolbar/tiptapContext
 */

import type { EditorState } from "@tiptap/pm/state";
import type { CursorContext } from "@/plugins/toolbarContext/types";
import {
  detectMarksAtCursor,
  isAtLineStart,
  findWordAtPos,
  determineContextMode,
} from "./tiptapContextHelpers";

/**
 * Extract cursor context from Tiptap editor state.
 * Produces a CursorContext compatible with resolveToolbarIntent().
 *
 * @param state - ProseMirror editor state
 * @returns CursorContext for intent resolution
 */
export function extractTiptapContext(state: EditorState): CursorContext {
  const { selection } = state;
  const { $from, from, to, empty } = selection;

  const ctx: CursorContext = {
    hasSelection: !empty,
    atLineStart: false,
    contextMode: "insert",
    surface: "wysiwyg",
  };

  // Extract selection info if there's a selection
  if (!empty) {
    ctx.selectionInfo = {
      from,
      to,
      text: state.doc.textBetween(from, to),
    };
  }

  // Walk up the node tree to detect block contexts
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    const typeName = node.type.name;

    // Code block (highest priority)
    if (typeName === "codeBlock" && !ctx.inCodeBlock) {
      ctx.inCodeBlock = {
        language: node.attrs.language || "",
        from: $from.before(d),
        to: $from.after(d),
      };
      continue;
    }

    // Table
    if (typeName === "table" && !ctx.inTable) {
      const numRows = node.childCount;
      const numCols = numRows > 0 ? node.child(0).childCount : 0;
      const rowIndex = $from.depth > d ? $from.index(d) : 0;
      const colIndex = $from.depth > d + 1 ? $from.index(d + 1) : 0;

      ctx.inTable = {
        row: rowIndex,
        col: colIndex,
        totalRows: numRows,
        totalCols: numCols,
      };
      continue;
    }

    // Lists
    if ((typeName === "bulletList" || typeName === "orderedList") && !ctx.inList) {
      let depth = 0;
      for (let dd = 1; dd < d; dd++) {
        const ancestorName = $from.node(dd).type.name;
        if (ancestorName === "bulletList" || ancestorName === "orderedList") {
          depth++;
        }
      }

      ctx.inList = {
        listType: typeName === "orderedList" ? "ordered" : "bullet",
        depth,
      };
      continue;
    }

    // Blockquote
    if (typeName === "blockquote" && !ctx.inBlockquote) {
      let depth = 0;
      for (let dd = 1; dd <= d; dd++) {
        if ($from.node(dd).type.name === "blockquote") {
          depth++;
        }
      }

      ctx.inBlockquote = { depth };
      continue;
    }

    // Heading
    if (typeName === "heading" && !ctx.inHeading) {
      ctx.inHeading = {
        level: node.attrs.level || 1,
        nodePos: $from.before(d),
      };
      continue;
    }
  }

  // Detect marks at cursor position (link, bold, etc.)
  if (empty) {
    detectMarksAtCursor($from, ctx);
  }

  // Detect line start (only if not in special blocks)
  if (!ctx.inCodeBlock && !ctx.inTable && !ctx.inList && !ctx.inBlockquote && !ctx.inHeading) {
    ctx.atLineStart = isAtLineStart($from);
  }

  // Detect word at cursor
  if (empty && !ctx.inCodeBlock && !ctx.inFormattedRange && !ctx.inLink) {
    const wordRange = findWordAtPos($from);
    if (wordRange) {
      ctx.inWord = {
        from: wordRange.from,
        to: wordRange.to,
        text: state.doc.textBetween(wordRange.from, wordRange.to),
      };
    }
  }

  // Determine context mode for insert fallback
  ctx.contextMode = determineContextMode($from, empty);

  return ctx;
}
