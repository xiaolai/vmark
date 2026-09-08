/**
 * Where a diagnostic starts, when the parser's own offset is missing.
 *
 * mdast types `offset` as optional. Five rules wrote `offset ?? 0`, which puts
 * the squiggle at CHARACTER ZERO — under someone else's text at the top of the
 * document — rather than at the thing being reported. It is a fallback that
 * cannot be noticed in a test that only counts diagnostics, and the engine has
 * always had the answer: `lineOffsets` says where each line begins, and the
 * position's own 1-based column says how far into it to go.
 *
 * @module lib/lintEngine/rules/positionOffset
 */

/** A 1-based source point, as mdast reports one. */
interface Point {
  line: number;
  column: number;
  offset?: number | undefined;
}

/** `point`'s absolute offset — the parser's, or the line index's answer. */
export function startOffset(point: Point, lineOffsets: readonly number[]): number {
  return point.offset ?? (lineOffsets[point.line - 1] ?? 0) + point.column - 1;
}
