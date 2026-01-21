/**
 * Format Range Detection for Source Mode
 *
 * Detects if cursor is inside a formatted range (e.g., **bold**, *italic*).
 * Used by the toolbar shortcut to auto-select formatted content.
 */

import type { EditorView } from "@codemirror/view";
import type { FormatType } from "./formatTypes";

export interface FormattedRangeInfo {
  type: FormatType;
  from: number;        // Start of opening marker (absolute)
  to: number;          // End of closing marker (absolute)
  contentFrom: number; // Start of content (absolute)
  contentTo: number;   // End of content (absolute)
}

// Marker definitions ordered by priority (longer markers first)
// This prevents `*` from matching before `**`
interface MarkerDef {
  marker: string;
  type: FormatType;
}

const MARKER_DEFS: MarkerDef[] = [
  { marker: "**", type: "bold" },
  { marker: "__", type: "bold" },
  { marker: "~~", type: "strikethrough" },
  { marker: "==", type: "highlight" },
  { marker: "++", type: "underline" },
  { marker: "`", type: "code" },
  { marker: "*", type: "italic" },
  { marker: "_", type: "italic" },
  { marker: "~", type: "subscript" },
  { marker: "^", type: "superscript" },
];

/**
 * Find all occurrences of a format marker pair on a line.
 * Returns ranges where the marker pair appears.
 */
function findMarkerRanges(
  lineText: string,
  marker: string
): Array<{ start: number; end: number; contentStart: number; contentEnd: number }> {
  const ranges: Array<{ start: number; end: number; contentStart: number; contentEnd: number }> = [];
  const markerLen = marker.length;

  // Escape special regex characters
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Build regex that matches balanced markers
  // For single char markers, content must not be the same char
  // For double char markers, content can be anything (including single char)
  let pattern: RegExp;

  if (markerLen === 1) {
    // Single char: match marker + non-marker content + marker
    // e.g., `*` matches `*text*` but not `**`
    pattern = new RegExp(`${escaped}([^${escaped}]+)${escaped}`, "g");
  } else {
    // Double char: match marker + any content + marker
    // e.g., `**` matches `**text**`
    pattern = new RegExp(`${escaped}(.+?)${escaped}`, "g");
  }

  let match;
  while ((match = pattern.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const contentStart = start + markerLen;
    const contentEnd = end - markerLen;

    ranges.push({ start, end, contentStart, contentEnd });
  }

  return ranges;
}

/**
 * Get formatted range at cursor position.
 * Returns null if cursor is not inside a formatted range.
 *
 * Detection rule: markerStart < cursor < markerEnd (exclusive bounds)
 * This means cursor at the boundary (before opening or after closing) returns null.
 */
export function getFormattedRangeAtCursor(view: EditorView): FormattedRangeInfo | null {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const lineText = line.text;
  const posInLine = from - line.from;

  // Try each marker type in priority order
  for (const { marker, type } of MARKER_DEFS) {
    const ranges = findMarkerRanges(lineText, marker);

    for (const range of ranges) {
      // Check if cursor is strictly inside the range (exclusive bounds)
      // markerStart < cursor < markerEnd
      if (posInLine > range.start && posInLine < range.end) {
        return {
          type,
          from: line.from + range.start,
          to: line.from + range.end,
          contentFrom: line.from + range.contentStart,
          contentTo: line.from + range.contentEnd,
        };
      }
    }
  }

  return null;
}
