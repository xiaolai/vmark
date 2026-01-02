import type { NodeType } from "@/stores/editorStore";

/**
 * Detect node type from markdown line
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

  // Blockquote
  if (/^>\s?/.test(trimmed)) {
    return "blockquote";
  }

  // Table row (contains |)
  if (/^\|/.test(trimmed) || /\|/.test(line)) {
    return "table_cell";
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
 * Check if a line is content (not blank or HTML-only)
 */
export function isContentLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  // Skip HTML-only lines like <br />, <br/>, <hr />, etc.
  if (/^<\/?[a-z][^>]*\/?>$/i.test(trimmed)) return false;
  // Skip code fence lines
  if (/^```/.test(trimmed) || /^~~~/.test(trimmed)) return false;
  // Skip table separator lines
  if (/^\|?[\s:-]+\|[\s:-|]+$/.test(trimmed)) return false;
  return true;
}

/**
 * Check if currently inside a code block
 */
export function isInsideCodeBlock(lines: string[], lineIndex: number): boolean {
  let insideCodeBlock = false;
  for (let i = 0; i <= lineIndex && i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^```/.test(trimmed) || /^~~~/.test(trimmed)) {
      insideCodeBlock = !insideCodeBlock;
    }
  }
  return insideCodeBlock;
}

/**
 * Get content line index (skipping blank lines, fences, etc.)
 */
export function getContentLineIndex(
  lines: string[],
  lineNumber: number
): number {
  let contentLineIndex = 0;
  for (let i = 0; i < lineNumber && i < lines.length; i++) {
    if (isContentLine(lines[i])) {
      contentLineIndex++;
    }
  }
  return contentLineIndex;
}

/**
 * Get line number from content line index
 */
export function getLineFromContentIndex(
  lines: string[],
  contentLineIndex: number
): number {
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (isContentLine(lines[i])) {
      if (count === contentLineIndex) {
        return i;
      }
      count++;
    }
  }
  // Return last content line if not found
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isContentLine(lines[i])) {
      return i;
    }
  }
  return 0;
}
