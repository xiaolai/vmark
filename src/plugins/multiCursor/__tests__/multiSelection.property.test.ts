/**
 * Property-based invariant tests for MultiSelection — CONSTRUCTION.
 *
 * Purpose: this package has 10k+ lines of example-based multi-cursor tests and
 * still took 41 fix commits, because the defects live in COMBINATIONS nobody
 * wrote an example for — overlapping ranges surviving Shift+Arrow, backward
 * flags desynchronising when ranges merge (#311), collapsed cursors expanding on
 * a mapped insertion (#526), boundary-touching cursors not absorbed (#763),
 * primary index drifting after a merge.
 *
 * Every one of those is a structural invariant broken by an input combination.
 * These properties generate hundreds of range sets and assert the invariants
 * hold, so the NEXT such combination fails here instead of being found by an
 * audit sweep months later. Same technique that immediately surfaced four
 * defects in the markdown round-trip.
 *
 * Mapping properties live in `multiSelectionMapping.property.test.ts`; the
 * contract itself is stated once in `multiSelectionInvariants.ts`.
 *
 * @coordinates-with ../MultiSelection.ts — the structure under test
 * @coordinates-with ../rangeUtils.ts — normalizeRangesWithPrimary enforces the rules
 * @coordinates-with ./multiSelectionInvariants.ts — the contract
 * @module plugins/multiCursor/__tests__/multiSelection.property.test
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { SelectionRange } from "@tiptap/pm/state";
import { MultiSelection } from "../MultiSelection";
import { checkInvariants, formatViolations } from "./multiSelectionInvariants";
import { build, docArb, makeDoc, rangesArb, PROPERTY_TIMEOUT_MS } from "./multiSelectionArbitraries";

describe("MultiSelection — construction invariants (property-based)", () => {
  it("normalizes ANY set of ranges into a valid selection", () => {
    fc.assert(
      fc.property(
        docArb.chain((doc) =>
          rangesArb(doc).chain((ranges) =>
            fc.integer({ min: 0, max: Math.max(0, ranges.length - 1) }).map((primary) => ({ doc, ranges, primary })),
          ),
        ),
        ({ doc, ranges, primary }) => {
          const selection = build(ranges, primary);
          expect(
            selection,
            `constructor threw: ${selection instanceof Error ? selection.message : ""}`,
          ).not.toBeInstanceOf(Error);
          if (selection instanceof Error) return;
          // Construction sorts and dedupes but does NOT merge (merge = false),
          // so overlap is not asserted here — see the dedicated test below.
          const violations = checkInvariants(selection, doc, { requireMerged: false });
          expect(violations.length === 0 ? "" : `\n${formatViolations(violations)}\n`).toBe("");
        },
      ),
      { numRuns: 300 },
    );
  }, PROPERTY_TIMEOUT_MS);

  it("range shape is idempotent — rebuilding preserves the ranges", () => {
    fc.assert(
      fc.property(
        docArb.chain((doc) => rangesArb(doc).map((ranges) => ({ doc, ranges }))),
        ({ doc, ranges }) => {
          const once = build(ranges, 0);
          if (once instanceof Error) return;
          const twice = build([...once.ranges], once.primaryIndex);
          if (twice instanceof Error) throw twice;

          // Ranges only. primaryIndex is NOT stable under reconstruction when
          // ranges overlap — pinned by the known-defect test below rather than
          // hidden here.
          const shape = (s: MultiSelection): string =>
            s.ranges.map((r) => `${r.$from.pos}-${r.$to.pos}`).join(",");
          expect(shape(twice)).toBe(shape(once));
          expect(checkInvariants(twice, doc, { requireMerged: false })).toEqual([]);
        },
      ),
      { numRuns: 300 },
    );
  }, PROPERTY_TIMEOUT_MS);

  /**
   * Guards #311 directly.
   *
   * The constructor takes an optional `backward` array — one direction flag per
   * range — but normalization can CHANGE the range count by deduping, so an
   * array sized for the pre-normalization list would leave every flag after the
   * gap describing the wrong range. The constructor defends by discarding a
   * mismatched array. Generating deliberately wrong lengths is what makes this
   * reachable: a mutation removing the length check survives every property that
   * never supplies one (verified — it did, until this property was added).
   */
  it("never keeps a backward array whose length disagrees with the ranges (#311)", () => {
    fc.assert(
      fc.property(
        docArb.chain((doc) =>
          rangesArb(doc).chain((ranges) =>
            fc.array(fc.boolean(), { minLength: 0, maxLength: 10 }).map((backward) => ({ doc, ranges, backward })),
          ),
        ),
        ({ doc, ranges, backward }) => {
          const selection = build(ranges, 0, backward);
          if (selection instanceof Error) return;
          const violations = checkInvariants(selection, doc, { requireMerged: false });
          expect(
            violations.length === 0
              ? ""
              : `\n  backward had ${backward.length} entries for ${ranges.length} input range(s):\n${formatViolations(violations)}\n`,
          ).toBe("");
        },
      ),
      { numRuns: 300 },
    );
  }, PROPERTY_TIMEOUT_MS);

  it("clamps an out-of-range primaryIndex instead of addressing a missing range", () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 20 }), (primary) => {
        const doc = makeDoc(1, 5);
        const ranges = [
          new SelectionRange(doc.resolve(1), doc.resolve(2)),
          new SelectionRange(doc.resolve(4), doc.resolve(5)),
        ];
        const selection = build(ranges, primary);
        if (selection instanceof Error) return;
        const violations = checkInvariants(selection, doc, { requireMerged: false });
        expect(violations.length === 0 ? "" : `\nprimaryIndex=${primary}\n${formatViolations(violations)}\n`).toBe("");
      }),
      { numRuns: 200 },
    );
  }, PROPERTY_TIMEOUT_MS);

  it("rejects an empty range set rather than constructing a meaningless selection", () => {
    expect(() => new MultiSelection([], 0)).toThrow();
  });

  /**
   * Pins the constructor's merge=false contract in BOTH directions.
   *
   * This is the structure's central footgun: overlapping ranges survive
   * construction, so every mutating operation must pre-merge by hand — the seven
   * `preMerged` call sites in clipboard/enterHandling/inputHandling, each added
   * by a bug fix (#692, #762, #763). If someone makes the constructor merge,
   * this test fails and those sites can be retired deliberately rather than left
   * as dead ceremony.
   */
  it("does NOT merge overlapping ranges on construction (callers must pre-merge)", () => {
    const doc = makeDoc(1, 10);
    const selection = build(
      [
        new SelectionRange(doc.resolve(1), doc.resolve(5)),
        new SelectionRange(doc.resolve(3), doc.resolve(7)),
      ],
      0,
    );
    expect(selection).not.toBeInstanceOf(Error);
    if (selection instanceof Error) return;
    expect(selection.ranges.map((r) => [r.$from.pos, r.$to.pos])).toEqual([
      [1, 5],
      [3, 7],
    ]);
    expect(checkInvariants(selection, doc, { requireMerged: true })).not.toEqual([]);
  });

  /**
   * KNOWN DEFECT, pinned rather than asserted away.
   *
   * `normalizeRangesWithPrimary` re-locates the primary by POSITION CONTAINMENT
   * — it takes `ranges[primaryIndex].$from.pos` and picks the FIRST range
   * containing that position. When ranges overlap (which the constructor
   * permits, since it does not merge), several can contain it, so rebuilding a
   * selection from its own ranges silently moves the primary to an earlier one.
   *
   * That matters because the primary supplies `$anchor`/`$head`, which drive
   * stored marks and toolbar state: the user's active cursor changes with no
   * edit. Same family as the 2026-03-12 "multi-cursor primary tracking" fix.
   * Narrow — it needs overlapping ranges — but reachable wherever a
   * MultiSelection is rebuilt from another's ranges before a pre-merge.
   *
   * When the primary is tracked by identity rather than position, this test
   * fails and should be deleted.
   */
  it("KNOWN DEFECT: primaryIndex is not stable under reconstruction when ranges overlap", () => {
    const doc = makeDoc(2, 3);
    const first = build(
      [
        new SelectionRange(doc.resolve(2), doc.resolve(2)),
        new SelectionRange(doc.resolve(1), doc.resolve(1)),
        new SelectionRange(doc.resolve(1), doc.resolve(2)),
      ],
      0,
    );
    expect(first).not.toBeInstanceOf(Error);
    if (first instanceof Error) return;

    const rebuilt = build([...first.ranges], first.primaryIndex);
    expect(rebuilt).not.toBeInstanceOf(Error);
    if (rebuilt instanceof Error) return;

    expect(rebuilt.ranges.map((r) => [r.$from.pos, r.$to.pos])).toEqual(
      first.ranges.map((r) => [r.$from.pos, r.$to.pos]),
    );
    // The defect: identical ranges, different primary.
    expect(rebuilt.primaryIndex).not.toBe(first.primaryIndex);
  });
});
