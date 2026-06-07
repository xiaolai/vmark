/**
 * footnotePopup operations — ADR-010 pattern.
 *
 * Shared helpers between the Tiptap and CodeMirror footnote popups.
 * Both controllers parse `[^ref]` references and locate their
 * corresponding `[^ref]: body` definition lines.
 *
 * @module plugins/footnotePopup/operations
 */

const FOOTNOTE_REF_RE = /\[\^([^\]\s]+)\]/g;
const FOOTNOTE_DEF_RE = /^\[\^([^\]\s]+)\]:\s*(.*)$/;

/** Extract every footnote reference id appearing in a markdown string. */
export function extractFootnoteIds(markdown: string): string[] {
  const ids: string[] = [];
  for (const match of markdown.matchAll(FOOTNOTE_REF_RE)) {
    if (match[1]) ids.push(match[1]);
  }
  return ids;
}

/** Find the body of the `[^id]: …` definition line, or null if absent. */
export function findFootnoteDefinition(markdown: string, id: string): string | null {
  for (const line of markdown.split(/\r?\n/)) {
    const match = FOOTNOTE_DEF_RE.exec(line);
    if (match && match[1] === id) return match[2] ?? "";
  }
  return null;
}
