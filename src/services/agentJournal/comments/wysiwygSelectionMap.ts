/**
 * WYSIWYG selection map — a ProseMirror selection's exact UTF-16 offsets in
 * the document's Markdown, or `null` when they cannot be proven exact.
 *
 * Mechanism (the sentinel round-trip): copy the document, insert two
 * private-use code points absent from it at the selection's bounds,
 * serialize with the real serializer, find them, and strip them. The offsets
 * count only when the stripped text equals the document's Markdown exactly:
 * equality is the proof that the sentinels changed nothing else (an escape,
 * an emphasis marker, a split mark run). A slice's own Markdown is never
 * searched for here — part of a bold run serializes as a bold run of its
 * own, which may occur elsewhere.
 *
 * Key decisions:
 *   - Two placements are tried, because a bound at a mark's edge may sit
 *     inside or outside it: "inner" takes the marks of the selected side,
 *     "outer" only the marks shared by both sides. Inner is tried first, so
 *     a selected word quotes as the word, not with its emphasis markers;
 *     outer maps what inner cannot (a caret between two runs).
 *   - A quote never splits a link's destination (`](…)`): a selection
 *     inside one link's text stays inside it, and a selection crossing a
 *     link's edge is widened to cover the whole link, its sentinel placed
 *     outside the link mark. A link is a mark carrying an `href`.
 *   - A bound outside a textblock (a node selection, a selection between
 *     blocks) gets no text inserted cleanly; the round-trip fails and the
 *     caller falls back to a guess.
 *
 * @coordinates-with services/agentJournal/comments/commentCreate.ts — the reader
 * @module services/agentJournal/comments/wysiwygSelectionMap
 */

import type { Mark, Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";

const PUA_FIRST = 0xe000;
const PUA_LAST = 0xf8ff;

/**
 * Two private-use code points that do not occur in `text`, or `null` when
 * none are free. One pass marks the ones taken: a search per candidate would
 * scan the whole document thousands of times.
 */
function pickSentinels(text: string): [string, string] | null {
  const taken = new Uint8Array(PUA_LAST - PUA_FIRST + 1);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= PUA_FIRST && c <= PUA_LAST) taken[c - PUA_FIRST] = 1;
  }
  const free: string[] = [];
  for (let c = 0; c < taken.length && free.length < 2; c++) {
    if (taken[c] === 0) free.push(String.fromCharCode(PUA_FIRST + c));
  }
  return free.length === 2 ? [free[0], free[1]] : null;
}

type Side = "start" | "end";
const PLACEMENTS: ReadonlyArray<(side: Side, $pos: ResolvedPos) => readonly Mark[]> = [
  (side, $pos) => (side === "start" ? $pos.nodeAfter?.marks : $pos.nodeBefore?.marks) ?? [],
  (_side, $pos) => {
    const after = $pos.nodeAfter?.marks ?? [];
    return ($pos.nodeBefore?.marks ?? []).filter((m) => m.isInSet(after));
  },
];

const isLink = (m: Mark) => typeof m.attrs.href === "string";

/** The document range of the run of `mark` in `$pos`'s textblock that touches `$pos`, or `null`. */
function runOf($pos: ResolvedPos, mark: Mark): { from: number; to: number } | null {
  const runs: { from: number; to: number }[] = [];
  $pos.parent.forEach((child, offset) => {
    if (!mark.isInSet(child.marks)) return;
    const from = $pos.start() + offset;
    const last = runs[runs.length - 1];
    if (last && last.to === from) last.to = from + child.nodeSize;
    else runs.push({ from, to: from + child.nodeSize });
  });
  return runs.find((r) => r.from <= $pos.pos && $pos.pos <= r.to) ?? null;
}

/**
 * Bounds that split no link: a bound inside a link the selection leaves
 * moves to that link's outer edge. Returns the links the selection lies
 * within (their marks stay on the sentinels) and the widened bounds.
 */
function coverLinks(doc: PMNode, from: number, to: number): { from: number; to: number; inside: readonly Mark[] } {
  const inside: Mark[] = [];
  for (const pos of [from, to]) {
    const $pos = doc.resolve(pos);
    const touching = [...($pos.nodeBefore?.marks ?? []), ...($pos.nodeAfter?.marks ?? [])].filter(isLink);
    for (const link of touching) {
      const run = runOf($pos, link);
      if (!run) continue;
      if (from >= run.from && to <= run.to) {
        if (!link.isInSet(inside)) inside.push(link);
      } else {
        if (from > run.from && from < run.to) from = run.from;
        if (to > run.from && to < run.to) to = run.to;
      }
    }
  }
  return { from, to, inside };
}

const allowed = ($pos: ResolvedPos, marks: readonly Mark[]) => marks.filter((m) => $pos.parent.type.allowsMarkType(m.type));

/**
 * The offsets of `[from, to]` of `doc` in `text`, its Markdown as
 * `serialize` writes it; `null` when no placement proves them exact.
 */
export function mapWysiwygSelection(
  doc: PMNode,
  from: number,
  to: number,
  text: string,
  serialize: (doc: PMNode) => string,
): { from: number; to: number } | null {
  const sentinels = pickSentinels(text);
  if (!sentinels || from > to) return null;
  const [S, E] = sentinels;
  const schema = doc.type.schema;
  const covered = coverLinks(doc, from, to);
  const $from = doc.resolve(covered.from);
  const $to = doc.resolve(covered.to);
  // A link's mark stays on a sentinel only when the selection lies within that link.
  const keep = ($pos: ResolvedPos, marks: readonly Mark[]) => allowed($pos, marks).filter((m) => !isLink(m) || m.isInSet(covered.inside));
  for (const marks of PLACEMENTS) {
    let out: string;
    try {
      const tr = new Transform(doc);
      tr.insert(covered.to, schema.text(E, keep($to, marks("end", $to))));
      tr.insert(covered.from, schema.text(S, keep($from, marks("start", $from))));
      out = serialize(tr.doc);
    } catch {
      // A bound where text cannot go: try the next placement, then give up.
      continue;
    }
    const s = out.indexOf(S);
    const e = out.indexOf(E);
    const once = s >= 0 && e > s && out.indexOf(S, s + 1) < 0 && out.indexOf(E, e + 1) < 0;
    if (once && out.replace(S, "").replace(E, "") === text) return { from: s, to: e - S.length };
  }
  return null;
}
