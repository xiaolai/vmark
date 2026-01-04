/**
 * Cursor Context Computation for Milkdown Mode
 *
 * Computes the full cursor context by walking the ProseMirror document tree.
 * Called on every selection change, result is cached in store.
 */

import type { EditorView } from "@milkdown/kit/prose/view";
import type {
  CursorContext,
  CodeBlockContext,
  TableContext,
  ListContext,
  BlockquoteContext,
  HeadingContext,
  ContextMode,
} from "@/types/cursorContext";
import type { FormatType } from "@/plugins/sourceFormatPopup/formatActions";
import { findWordAtCursor } from "@/plugins/syntaxReveal/marks";

/**
 * Get code block info if cursor is inside a code block node.
 */
function getCodeBlockContext(view: EditorView): CodeBlockContext | null {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "code_block" || node.type.name === "fence") {
      return {
        language: node.attrs.language || "",
        nodePos: $from.before(d),
      };
    }
  }
  return null;
}

/**
 * Get heading info if cursor is inside a heading node.
 */
function getHeadingContext(view: EditorView): HeadingContext | null {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "heading") {
      return {
        level: node.attrs.level || 1,
        nodePos: $from.before(d),
      };
    }
  }
  return null;
}

/**
 * Get list context if cursor is inside a list.
 */
function getListContext(view: EditorView): ListContext | null {
  const { $from } = view.state.selection;
  let depth = 0;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    const name = node.type.name;

    if (name === "bullet_list") {
      return {
        type: "bullet",
        depth: depth + 1,
        nodePos: $from.before(d),
      };
    }
    if (name === "ordered_list") {
      return {
        type: "ordered",
        depth: depth + 1,
        nodePos: $from.before(d),
      };
    }
    if (name === "task_list_item" || name === "list_item") {
      depth++;
    }
  }
  return null;
}

/**
 * Get blockquote context if cursor is inside a blockquote.
 */
function getBlockquoteContext(view: EditorView): BlockquoteContext | null {
  const { $from } = view.state.selection;
  let depth = 0;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "blockquote") {
      depth++;
      return {
        depth,
        nodePos: $from.before(d),
      };
    }
  }
  return null;
}

/**
 * Get table context if cursor is inside a table.
 */
function getTableContext(view: EditorView): TableContext | null {
  const { $from } = view.state.selection;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    const name = node.type.name;

    if (name === "table_cell" || name === "table_header") {
      // Find parent table row and table
      for (let td = d - 1; td > 0; td--) {
        const parent = $from.node(td);
        if (parent.type.name === "table_row") {
          // Count row and col index
          const rowPos = $from.before(td);
          const tablePos = $from.before(td - 1);
          const table = $from.node(td - 1);

          let row = 0;
          let col = 0;

          // Count rows before current
          table.forEach((_child, offset) => {
            if (tablePos + offset + 1 < rowPos) row++;
          });

          // Count cells before current in this row
          const currentRow = parent;
          const cellPos = $from.before(d);
          currentRow.forEach((_cell, offset) => {
            if (rowPos + offset + 1 < cellPos) col++;
          });

          return {
            row,
            col,
            isHeader: name === "table_header" || row === 0,
            nodePos: tablePos,
          };
        }
      }
    }
  }
  return null;
}

/**
 * Check if cursor is at a blank line.
 */
function isAtBlankLine(view: EditorView): boolean {
  const { $from } = view.state.selection;
  return $from.parent.textContent.trim() === "";
}

/**
 * Check if cursor is at the start of a paragraph.
 */
function isAtLineStart(view: EditorView): boolean {
  const { $from } = view.state.selection;

  if ($from.parentOffset !== 0) {
    const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
    if (textBefore.trim() !== "") return false;
  }

  if ($from.parent.type.name !== "paragraph") return false;
  if ($from.parent.textContent.trim() === "") return false;

  // Not in special containers
  for (let d = $from.depth - 1; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (
      name === "list_item" ||
      name === "bullet_list" ||
      name === "ordered_list" ||
      name === "blockquote" ||
      name === "table_cell" ||
      name === "table_header" ||
      name === "code_block" ||
      name === "fence"
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Check if cursor is near whitespace.
 */
function isNearSpace(view: EditorView): boolean {
  const { $from } = view.state.selection;
  const text = $from.parent.textContent;
  const offset = $from.parentOffset;

  if (offset > 0 && /\s/.test(text[offset - 1])) return true;
  if (offset < text.length && /\s/.test(text[offset])) return true;

  return false;
}

/**
 * Check if cursor is near punctuation.
 */
function isNearPunctuation(view: EditorView): boolean {
  const { $from } = view.state.selection;
  const text = $from.parent.textContent;
  const offset = $from.parentOffset;
  const punctuationRegex = /[\p{P}]/u;

  if (offset > 0 && punctuationRegex.test(text[offset - 1])) return true;
  if (offset < text.length && punctuationRegex.test(text[offset])) return true;

  return false;
}

/**
 * Determine context mode.
 */
function getContextMode(view: EditorView): ContextMode {
  const { empty, $from } = view.state.selection;

  if (!empty) return "format";

  const wordRange = findWordAtCursor($from);
  if (wordRange) return "format";

  const atStart = $from.parentOffset === 0;
  const isEmpty = $from.parent.textContent.trim() === "";

  if (atStart && isEmpty) return "block-insert";

  return "inline-insert";
}

/**
 * Get active format marks at cursor.
 */
function getActiveFormats(view: EditorView): FormatType[] {
  const { $from } = view.state.selection;
  const marks = $from.marks();
  const formats: FormatType[] = [];

  for (const mark of marks) {
    switch (mark.type.name) {
      case "strong":
        formats.push("bold");
        break;
      case "emphasis":
      case "em":
        formats.push("italic");
        break;
      case "code_inline":
      case "code":
        formats.push("code");
        break;
      case "strike":
      case "strikethrough":
        formats.push("strikethrough");
        break;
      case "highlight":
        formats.push("highlight");
        break;
      case "link":
        formats.push("link");
        break;
      case "superscript":
        formats.push("superscript");
        break;
      case "subscript":
        formats.push("subscript");
        break;
    }
  }

  return formats;
}

/**
 * Compute full cursor context for Milkdown mode.
 */
export function computeMilkdownCursorContext(view: EditorView): CursorContext {
  const { from, to, empty } = view.state.selection;
  const $from = view.state.selection.$from;

  // Block contexts
  const inCodeBlock = getCodeBlockContext(view);
  const inHeading = getHeadingContext(view);
  const inList = getListContext(view);
  const inBlockquote = getBlockquoteContext(view);
  const inTable = getTableContext(view);

  // Format marks
  const activeFormats = getActiveFormats(view);

  // Position
  const atLineStart = isAtLineStart(view);
  const atBlankLine = isAtBlankLine(view);
  const wordRange = findWordAtCursor($from);
  const contextMode = getContextMode(view);

  // Boundaries
  const nearSpace = isNearSpace(view);
  const nearPunctuation = isNearPunctuation(view);

  return {
    // Block contexts
    inCodeBlock,
    inBlockMath: null, // Not implemented for Milkdown yet
    inTable,
    inList,
    inBlockquote,
    inHeading,

    // Inline contexts (not yet implemented for Milkdown)
    inLink: null,
    inImage: null,
    inInlineMath: null,
    inFootnote: null,

    // Format marks
    activeFormats,
    formatRanges: [], // Not applicable for ProseMirror (marks are stored in AST)
    innermostFormat: null,

    // Position
    atLineStart,
    atBlankLine,
    inWord: wordRange,
    contextMode,

    // Boundaries
    nearSpace,
    nearPunctuation,

    // Selection state
    hasSelection: !empty,
    selectionFrom: from,
    selectionTo: to,
  };
}
