// @vitest-environment node
/**
 * Property-based invariant tests for MultiSelection — MAPPING.
 *
 * Purpose: `map()` is where multi-cursor state meets document change, and where
 * most of this package's 41 fix commits landed: collapsed cursors expanding on a
 * mapped insertion (#526), backward flags desynchronising when mapping merges
 * ranges (#311), boundary-touching cursors not absorbed (#763), stale positions
 * escaping the document.
 *
 * Unlike construction, `map()` passes `merge = true`, so the full contract —
 * including non-overlap — must hold afterwards. These properties generate a
 * document, an arbitrary set of ranges, and an arbitrary insertion, then assert
 * the mapped selection is still structurally valid.
 *
 * @coordinates-with ../MultiSelection.ts — map()
 * @coordinates-with ./multiSelectionInvariants.ts — the contract
 * @coordinates-with ./multiSelectionArbitraries.ts — shared generators
 * @module plugins/multiCursor/__tests__/multiSelectionMapping.property.test
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { SelectionRange } from "@tiptap/pm/state";
import type { MultiSelection } from "../MultiSelection";
import { checkInvariants, formatViolations } from "./multiSelectionInvariants";
import {
  build,
  clamp,
  docArb,
  insertText,
  makeDoc,
  rangesArb,
  PROPERTY_TIMEOUT_MS,
} from "./multiSelectionArbitraries";

describe("MultiSelection — mapping invariants (property-based)", () => {
  it("map() preserves every invariant across an arbitrary insertion", () => {
    fc.assert(
      fc.property(
        docArb.chain((doc) =>
          rangesArb(doc).chain((ranges) =>
            fc
              .tuple(
                fc.integer({ min: 0, max: Math.max(0, ranges.length - 1) }),
                fc.integer({ min: 1, max: Math.max(1, doc.content.size - 1) }),
                fc.integer({ min: 1, max: 5 }),
              )
              .map(([primary, at, len]) => ({ doc, ranges, primary, at, len })),
          ),
        ),
        ({ doc, ranges, primary, at, len }) => {
          const selection = build(ranges, primary);
          if (selection instanceof Error) return;

          const edit = insertText(doc, clamp(at, doc), len);
          if (!edit) return; // not a valid edit for this document shape

          const mapped = selection.map(edit.doc, edit.mapping) as MultiSelection;
          const violations = checkInvariants(mapped, edit.doc);
          expect(
            violations.length === 0
              ? ""
              : `\n  inserting ${len} char(s) at ${at} broke the selection:\n${formatViolations(violations)}\n`,
          ).toBe("");
        },
      ),
      { numRuns: 300 },
    );
  }, PROPERTY_TIMEOUT_MS);

  it("map() keeps a collapsed cursor collapsed when text is inserted elsewhere (#526)", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 1, max: 8 }),
          fc.integer({ min: 1, max: 8 }),
          fc.integer({ min: 1, max: 4 }),
        ),
        ([cursor, at, len]) => {
          const doc = makeDoc(1, 10);
          const pos = clamp(cursor, doc);
          const selection = build([new SelectionRange(doc.resolve(pos), doc.resolve(pos))], 0);
          if (selection instanceof Error) return;

          const insertAt = clamp(at, doc);
          const edit = insertText(doc, insertAt, len);
          if (!edit) return;

          const mapped = selection.map(edit.doc, edit.mapping) as MultiSelection;
          const r = mapped.ranges[0];
          expect(
            r.$from.pos === r.$to.pos
              ? ""
              : `\n  a collapsed cursor at ${pos} became [${r.$from.pos},${r.$to.pos}] after inserting ${len} char(s) at ${insertAt}\n`,
          ).toBe("");
        },
      ),
      { numRuns: 300 },
    );
  }, PROPERTY_TIMEOUT_MS);

  it("keeps the backward array aligned with ranges through map() (#311)", () => {
    fc.assert(
      fc.property(
        docArb.chain((doc) =>
          rangesArb(doc).chain((ranges) =>
            fc
              .tuple(fc.array(fc.boolean(), { minLength: 0, maxLength: 10 }), fc.integer({ min: 1, max: 5 }))
              .map(([backward, len]) => ({ doc, ranges, backward, len })),
          ),
        ),
        ({ doc, ranges, backward, len }) => {
          const selection = build(ranges, 0, backward);
          if (selection instanceof Error) return;
          const edit = insertText(doc, clamp(1, doc), len);
          if (!edit) return;
          const mapped = selection.map(edit.doc, edit.mapping) as MultiSelection;
          const violations = checkInvariants(mapped, edit.doc);
          expect(violations.length === 0 ? "" : `\n${formatViolations(violations)}\n`).toBe("");
        },
      ),
      { numRuns: 300 },
    );
  }, PROPERTY_TIMEOUT_MS);

  it("map() merges overlapping ranges that construction left alone", () => {
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
    expect(selection.ranges).toHaveLength(2);

    const edit = insertText(doc, 9, 1);
    expect(edit).not.toBeNull();
    if (!edit) return;

    const mapped = selection.map(edit.doc, edit.mapping) as MultiSelection;
    expect(mapped.ranges).toHaveLength(1);
    expect(checkInvariants(mapped, edit.doc)).toEqual([]);
  });
});
