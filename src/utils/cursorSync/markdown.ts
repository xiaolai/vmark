/**
 * Markdown Line Analysis
 *
 * Purpose: Classify markdown lines by node type and strip block-level syntax
 * to produce "rendered text" for cursor position matching.
 *
 * Key decisions:
 *   - Only strips leading block markers (headings, lists, blockquotes) — not inline formatting
 *   - Code fence tracking uses fence-type matching (``` vs ~~~) to avoid false toggles
 *
 * @coordinates-with cursorSync/codemirror.ts — calls these for source mode extraction
 * @module utils/cursorSync/markdown
 */

import type { NodeType } from "@/types/cursorSync";

/**
 * Detect node type from markdown line.
 * Handles standard markdown plus extended syntax (alerts, details, wiki links).
 */
export function detectNodeType(line: string): NodeType {
  const trimmed = line.trimStart();

  // Heading: # ## ### etc
  if (/^#{1,6}\s/.test(trimmed)) {
    return "heading";
  }

  // List item: - * + or numbered
  if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
    return "list_item";
  }

  // Code block fence
  if (/^```/.test(trimmed) || /^~~~/.test(trimmed)) {
    return "code_block";
  }

  // Alert block: > [!NOTE], > [!WARNING], etc.
  if (/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(trimmed)) {
    return "alert_block";
  }

  // Blockquote (check after alert to avoid false matches)
  if (/^>\s?/.test(trimmed)) {
    return "blockquote";
  }

  // Details block: ::: details or <details>
  if (/^:::\s*details/i.test(trimmed) || /^<details/i.test(trimmed)) {
    return "details_block";
  }

  // Table row: must start with | or have | with content on both sides
  // More strict than just "contains |" to avoid false positives in code/text
  if (/^\|/.test(trimmed) && /\|$/.test(trimmed)) {
    return "table_cell";
  }
  // Also match table rows that start with | but don't end with |
  if (/^\|[^|]+\|/.test(trimmed)) {
    return "table_cell";
  }

  // Wiki link on its own line: [[...]]
  if (/^\[\[[^\]]+\]\]$/.test(trimmed)) {
    return "wiki_link";
  }

  return "paragraph";
}

/**
 * Strip markdown syntax from line to get rendered text
 * Returns the stripped text and the offset adjustment
 */
export function stripMarkdownSyntax(
  line: string,
  column: number
): { text: string; adjustedColumn: number } {
  let text = line;
  let offset = 0;

  // Strip heading markers: # ## ### etc
  const headingMatch = text.match(/^(#{1,6})\s+/);
  if (headingMatch) {
    const markerLen = headingMatch[0].length;
    text = text.slice(markerLen);
    if (column >= markerLen) {
      offset += markerLen;
    } else {
      // Cursor is in the marker itself, position at start
      return { text, adjustedColumn: 0 };
    }
  }

  // Strip list markers: - * + or numbered
  const listMatch = text.match(/^(\s*)([-*+]|\d+\.)\s+/);
  if (listMatch) {
    const markerLen = listMatch[0].length;
    text = text.slice(markerLen);
    if (column - offset >= markerLen) {
      offset += markerLen;
    } else {
      return { text, adjustedColumn: 0 };
    }
  }

  // Strip blockquote markers: >
  const quoteMatch = text.match(/^(>\s*)+/);
  if (quoteMatch) {
    const markerLen = quoteMatch[0].length;
    text = text.slice(markerLen);
    if (column - offset >= markerLen) {
      offset += markerLen;
    } else {
      return { text, adjustedColumn: 0 };
    }
  }

  // Strip inline formatting for word extraction
  // **bold** -> bold, *italic* -> italic, `code` -> code
  // This is complex because we need to track position changes
  // For now, we don't strip inline formatting from the text itself,
  // but we handle it in word matching

  return { text, adjustedColumn: Math.max(0, column - offset) };
}

/**
 * Strip inline markdown formatting from text
 * Used for word matching across modes
 */
export function stripInlineFormatting(text: string): string {
  return (
    text
      // Footnote references: [^1] or [^label] - remove entirely (rendered as superscript)
      .replace(/\[\^[^\]]+\]/g, "")
      // Inline math: $...$ - keep content without delimiters
      .replace(/\$([^$]+)\$/g, "$1")
      // Bold: **text** or __text__
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      // Italic: *text* or _text_
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      // Strikethrough: ~~text~~
      .replace(/~~(.+?)~~/g, "$1")
      // Inline code: `text`
      .replace(/`(.+?)`/g, "$1")
      // Links: [text](url)
      .replace(/\[(.+?)\]\([^)]+\)/g, "$1")
      // Images: ![alt](url)
      .replace(/!\[(.+?)\]\([^)]+\)/g, "$1")
  );
}

/**
 * Find the opening fence line for a code block containing the given line index.
 * Returns the 0-based line index of the opening fence, or null if not in a code block.
 */
export function findCodeFenceStartLine(
  lines: string[],
  lineIndex: number
): number | null {
  let currentFence: string | null = null;
  let fenceStartLine = -1;

  for (let i = 0; i <= lineIndex && i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (currentFence === null) {
      if (/^```/.test(trimmed)) {
        currentFence = "```";
        fenceStartLine = i;
      } else if (/^~~~/.test(trimmed)) {
        currentFence = "~~~";
        fenceStartLine = i;
      }
    } else {
      if (currentFence === "```" && /^```/.test(trimmed)) {
        currentFence = null;
        fenceStartLine = -1;
      } else if (currentFence === "~~~" && /^~~~/.test(trimmed)) {
        currentFence = null;
        fenceStartLine = -1;
      }
    }
  }

  return currentFence !== null ? fenceStartLine : null;
}

/**
 * Check if currently inside a code block.
 * Tracks fence type (``` vs ~~~) to avoid toggling on different markers.
 */
export function isInsideCodeBlock(lines: string[], lineIndex: number): boolean {
  return findCodeFenceStartLine(lines, lineIndex) !== null;
}
