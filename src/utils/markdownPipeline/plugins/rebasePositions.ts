/**
 * Purpose: shift a re-parsed subtree's positions into the coordinates of the
 * document it came from.
 *
 * A construct whose body is extracted as a substring and re-parsed produces
 * offsets that restart at 0. They are well-formed — small integers, ordered,
 * non-overlapping — and they address the wrong text, which is the failure a
 * per-node validity check cannot see. Measured on a compact
 * `<details><summary>S</summary>[c](./c.md)</details>` at document offset 38,
 * the link's range was 0..19 and sliced `padding\n\n<details><`.
 *
 * Guarding against that (refusing every range in the subtree) was the safe
 * response; making the offsets right is the correct one, and it is what lets
 * consumers keep working inside those bodies.
 *
 * Key decisions:
 *   - BOTH coordinate systems move. `offset` shifts by a constant, but `line`
 *     and `column` do not — a body starting mid-line has its first line
 *     continuing the host line, while later lines start at column 1. Callers
 *     that report positions to a human (the link checker prints line/column)
 *     would otherwise get plausible, wrong numbers.
 *   - The rebase is computed from the HOST TEXT, not guessed: the base line is
 *     the count of newlines before the body, and the base column applies only
 *     to content on the body's first line.
 *
 * @coordinates-with plugins/detailsBlock.ts — the only caller
 * @coordinates-with positionTrust.ts — what this makes unnecessary for details
 * @module utils/markdownPipeline/plugins/rebasePositions
 */

interface Point {
  line?: number;
  column?: number;
  offset?: number;
}

interface NodeLike {
  position?: { start?: Point; end?: Point };
  children?: NodeLike[];
}

/** Where an extracted body begins inside its host document. */
export interface RebaseOrigin {
  /** Absolute UTF-16 offset of the body's first character. */
  offset: number;
  /** 1-based line of that character in the host document. */
  line: number;
  /** 1-based column of that character in the host document. */
  column: number;
}

/**
 * The origin of a body that starts `bodyStart` characters into `hostValue`,
 * where `hostValue` itself begins at `hostStart` in the document.
 *
 * Derived from the HOST NODE alone — its own position plus its own text — so
 * it needs no VFile. The first attempt read the source from the transformer's
 * file, and `runSync(tree)` is routinely called without one: offsets came out
 * right (they need only the base) while line and column silently stayed
 * body-local. Numbers that are plausible and wrong are the exact failure this
 * module exists to remove.
 */
export function originWithin(
  hostValue: string,
  bodyStart: number,
  hostStart: RebaseOrigin,
): RebaseOrigin {
  let line = hostStart.line;
  let lastBreak = -1;
  for (let i = 0; i < bodyStart && i < hostValue.length; i += 1) {
    if (hostValue.charCodeAt(i) === 10) {
      line += 1;
      lastBreak = i;
    }
  }
  return {
    offset: hostStart.offset + bodyStart,
    line,
    // Still on the host's first line: continue its column. Past a newline: the
    // body's column is measured from that break.
    column: lastBreak === -1 ? hostStart.column + bodyStart : bodyStart - lastBreak,
  };
}

/** Shift one point into host coordinates. */
function rebasePoint(point: Point | undefined, origin: RebaseOrigin): void {
  if (!point) return;
  if (typeof point.offset === "number") point.offset += origin.offset;
  // Line 1 of the body continues the host line, so its columns are offset by
  // where the body started. Every later line begins at the host's column 1.
  if (typeof point.line === "number") {
    const wasFirstLine = point.line === 1;
    point.line += origin.line - 1;
    if (wasFirstLine && typeof point.column === "number") {
      point.column += origin.column - 1;
    }
  }
}

/**
 * Rebase every position in `nodes` into host coordinates, in place.
 *
 * In place because the nodes were just created by the re-parse and have no
 * other referent; copying would only add allocation.
 */
export function rebasePositions(nodes: NodeLike[], origin: RebaseOrigin): void {
  for (const node of nodes) {
    rebasePoint(node.position?.start, origin);
    rebasePoint(node.position?.end, origin);
    if (node.children) rebasePositions(node.children, origin);
  }
}
