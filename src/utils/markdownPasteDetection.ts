/**
 * Markdown Paste Detection
 *
 * Purpose: Heuristics to decide whether plain text clipboard content
 * should be parsed as Markdown when pasting into WYSIWYG mode.
 *
 * Key decisions:
 *   - Code fences and tables are "instant yes" — always treated as markdown
 *   - Strong signals (headings, lists, HRs) need just 1 occurrence
 *   - Weak signals (emphasis, links) need 2+ to avoid false positives
 *   - Single-line pastes have a higher threshold to avoid treating
 *     normal text like "use *caution*" as markdown
 *
 * @coordinates-with smartPaste/tiptap.ts — calls isMarkdownPasteCandidate to decide paste behavior
 * @coordinates-with markdownPaste/tiptap.ts — fallback paste handler
 * @module utils/markdownPasteDetection
 */

const CODE_FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^\s*#{1,6}\s+/;
const BLOCKQUOTE_RE = /^\s*>\s+/;
const LIST_RE = /^\s*(?:[-*+]|\d+\.)\s+/;
const HR_RE = /^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/;
const LINK_RE = /!?\[[^\]]+\]\([^)]+\)/;
const STRONG_EMPHASIS_RE = /(?:^|\s)(\*\*|__)\S[^\n]*?\S\1/;
const EMPHASIS_RE = /(?:^|\s)(\*|_)\S[^\n]*?\S\1/;

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isTableHeader(line: string): boolean {
  return /\|/.test(line);
}

export function isMarkdownPasteCandidate(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const lines = trimmed.split(/\r?\n/);
  const hasNewline = lines.length > 1;

  let strongSignals = 0;
  let weakSignals = 0;
  let hasBlockquote = false;
  let hasLink = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const isBlockquote = BLOCKQUOTE_RE.test(line);
    if (isBlockquote) {
      hasBlockquote = true;
    }
    const stripped = isBlockquote ? line.replace(BLOCKQUOTE_RE, "") : line;

    if (CODE_FENCE_RE.test(stripped)) return true;

    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const nextStripped = BLOCKQUOTE_RE.test(nextLine)
        ? nextLine.replace(BLOCKQUOTE_RE, "")
        : nextLine;
      if (isTableHeader(stripped) && isTableSeparator(nextStripped)) {
        return true;
      }
    }

    if (HEADING_RE.test(stripped)) strongSignals += 1;
    if (LIST_RE.test(stripped)) strongSignals += 1;
    if (HR_RE.test(stripped)) strongSignals += 1;
    if (LINK_RE.test(stripped)) {
      weakSignals += 1;
      hasLink = true;
    }
    if (STRONG_EMPHASIS_RE.test(stripped) || EMPHASIS_RE.test(stripped)) {
      weakSignals += 1;
    }
  }

  if (hasNewline) {
    if (strongSignals > 0) return true;
    if (weakSignals >= 2) return true;
    if (hasLink) return true;
    if (hasBlockquote && weakSignals > 0) return true;
    return false;
  }

  if (strongSignals > 0) return true;
  if (weakSignals >= 2) return true;

  return false;
}
