/**
 * wikiLinkPopup operations — ADR-010 pattern.
 *
 * Shared helpers between the Tiptap and CodeMirror wiki-link popups.
 * Wiki-links use the [[target|alias]] syntax; both controllers parse
 * and re-serialize this consistently.
 *
 * @module plugins/wikiLinkPopup/operations
 */

export interface WikiLinkParts {
  target: string;
  alias: string | null;
}

/** Parse the inner contents of `[[...]]` into target + optional alias. */
export function parseWikiLinkBody(body: string): WikiLinkParts {
  const trimmed = body.trim();
  const pipeIdx = trimmed.indexOf("|");
  if (pipeIdx < 0) return { target: trimmed, alias: null };
  return {
    target: trimmed.slice(0, pipeIdx).trim(),
    alias: trimmed.slice(pipeIdx + 1).trim() || null,
  };
}

/** Build a `[[target|alias]]` string from parts; alias optional. */
export function formatWikiLink(parts: WikiLinkParts): string {
  const target = parts.target.trim();
  if (!parts.alias) return `[[${target}]]`;
  return `[[${target}|${parts.alias.trim()}]]`;
}

/** Wiki-link targets must be non-empty after trimming. */
export function isValidWikiTarget(target: string): boolean {
  return target.trim().length > 0;
}
