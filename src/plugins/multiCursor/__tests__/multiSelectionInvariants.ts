/**
 * The MultiSelection invariants, stated once and checked mechanically.
 *
 * Purpose: `MultiSelection` is a data structure whose correctness is a handful
 * of structural rules — sorted, non-overlapping, in-bounds, with a valid primary
 * and a matching backward array. Almost every multi-cursor defect in this
 * project's history is one of these rules broken in a combination nobody had
 * written an example for: overlapping ranges surviving Shift+Arrow, backward
 * flags desynchronising when ranges merge (#311), collapsed cursors expanding on
 * a mapped insertion (#526), boundary-touching cursors not absorbed on Enter
 * (#763), primary index drifting after a merge.
 *
 * Naming them here lets both the property tests and any future example test
 * assert the same contract, instead of each re-deciding what "valid" means.
 *
 * @coordinates-with ../MultiSelection.ts — the structure under contract
 * @coordinates-with ../rangeUtils.ts — normalizeRangesWithPrimary enforces these
 * @module plugins/multiCursor/__tests__/multiSelectionInvariants
 */
import type { Node } from "@tiptap/pm/model";
import type { MultiSelection } from "../MultiSelection";

/** A violated invariant, described well enough to debug from the message alone. */
export interface Violation {
  invariant: string;
  detail: string;
}

/**
 * Options for what the caller is entitled to assume at this point.
 *
 * `requireMerged` — whether ranges must already be non-overlapping. This is NOT
 * always true, and that asymmetry is the structure's central footgun:
 * `MultiSelection`'s constructor calls `normalizeRangesWithPrimary` with
 * `merge = false`, so it sorts and dedupes but happily keeps `[1,5]` alongside
 * `[3,7]`. Only `map()` passes `merge = true`. Every mutating operation must
 * therefore remember to pre-merge first, which is why `clipboard.ts`,
 * `enterHandling.ts` and `inputHandling.ts` carry seven explicit `preMerged`
 * call sites — each one added by a bug fix (#692, #762, #763).
 */
export interface InvariantOptions {
  /** Require non-overlapping ranges. True after `map()`, false after construction. */
  requireMerged: boolean;
}

/**
 * Check every structural invariant of a MultiSelection against its document.
 *
 * Returns every violation rather than the first, so a failure report shows the
 * whole picture instead of one symptom at a time.
 */
export function checkInvariants(
  selection: MultiSelection,
  doc: Node,
  options: InvariantOptions = { requireMerged: true },
): Violation[] {
  const violations: Violation[] = [];
  const ranges = selection.ranges;
  const positions = ranges.map((r) => `[${r.$from.pos},${r.$to.pos}]`).join(" ");

  // 1. A MultiSelection with no ranges has no meaning; the constructor throws.
  if (ranges.length === 0) {
    violations.push({ invariant: "non-empty", detail: "selection has zero ranges" });
    return violations;
  }

  // 2. Each range must be well-formed: from never past to.
  for (const [i, r] of ranges.entries()) {
    if (r.$from.pos > r.$to.pos) {
      violations.push({
        invariant: "range-ordered",
        detail: `range ${i} is inverted: from=${r.$from.pos} > to=${r.$to.pos} in ${positions}`,
      });
    }
  }

  // 3. Every position must be inside the document. A stale position that
  //    survives mapping is the classic source of "cursor lands nowhere".
  const maxPos = doc.content.size;
  for (const [i, r] of ranges.entries()) {
    if (r.$from.pos < 0 || r.$to.pos > maxPos) {
      violations.push({
        invariant: "in-bounds",
        detail: `range ${i} escapes the document (0..${maxPos}): ${positions}`,
      });
    }
  }

  // 4. Ranges must be sorted ascending by start. Editing helpers walk them in
  //    order and corrupt the document if the order is not what they assume.
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i - 1].$from.pos > ranges[i].$from.pos) {
      violations.push({
        invariant: "sorted",
        detail: `range ${i} starts before range ${i - 1}: ${positions}`,
      });
    }
  }

  // 5a. Two cursors at the same position are one cursor. Deduping happens even
  //     without merging, so this holds unconditionally.
  for (let i = 1; i < ranges.length; i += 1) {
    const prev = ranges[i - 1];
    const cur = ranges[i];
    if (
      prev.$from.pos === prev.$to.pos &&
      cur.$from.pos === cur.$to.pos &&
      prev.$from.pos === cur.$from.pos
    ) {
      violations.push({
        invariant: "no-duplicate-cursors",
        detail: `ranges ${i - 1} and ${i} are the same empty cursor: ${positions}`,
      });
    }
  }

  // 5b. Ranges must not overlap — but ONLY where merging was requested.
  //     Touching at a boundary is allowed for non-empty ranges.
  if (options.requireMerged) {
    for (let i = 1; i < ranges.length; i += 1) {
      if (ranges[i - 1].$to.pos > ranges[i].$from.pos) {
        violations.push({
          invariant: "no-overlap",
          detail: `range ${i - 1} ends after range ${i} starts: ${positions}`,
        });
      }
    }
  }

  // 6. The primary index must address a real range — it is what ProseMirror
  //    reads for anchor/head, marks and toolbar state.
  if (selection.primaryIndex < 0 || selection.primaryIndex >= ranges.length) {
    violations.push({
      invariant: "primary-in-range",
      detail: `primaryIndex=${selection.primaryIndex} but there are ${ranges.length} ranges`,
    });
  }

  // 7. One direction flag per range. A mismatched length silently misreports
  //    selection direction for every range after the gap (#311).
  if (selection.backward.length !== ranges.length) {
    violations.push({
      invariant: "backward-length",
      detail: `backward has ${selection.backward.length} entries for ${ranges.length} ranges`,
    });
  }

  // 8. $anchor/$head must come from the PRIMARY range — those are what
  //    ProseMirror reads for marks and toolbar state, so a drift here shows the
  //    user one selection while the toolbar reports another.
  //
  //    Note $from/$to are deliberately NOT checked against the primary:
  //    ProseMirror's Selection derives them from `ranges[0]`, not from the
  //    anchor, so with a non-zero primaryIndex they legitimately differ.
  const primary = ranges[selection.primaryIndex];
  if (primary && (selection.$anchor.pos !== primary.$from.pos || selection.$head.pos !== primary.$to.pos)) {
    violations.push({
      invariant: "primary-drives-anchor",
      detail: `anchor/head is [${selection.$anchor.pos},${selection.$head.pos}] but primary range is [${primary.$from.pos},${primary.$to.pos}]`,
    });
  }

  return violations;
}

/** Render violations for a test failure message. */
export function formatViolations(violations: readonly Violation[]): string {
  return violations.map((v) => `    ${v.invariant}: ${v.detail}`).join("\n");
}
