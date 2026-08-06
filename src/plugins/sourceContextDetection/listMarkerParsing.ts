/**
 * One list-marker grammar for Source mode.
 *
 * Purpose: every list-aware path (detection, block bounds, whole-list
 * conversion, single-item mutation, heading conversion) parses the same
 * CommonMark/GFM marker syntax through parseListMarker. Three hand-rolled
 * regexes had drifted apart: ordered close-paren markers and ordered task
 * items were supported in some branches and silently dropped in others.
 *
 * Key decisions:
 *   - A thematic break is NOT a list marker. The spaced CommonMark rule is
 *     used ("- - -" and "* * *" are breaks); the old uninterrupted-run check
 *     missed those forms and let them be destructively converted as lists.
 *   - GFM task checkboxes are recognised on BOTH bullet and ordered items.
 *   - `delimiter` is the character CommonMark compares when deciding whether
 *     an adjacent item continues the same list: the bullet char, or "."/")".
 *   - `contentCol` is the item's content column WITHOUT the checkbox — the
 *     checkbox belongs to the item's paragraph, so a continuation line only
 *     needs to reach the column after the bare marker.
 *
 * @coordinates-with listDetection.ts — getListItemInfo builds on this parse
 * @coordinates-with listBlockBounds.ts — the block scanner's line classifier
 * @module plugins/sourceContextDetection/listMarkerParsing
 */

export interface ListMarker {
  /** Leading whitespace before the marker. */
  indent: string;
  /** Task-ness is orthogonal: GFM allows checkboxes on both kinds. */
  kind: "bullet" | "ordered";
  /** Bullet char for bullets; "." or ")" for ordered items. */
  delimiter: "-" | "*" | "+" | "." | ")";
  /** Ordered item number, or null for bullets. */
  number: number | null;
  /** Whether a GFM task checkbox follows the marker. */
  isTask: boolean;
  /** Raw checkbox char (" ", "x", "X"), or null when not a task. */
  checkboxChar: string | null;
  /** Checkbox state, or null when not a task. */
  checked: boolean | null;
  /** Column where the item's content starts per CommonMark (before any checkbox). */
  contentCol: number;
  /** Everything before the content: indent, marker, checkbox, trailing spaces. */
  prefix: string;
  /** Line text after the prefix. */
  content: string;
}

// CommonMark: up to three leading spaces (four make indented code), then three
// or more of the SAME char out of - _ *, with spaces and tabs allowed between.
const THEMATIC_BREAK_RE = /^ {0,3}([-_*])[ \t]*(?:\1[ \t]*){2,}$/;

// Bullet char or an up-to-nine-digit number with "." or ")" (CommonMark caps
// ordered start numbers at nine digits), then at least one space or tab.
const MARKER_RE = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)/;

// GFM task checkbox, which must itself be followed by whitespace.
const CHECKBOX_RE = /^\[([ xX])\][ \t]+/;

/**
 * Parse a CommonMark/GFM list-item marker off the start of a line.
 * Returns null for non-list lines, including thematic breaks.
 */
export function parseListMarker(line: string): ListMarker | null {
  if (THEMATIC_BREAK_RE.test(line)) return null;
  const match = MARKER_RE.exec(line);
  if (!match) return null;
  const [, indent, bullet, num, orderedDelim, spacing] = match;
  const markerCore = bullet ?? `${num}${orderedDelim}`;

  let prefix = match[0];
  let checkboxChar: string | null = null;
  const checkbox = CHECKBOX_RE.exec(line.slice(prefix.length));
  if (checkbox) {
    checkboxChar = checkbox[1];
    prefix += checkbox[0];
  }

  return {
    indent,
    kind: bullet ? "bullet" : "ordered",
    delimiter: (bullet ?? orderedDelim) as ListMarker["delimiter"],
    number: num ? parseInt(num, 10) : null,
    isTask: checkboxChar !== null,
    checkboxChar,
    checked: checkboxChar === null ? null : checkboxChar !== " ",
    contentCol: indent.length + markerCore.length + spacing.length,
    prefix,
    content: line.slice(prefix.length),
  };
}

/** Discriminated list-item type, task subsuming both bullet and ordered tasks. */
export type ListType = "bullet" | "ordered" | "task";

/** A resolved list item at a cursor position. Lives here (the leaf module) so
 *  detection and mutation can both import it without a cycle. */
export interface ListItemInfo {
  /** Type of list */
  type: ListType;
  /** Start position of the list item line */
  lineStart: number;
  /** End position of the list item line */
  lineEnd: number;
  /** Indentation level (0-based) */
  indent: number;
  /** For ordered lists and ordered tasks, the number; for others, null */
  number: number | null;
  /** For task lists, whether checked */
  checked: boolean | null;
  /** The marker text (e.g., "- ", "1. ", "- [ ] "), including indentation */
  marker: string;
  /** Position where content starts (after marker) */
  contentStart: number;
}
