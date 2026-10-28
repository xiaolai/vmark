/**
 * Comment selection — where the reader's selection is in the Markdown text
 * a comment is anchored to, as the journal's `selection` field: UTF-16
 * offsets and whether the editor could map them exactly.
 *
 * Key decisions:
 *   - Markdown offsets — Source's own, or a WYSIWYG selection mapped onto
 *     the Markdown exactly (`wysiwygSelectionMap.ts`) — are exact when they
 *     were taken against the same text. Otherwise they are searched for
 *     like an unmapped selection, and never exact: where the selected text
 *     was deleted, its one remaining occurrence is another place.
 *   - A WYSIWYG selection that could not be mapped is a guess and is never
 *     sent as exact, even where its Markdown occurs once: a slice's own
 *     Markdown may occur at another place than the selection (part of a
 *     bold run serializes as a bold run of its own). The occurrence nearest
 *     the estimate is sent, or, where it occurs nowhere, a caret at the
 *     estimate; both `approximate`. The journal widens an approximate
 *     selection to the whole blocks it touches, so a guess never quotes
 *     half a construct.
 *   - A caret (collapsed selection) is sent as it is; the journal anchors
 *     it to its block.
 *   - Offsets never split a surrogate pair and never leave the text.
 *
 * @coordinates-with services/agentJournal/comments/wysiwygSelectionMap.ts — the exact WYSIWYG mapping
 * @coordinates-with src-tauri/src/agent_journal/comment_anchor/create.rs — how the journal reads the selection
 * @module services/agentJournal/comments/commentSelection
 */

type SelectionPrecision = "exact" | "approximate";

export interface CommentSelection {
  start: number;
  end: number;
  precision: SelectionPrecision;
}

export type EditorSelection =
  /** UTF-16 offsets in `text`, the document's Markdown as the editor held it. */
  | { mode: "markdown"; from: number; to: number; selected: string; text: string }
  /** A WYSIWYG selection that could not be mapped: its slice's Markdown and an estimated start offset. */
  | { mode: "wysiwyg"; selected: string; estimate: number };

const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;

/** `i` clamped into `text`, moved back out of a surrogate pair. */
function clampOffset(text: string, i: number): number {
  const at = Math.max(0, Math.min(text.length, Math.trunc(Number.isFinite(i) ? i : text.length)));
  return at > 0 && at < text.length && isHigh(text.charCodeAt(at - 1)) && isLow(text.charCodeAt(at)) ? at - 1 : at;
}

/**
 * The occurrence of `selected` nearest `estimate` (the earlier on a tie),
 * always `approximate`: a search is a guess even where it finds one match.
 * Two native searches either side of the estimate: nothing is collected, so a
 * selection that repeats throughout a large document costs no more.
 */
function search(text: string, selected: string, estimate: number): CommentSelection {
  const at = clampOffset(text, estimate);
  if (selected.length === 0) return { start: at, end: at, precision: "approximate" };
  const before = text.lastIndexOf(selected, at);
  const after = text.indexOf(selected, at);
  if (before === -1 && after === -1) return { start: at, end: at, precision: "approximate" };
  const nearest = after === -1 || (before !== -1 && at - before <= after - at) ? before : after;
  return { start: nearest, end: nearest + selected.length, precision: "approximate" };
}

/** The selection a comment on `text` sends; see the header. */
export function locateSelection(text: string, sel: EditorSelection): CommentSelection {
  if (sel.mode === "wysiwyg") return search(text, sel.selected, sel.estimate);
  // @edge-case Read against other text: the one match a search finds may not be the selection.
  if (sel.text !== text) return search(text, sel.selected, sel.from);
  const lo = Math.min(sel.from, sel.to);
  const hi = Math.max(sel.from, sel.to);
  const start = clampOffset(text, lo);
  const end = clampOffset(text, hi);
  const inRange = sel.from <= sel.to && start === sel.from && end === sel.to;
  return { start, end, precision: inRange ? "exact" : "approximate" };
}
