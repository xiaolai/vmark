// @vitest-environment node
//
// WI-TNAV1.1 — the pure core of the tab-strip overflow affordance.
//
// F1: `.status-tabs` is `max-width: 60%; overflow-x: auto` with the scrollbar
// suppressed in both engines (`StatusBar.css:152-166`), so tabs scroll out of
// view with no affordance at all. This module decides whether an affordance is
// owed on each side.
//
// Law 1 is an equality on BOTH sides, not an implication. The round-1 matrix
// wrote it one-sided ("no overflow ⇒ both flags false") and an implementation
// with an epsilon on the left test and none on the right satisfied the entire
// unit — because law 2 (completeness) was satisfied by the lying flag itself.
// Real WebKit produces fractional `scrollWidth` constantly; jsdom never does.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { overflowState, OVERFLOW_EPSILON } from "./tabStripOverflow";

const EPS = OVERFLOW_EPSILON;

describe("overflowState", () => {
  it("obeys the two-sided equality, completeness and monotonicity", () => {
    fc.assert(
      fc.property(
        fc
          .record({
            clientWidth: fc.double({ min: 0, max: 2000, noNaN: true }),
            overflow: fc.double({ min: 0, max: 3000, noNaN: true }),
            t: fc.double({ min: 0, max: 1, noNaN: true }),
            dt: fc.double({ min: 0, max: 1, noNaN: true }),
          })
          .map(({ clientWidth, overflow, t, dt }) => {
            const scrollLeft = overflow * t;
            // A second, never-smaller in-range position, for monotonicity.
            const scrollLeftUp = scrollLeft + (overflow - scrollLeft) * dt;
            return { clientWidth, overflow, scrollLeft, scrollLeftUp };
          }),
        ({ clientWidth, overflow, scrollLeft, scrollLeftUp }) => {
          const scrollWidth = clientWidth + overflow;
          const got = overflowState({ scrollLeft, clientWidth, scrollWidth });

          // Law 1 — exact flags, both sides, same epsilon. Stated across the
          // WHOLE domain including the degenerate box, so the guard below is
          // part of the law rather than an exception to it.
          if (clientWidth <= 0) {
            expect(got).toEqual({ canScrollLeft: false, canScrollRight: false });
          } else {
            expect(got.canScrollLeft).toBe(Math.max(0, scrollLeft) > EPS);
            expect(got.canScrollRight).toBe(
              scrollWidth - clientWidth - Math.max(0, scrollLeft) > EPS,
            );

            // Law 2 — completeness. Subordinate to law 1: alone it is satisfied
            // by a flag that is always true. This is F1's user-visible property.
            if (overflow > EPS) {
              expect(got.canScrollLeft || got.canScrollRight).toBe(true);
            }
          }

          // Law 3 — monotonicity in scrollLeft.
          const up = overflowState({ scrollLeft: scrollLeftUp, clientWidth, scrollWidth });
          expect(Number(up.canScrollLeft)).toBeGreaterThanOrEqual(Number(got.canScrollLeft));
          expect(Number(up.canScrollRight)).toBeLessThanOrEqual(Number(got.canScrollRight));
        },
      ),
      { numRuns: 500 },
    );
  });

  it("treats sub-pixel overflow at the LEFT endpoint as no overflow", () => {
    expect(overflowState({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400.4 })).toEqual({
      canScrollLeft: false,
      canScrollRight: false,
    });
  });

  it("treats fractional overflow at the RIGHT endpoint as no overflow", () => {
    // Gap 1. `scrollLeft > EPS` paired with a bare `scrollLeft < scrollWidth -
    // clientWidth` passes every other case here and ships a right chevron
    // permanently lit, scrolling 0.4px — at the end of the strip, which is
    // where a real one spends most of its time.
    expect(overflowState({ scrollLeft: 200, clientWidth: 400, scrollWidth: 600.4 })).toEqual({
      canScrollLeft: true,
      canScrollRight: false,
    });
  });

  it("reports no right affordance when scrolled to the exact end", () => {
    expect(overflowState({ scrollLeft: 200, clientWidth: 400, scrollWidth: 600 })).toEqual({
      canScrollLeft: true,
      canScrollRight: false,
    });
  });

  it.each([
    { label: "hidden status bar / pre-layout", input: { scrollLeft: 0, clientWidth: 0, scrollWidth: 0 } },
    { label: "measured before the box exists", input: { scrollLeft: 0, clientWidth: 0, scrollWidth: 300 } },
  ])("yields no affordance and no NaN for a zero-size container ($label)", ({ input }) => {
    const got = overflowState(input);
    expect(got).toEqual({ canScrollLeft: false, canScrollRight: false });
    expect(Number.isNaN(Number(got.canScrollLeft))).toBe(false);
    expect(Number.isNaN(Number(got.canScrollRight))).toBe(false);
  });

  it.each([
    { label: "overflowing", scrollWidth: 600 },
    { label: "not overflowing", scrollWidth: 400 },
  ])("clamps a negative scrollLeft from macOS rubber-band overscroll ($label)", ({ scrollWidth }) => {
    // `scrollLeft !== 0` as the left test would light the left chevron during
    // an overscroll bounce. RTL is not the source here — all ten locales are
    // LTR; overscroll is a macOS default.
    expect(overflowState({ scrollLeft: -12, clientWidth: 400, scrollWidth }).canScrollLeft).toBe(false);
  });
});
