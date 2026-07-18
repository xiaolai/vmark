/**
 * Search Match Finding (WYSIWYG)
 *
 * Purpose: Pure match-finding for the search plugin — builds a regex from the
 * query + options and scans the document for matches with exact ProseMirror
 * positions.
 *
 * Key decisions:
 *   - Scans per inline-content parent (textblocks, plus inline nodes that
 *     themselves hold text such as wiki links), aggregating the parent's
 *     direct-child text into one string so queries crossing a mark boundary
 *     ("foo bar" over "foo **bar**") still match.
 *   - Non-text children (hard breaks, inline atoms, nested inline nodes) are
 *     represented by placeholder characters — one per position — so string
 *     offsets map 1:1 onto document positions; matches overlapping a
 *     placeholder are dropped (atoms have no real text, and fabricating text
 *     would corrupt replace positions).
 *   - Cross-block matches remain unsupported (parity with Source mode, where
 *     a plain-text query does not match across newlines).
 *   - Matches are sorted by position so navigation order is document order
 *     even when text sits inside nested inline nodes.
 *
 * @coordinates-with tiptap.ts — consumes matches for decorations, navigation, and replace
 * @module plugins/search/findMatches
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface Match {
  from: number;
  to: number;
}

/**
 * Stand-in for non-text inline content (object replacement character).
 * Cannot appear in real document text, so it never matches a user query;
 * a regex match that overlaps it is discarded.
 */
const NON_TEXT_PLACEHOLDER = "\uFFFC";

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRegex(
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  useRegex: boolean
): RegExp | null {
  if (!query) return null;

  const flags = caseSensitive ? "g" : "gi";
  let pattern: string;

  if (useRegex) {
    pattern = query;
  } else {
    pattern = escapeRegExp(query);
    if (wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
  }

  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * Find all matches for the query in the document, in document order.
 * Positions are exact — safe for both Decoration.inline and replaceWith.
 */
export function findMatchesInDoc(
  doc: ProseMirrorNode,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  useRegex: boolean
): Match[] {
  const regex = buildRegex(query, caseSensitive, wholeWord, useRegex);
  if (!regex) return [];

  const matches: Match[] = [];

  doc.descendants((node, pos) => {
    if (!node.inlineContent || node.content.size === 0) return true;

    // Aggregate direct children: text contributes its characters, everything
    // else contributes nodeSize placeholders, keeping string offset === doc
    // position - (pos + 1) for every character.
    let text = "";
    node.forEach((child) => {
      text +=
        child.isText && child.text
          ? child.text
          : NON_TEXT_PLACEHOLDER.repeat(child.nodeSize);
    });

    const base = pos + 1;
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = regex.exec(text)) !== null) {
      if (!m[0].includes(NON_TEXT_PLACEHOLDER)) {
        matches.push({ from: base + m.index, to: base + m.index + m[0].length });
      }
      if (m[0].length === 0) regex.lastIndex++;
    }

    // Descend anyway: inline children with their own text content (e.g. wiki
    // links) are scanned as their own inline-content parents.
    return true;
  });

  return matches.sort((a, b) => a.from - b.from);
}
