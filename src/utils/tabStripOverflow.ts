/**
 * Tab-strip overflow — the pure decision core (WI-TNAV1.1).
 *
 * Purpose: given a scroll container's geometry, decide whether a scroll
 * affordance is owed on each side. `.status-tabs` is `max-width: 60%;
 * overflow-x: auto` with the scrollbar suppressed in BOTH engines
 * (`StatusBar.css:152-166`), so without this the strip scrolls silently and
 * tabs vanish with nothing to indicate they exist (F1).
 *
 * Key decisions:
 *   - The two sides are computed with the SAME epsilon. An implementation with
 *     an epsilon on the left and a bare comparison on the right passes every
 *     example a jsdom suite can write, and ships a right chevron permanently
 *     lit at the end of the strip — because real WebKit produces fractional
 *     `scrollWidth` constantly and jsdom never does. The epsilon is therefore
 *     exported, so the test asserts the same constant rather than a copy.
 *   - A zero-width box is never scrollable, whatever `scrollWidth` says. The
 *     hidden status bar (F7) and the pre-layout first paint both measure
 *     `clientWidth: 0`, and a ratio-based implementation would divide by it.
 *   - `scrollLeft` is clamped at 0: macOS rubber-band overscroll drives it
 *     negative, and `scrollLeft !== 0` as the left test would light the left
 *     chevron mid-bounce. (Not an RTL concern — all ten locales are LTR.)
 *
 * @coordinates-with hooks/useTabStripOverflow.ts — observes a real element and calls this
 *
 * Lives in `utils/` per ADR-013: it is leaf-pure — no React, no stores, no
 * Tauri. Only the observing hook beside it is a React adapter.
 * @module utils/tabStripOverflow
 */

/** Sub-pixel slack, in CSS pixels. Below this, a difference is layout noise. */
export const OVERFLOW_EPSILON = 0.5;

export interface ScrollGeometry {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

export interface OverflowState {
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

const NONE: OverflowState = { canScrollLeft: false, canScrollRight: false };

/** Decide which scroll affordances a container currently owes. */
export function overflowState({ scrollLeft, clientWidth, scrollWidth }: ScrollGeometry): OverflowState {
  if (!(clientWidth > 0)) return NONE; // also absorbs NaN
  const left = Math.max(0, scrollLeft);
  const remaining = scrollWidth - clientWidth - left;
  return {
    canScrollLeft: left > OVERFLOW_EPSILON,
    canScrollRight: remaining > OVERFLOW_EPSILON,
  };
}
