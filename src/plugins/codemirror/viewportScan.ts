/**
 * Viewport Scan Window
 *
 * Purpose: Bounds per-keystroke decoration work for Source-mode ViewPlugins to
 * O(viewport) instead of O(document). Computes the line window a decoration
 * builder should scan — the editor's visible ranges expanded by a margin so
 * multi-line blocks whose opening line sits just above (or below) the viewport
 * are still detected.
 *
 * Key decisions:
 *   - `margin` defaults to BLOCK_SCAN_MARGIN (200), matching the MAX_LOOKAHEAD
 *     cap of the media/details block finders. Because those blocks are ≤200
 *     lines, any block intersecting the viewport has its opening line inside
 *     the window — viewport-limited scanning is provably complete for them.
 *     Alert blocks (blockquote runs) are unbounded in principle; a >200-line
 *     alert straddling the viewport top loses styling on its far side until
 *     scrolled into range, which is acceptable for a pathological case.
 *   - Falls back to the whole document when visibleRanges is empty (a detached
 *     or unmeasured view, e.g. jsdom before layout), so correctness never
 *     depends on a measured viewport.
 *   - Assumes a SINGLE contiguous visible range: the window spans the first
 *     range's start to the last range's end. VMark's Source mode enables no
 *     code folding and no block-replace (content-hiding) decorations, so
 *     `visibleRanges` is always one range. If either is ever added, a large
 *     folded gap between two ranges would be scanned wholesale (reintroducing
 *     O(document) work) — at that point switch to per-range windows (see the
 *     `showInvisibles` plugin, which already iterates `visibleRanges`).
 *
 * @coordinates-with sourceAlertDecoration, sourceMediaDecoration,
 *   sourceDetailsDecoration, brHidingPlugin — consumers pass this window to
 *   their block finders
 * @module plugins/codemirror/viewportScan
 */

/** Look-back/ahead margin (lines) for block-scanning decoration plugins. */
export const BLOCK_SCAN_MARGIN = 200;

export interface ScanWindow {
  /** First line to scan (1-based, inclusive). */
  startLine: number;
  /** Last line to scan (1-based, inclusive). */
  endLine: number;
}

/** Minimal doc surface needed to resolve a viewport line window. */
interface DocLike {
  lines: number;
  lineAt(pos: number): { number: number };
}

/** Minimal view surface: CodeMirror's EditorView satisfies this structurally. */
interface ViewLike {
  visibleRanges: readonly { from: number; to: number }[];
  state: { doc: DocLike };
}

/**
 * Compute the [startLine, endLine] window a decoration plugin should scan: the
 * span of the view's visible ranges expanded by `margin` lines on each side and
 * clamped to the document. Returns the whole document when no ranges are
 * visible (unmeasured view).
 */
export function viewportScanWindow(
  view: ViewLike,
  margin: number = BLOCK_SCAN_MARGIN,
): ScanWindow {
  const doc = view.state.doc;
  const ranges = view.visibleRanges;
  if (ranges.length === 0) {
    return { startLine: 1, endLine: doc.lines };
  }
  const first = doc.lineAt(ranges[0].from).number;
  const last = doc.lineAt(ranges[ranges.length - 1].to).number;
  return {
    startLine: Math.max(1, first - margin),
    endLine: Math.min(doc.lines, last + margin),
  };
}
