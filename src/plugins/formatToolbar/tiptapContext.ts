/**
 * Tiptap Context Extraction
 *
 * Extracts CursorContext from Tiptap/ProseMirror state for use with
 * the shared toolbar intent resolver. Pure function - no side effects.
 */

import type { EditorState } from "@tiptap/pm/state";
import type { ResolvedPos } from "@tiptap/pm/model";
import type { CursorContext } from "@/plugins/toolbarContext/types";

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

/**
 * Detect marks (link, bold, italic, etc.) at cursor position.
 */
function detectMarksAtCursor($from: ResolvedPos, ctx: CursorContext): void {
  const marks = $from.marks();

  for (const mark of marks) {
    // Link mark
    if (mark.type.name === "link" && !ctx.inLink) {
      const range = findMarkRange($from, mark.type);
      if (range) {
        ctx.inLink = {
          href: mark.attrs.href || "",
          text: "",
          from: range.from,
          to: range.to,
          contentFrom: range.from,
          contentTo: range.to,
        };
      }
      continue;
    }

    // Other formatting marks (bold, italic, etc.)
    if (!ctx.inFormattedRange && !ctx.inLink) {
      const range = findMarkRange($from, mark.type);
      if (range) {
        ctx.inFormattedRange = {
          markType: mark.type.name,
          from: range.from,
          to: range.to,
          contentFrom: range.from,
          contentTo: range.to,
        };
      }
    }
  }
}

/**
 * Find the range of a mark at position.
 */
function findMarkRange(
  $pos: ResolvedPos,
  markType: { name: string }
): { from: number; to: number } | null {
  const { parent, parentOffset } = $pos;

  // Calculate base position
  const basePos = $pos.pos - parentOffset;

  // Walk through parent's children to find exact mark boundaries
  let markFrom = -1;
  let markTo = -1;

  parent.forEach((child, childOffset) => {
    const childFrom = basePos + childOffset;
    const childTo = childFrom + child.nodeSize;

    if (child.isText) {
      const hasMark = child.marks.some((m) => m.type.name === markType.name);
      if (hasMark) {
        if (markFrom === -1) markFrom = childFrom;
        markTo = childTo;
      } else if (markFrom !== -1) {
        // Mark ended - check if we found the cursor's range
        if ($pos.pos >= markFrom && $pos.pos <= markTo) {
          return; // Found our range, stop iterating
        }
        markFrom = -1;
        markTo = -1;
      }
    }
  });

  // Check if cursor is within the found range
  if (markFrom !== -1 && $pos.pos >= markFrom && $pos.pos <= markTo) {
    return { from: markFrom, to: markTo };
  }

  return null;
}

/**
 * Check if cursor is at paragraph line start.
 */
function isAtLineStart($from: ResolvedPos): boolean {
  // Must be at start of parent content
  if ($from.parentOffset !== 0) {
    // Check if only whitespace before cursor
    const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
    if (textBefore.trim() !== "") {
      return false;
    }
  }

  // Must be in a paragraph
  if ($from.parent.type.name !== "paragraph") {
    return false;
  }

  // Paragraph must have content
  if ($from.parent.textContent.trim() === "") {
    return false;
  }

  return true;
}

/**
 * Find word at cursor position.
 */
function findWordAtPos($from: ResolvedPos): { from: number; to: number } | null {
  const { parent, parentOffset } = $from;
  const text = parent.textContent;

  if (!text || parentOffset >= text.length) {
    return null;
  }

  // Word boundary regex
  const wordChars = /[\w\u00C0-\u024F\u1E00-\u1EFF]/;

  // Find word boundaries
  let start = parentOffset;
  let end = parentOffset;

  // Expand backwards
  while (start > 0 && wordChars.test(text[start - 1])) {
    start--;
  }

  // Expand forwards
  while (end < text.length && wordChars.test(text[end])) {
    end++;
  }

  // Must have at least one character
  if (start === end) {
    return null;
  }

  const basePos = $from.pos - parentOffset;
  return { from: basePos + start, to: basePos + end };
}

/**
 * Determine context mode for insert fallback.
 */
function determineContextMode($from: ResolvedPos, empty: boolean): "insert" | "insert-block" {
  if (!empty) return "insert";

  const parent = $from.parent;
  const atStart = $from.parentOffset === 0;
  const isEmpty = parent.textContent.trim() === "";

  if (atStart && isEmpty) {
    return "insert-block";
  }

  return "insert";
}
