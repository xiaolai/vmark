/**
 * How far a BLOCK-level action reaches.
 *
 * Purpose: the two editing surfaces kept disagreeing about the reach of the same
 * command, and the reason was never that someone chose differently — it was that
 * neither surface CHOSE at all. Each inherited whatever its substrate made
 * convenient: ProseMirror naturally addresses the enclosing node, CodeMirror
 * naturally addresses the selected characters. So "Insert Note" wrapped a
 * paragraph in one mode and a five-character selection in the other, and neither
 * behaviour was written down anywhere.
 *
 * This module writes it down. A block-level action operates on the WHOLE
 * TOP-LEVEL BLOCKS the selection touches — never on a fragment of one, never on
 * a single item of a structure.
 *
 * Key decisions:
 *   - A blank line separates PARAGRAPHS, a fence bounds a code block, and a
 *     ONE-LINE block bounds its neighbours: an ATX heading or a thematic break
 *     is a whole block by grammar and never continues a paragraph, so `para` +
 *     `# heading` are two spans (audit 20260907, #440/#443 — resolving them as
 *     one fenced the heading's TEXT with the paragraph and wrapped a block the
 *     user never selected). Fences are handled because getting them wrong was
 *     DESTRUCTIVE: a caret below a closing ``` resolved to the whole code block.
 *     A BLOCKQUOTE bounds too, by a change of DEPTH rather than by its marker,
 *     so `para` + `> quoted` are two spans while `> a` + `> b` stay one — the
 *     marker rule would have shattered the quote, which is the defect in the
 *     other direction. That is still not the whole of markdown's block grammar:
 *     a LIST ITEM or an HTML block can interrupt a paragraph too, and only
 *     where CommonMark's interrupt rules say so (`para` + `2. item` is ONE
 *     paragraph). Those two are deliberately LEFT — a line rule for them
 *     cannot tell "a list starts here" from "the next item of the list I am
 *     already inside", so it would shatter lists exactly as the quote-marker
 *     rule would have; the fix is the CodeMirror syntax tree, which knows the
 *     container. They stay non-destructive over-reach until then. A `---` run is
 *     the one ambiguous shape: directly under a paragraph line it is a setext
 *     underline — it stays with that paragraph and CLOSES it, so the line
 *     below opens a new span; anywhere else it is a break.
 *   - A list is ONE block, items included. Wrapping a single item shatters the
 *     list into three structures — list, wrapped item, list — which is the exact
 *     defect already recorded for blockquote in the parity ledger. The same
 *     reasoning applies to every wrapper, so it lives here rather than in each.
 *   - LEADING frontmatter is one block, delimiters included, because the span
 *     is a document SLICE and its consumers anchor frontmatter at offset 0 of
 *     what they are handed. A span starting inside it presents `title: …` as
 *     prose, and CJK formatting then rewrote the YAML separator.
 *   - Indices are clamped, not validated. Callers derive them from selections
 *     that can legally sit at the document edge.
 *
 * @coordinates-with toolbarActions/sourceInsertActions.ts — alert/details/math/diagram
 * @coordinates-with toolbarActions/__tests__/parity — the gate that forced this
 * @module plugins/shared/blockSpan
 */

import { fenceRanges } from "./fenceScanner";

/** Inclusive line range, 0-based. */
export interface BlockSpan {
  start: number;
  end: number;
}

const isBlank = (line: string): boolean => line.trim() === "";

/** An ATX heading: up to three spaces, one to six `#`, then a space, a tab or the line's end. */
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
/** A thematic break: up to three spaces, then three or more of ONE of `*`, `-`, `_`, spaces between. */
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
/** A line's leading blockquote markers — `> > x` is two, `x` is none. */
const QUOTE_PREFIX = /^ {0,3}(?:>[ \t]?)+/;
/** A YAML frontmatter delimiter — no indentation, nothing after the dashes. */
const FRONTMATTER_FENCE = /^---[ \t]*$/;

/**
 * The last line of the document's LEADING frontmatter, or null when it has none.
 *
 * Only at line 0, and only when a closer exists: an unterminated `---` is a
 * thematic break, and `---` anywhere else is one too.
 */
function leadingFrontmatterEnd(lines: readonly string[]): number | null {
  if (lines.length < 2 || !FRONTMATTER_FENCE.test(lines[0])) return null;
  for (let i = 1; i < lines.length; i += 1) if (FRONTMATTER_FENCE.test(lines[i])) return i;
  return null;
}

/** How many blockquotes a line opens inside. */
function quoteDepthOf(line: string): number {
  return (QUOTE_PREFIX.exec(line)?.[0].match(/>/g) ?? []).length;
}

/**
 * The whole top-level blocks spanned by lines `[fromLine, toLine]`.
 *
 * A blank line bounds the span; a selection sitting ON a blank line yields just
 * that line, since there is no block to widen to.
 */
export function sourceBlockSpan(lines: readonly string[], fromLine: number, toLine: number): BlockSpan {
  // Clamping alone produced a valid-LOOKING index into an empty array, and the
  // blank check then called `.trim()` on undefined.
  if (lines.length === 0) return { start: 0, end: 0 };

  const last = lines.length - 1;
  let start = Math.min(Math.max(fromLine, 0), last);
  let end = Math.min(Math.max(toLine, 0), last);
  if (start > end) [start, end] = [end, start];

  // A FENCE is a hard boundary in both directions. Blank lines alone do not
  // bound a code block — markdown does not require one after a closing fence —
  // so a caret in the paragraph directly below ``` used to widen straight up
  // through the fence and hand the whole code block to whatever ran next.
  // Wrapping, converting or CJK-formatting that "block" rewrote the user's code.
  //
  // Membership is precomputed per line: `fences.find` on every widening step
  // made a long paragraph after many fences quadratic.
  const fences = fenceRanges(lines);
  const fenceIndexOf = new Int32Array(lines.length).fill(-1);
  fences.forEach((f, fi) => {
    for (let i = f.open; i <= f.close; i += 1) fenceIndexOf[i] = fi;
  });
  const fenceOf = (i: number) =>
    i >= 0 && i < lines.length && fenceIndexOf[i] !== -1 ? fences[fenceIndexOf[i]] : undefined;

  // A one-line block: an ATX heading, or a thematic break — except a `-` run
  // directly under a paragraph line, which is that paragraph's setext underline.
  // A line inside a fence is code, whatever it looks like.
  const isSingleLineBlock = (i: number): boolean => {
    if (fenceOf(i)) return false;
    const line = lines[i];
    if (ATX_HEADING.test(line)) return true;
    if (!THEMATIC_BREAK.test(line)) return false;
    if (!line.trimStart().startsWith("-")) return true;
    return i === 0 || isBlank(lines[i - 1]) || Boolean(fenceOf(i - 1)) || isSingleLineBlock(i - 1);
  };
  const bounds = (i: number): boolean => isBlank(lines[i]) || Boolean(fenceOf(i)) || isSingleLineBlock(i);

  // A `-` run that is NOT a one-line block is a setext underline: it belongs to
  // the paragraph above and CLOSES it. So it is a boundary the widening must
  // respect from both sides — forward it is consumed and then stops, backward
  // the line after it starts a fresh block. Without this the run read as
  // ordinary paragraph text and `para\n---\nnext` resolved as one span.
  const isSetextUnderline = (i: number): boolean =>
    i > 0 && !fenceOf(i) && THEMATIC_BREAK.test(lines[i]) && !isSingleLineBlock(i);

  // A blockquote is a CONTAINER: the paragraph above one is not inside it, and
  // resolving the two as one span handed `insertCodeBlock` a "block" whose `>`
  // markers it then stripped — destroying a quote the user never selected.
  // The boundary is a DEPTH CHANGE, not the marker: `> a` / `> b` stay one
  // block (the module's own rule that a quote is not shattered), while
  // `para` / `> a` are two. Inside a fence the text is code, `>` included.
  const quoteBoundary = (a: number, b: number): boolean =>
    !fenceOf(a) && !fenceOf(b) && quoteDepthOf(lines[a]) !== quoteDepthOf(lines[b]);

  // Each ENDPOINT resolves independently to its own bound — fence span, blank
  // line (stays put: there is no block to widen to), one-line block (is its own
  // span), or paragraph widened to its blank/fence/one-line-block boundary.
  // Coupling them failed twice: a blank endpoint on a RANGE expanded through
  // the separator into an untouched block, and the fence branch returned early
  // with the non-fence endpoint left mid-block, handing a partial paragraph to
  // a destructive replacement. Inside a fence the whole fence IS the block;
  // each endpoint resolves its OWN fence, so a span across two fences keeps
  // both delimiter pairs intact.
  const startFence = fenceOf(start);
  if (startFence) {
    start = Math.min(start, startFence.open);
  } else if (!isBlank(lines[start]) && !isSingleLineBlock(start)) {
    while (
      start > 0 &&
      !bounds(start - 1) &&
      !isSetextUnderline(start - 1) &&
      !quoteBoundary(start - 1, start)
    ) {
      start -= 1;
    }
  }

  const endFence = fenceOf(end);
  if (endFence) {
    end = Math.max(end, endFence.close);
  } else if (!isBlank(lines[end]) && !isSingleLineBlock(end) && !isSetextUnderline(end)) {
    while (end < last && !bounds(end + 1) && !quoteBoundary(end, end + 1)) {
      end += 1;
      if (isSetextUnderline(end)) break;
    }
  }

  // Leading frontmatter is ONE block, delimiters included — and this is a
  // SAFETY rule, not tidiness. A span is a slice of the document, and every
  // downstream protection anchors frontmatter at offset 0 of the text it is
  // handed: `sourceCjkActions` runs `formatMarkdown` over the slice. Since the
  // opening `---` became a one-line block (#440), a selection INSIDE the
  // frontmatter produced a slice starting at `title: …`, which reads as
  // ordinary prose — and CJK formatting rewrote the YAML separator into a
  // fullwidth `：`, breaking the document's metadata.
  const frontmatterEnd = leadingFrontmatterEnd(lines);
  if (frontmatterEnd !== null && start <= frontmatterEnd) {
    start = 0;
    end = Math.max(end, frontmatterEnd);
  }

  return { start, end };
}

/**
 * The block span touched by a CodeMirror selection, as line NUMBERS (0-based).
 *
 * Exists so the three source-mode callers stop repeating — and stop repeating
 * the same off-by-one. CodeMirror's `to` is EXCLUSIVE, so a selection ending at
 * a line start resolves through `lineAt(to)` to the NEXT line and quietly pulled
 * an untouched block into the operation. A non-empty selection therefore reads
 * its last line from `to - 1`.
 */
export function selectionBlockSpan(
  lines: readonly string[],
  fromOffset: number,
  toOffset: number,
  lineNumberAt: (offset: number) => number,
): BlockSpan {
  const lastOffset = toOffset > fromOffset ? toOffset - 1 : toOffset;
  return sourceBlockSpan(lines, lineNumberAt(fromOffset) - 1, lineNumberAt(lastOffset) - 1);
}
