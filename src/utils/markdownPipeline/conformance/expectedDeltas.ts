/**
 * Purpose: the DECLARED differences between the `document` and
 * `source-position` projections.
 *
 * The two modes are not meant to agree everywhere. `document` conditionally
 * loads plugins and repairs one misparse; `source-position` loads everything
 * and repairs nothing, because its contract is the offsets of the text as
 * written. Every place that shows up as a divergence is listed here.
 *
 * Key decisions:
 *   - AN UNMATCHED DECLARATION FAILS AS LOUDLY AS AN UNDECLARED DIVERGENCE.
 *     A delta list that tolerates stale entries decays into a suppression file:
 *     the entry stays after the behaviour it described is gone, and the next
 *     real divergence at that path is silently absorbed.
 *   - Each entry pins fixture ID, EXACT path, kind, detail AND both values.
 *     Anything looser is a wildcard: a `subtree` match with no detail
 *     suppressed every future type divergence in its fixture, and matching
 *     without values accepted the two modes differing in an entirely new way
 *     at a path where they were merely known to differ.
 *   - `reason` is required. A delta nobody can explain is a bug that has been
 *     written down rather than fixed.
 *
 * @coordinates-with fixtures.ts — the stable IDs keyed on here
 * @coordinates-with parserConformance.test.ts — the gate that consumes this
 * @module utils/markdownPipeline/conformance/expectedDeltas
 */
import { sameValue, type Divergence } from "./semanticProjection";

export interface ExpectedDelta {
  /** Stable fixture ID from `fixtures.ts`. */
  fixtureId: string;
  /** EXACT node path. There is no subtree form — see the note below. */
  path: string;
  kind: Divergence["kind"];
  /** Attribute name, or the `type`/`child-count` detail. Required. */
  detail: string;
  /** The value each side must produce. A declaration that does not pin these
   *  accepts ANY change at that path and kind. */
  documentValue: unknown;
  sourcePositionValue: unknown;
  reason: string;
}

/**
 * The declared deltas.
 *
 * Deliberately SHORT. The two modes are supposed to agree on semantics; a long
 * list here would mean the modes have diverged into two dialects, which is the
 * outcome WI-3.1 exists to prevent.
 */
export const EXPECTED_DELTAS: readonly ExpectedDelta[] = [
  {
    fixtureId: "cm-bare-list-marker",
    path: "root.children[0]",
    kind: "type",
    detail: "paragraph vs heading",
    documentValue: "paragraph",
    sourcePositionValue: "heading",
    reason:
      "THE repair. An indented lone list marker (`  -`) is a setext underline " +
      "to CommonMark, so `document` runs remarkDisableSetextHeadings and reads " +
      "a paragraph plus a list, while `source-position` reads the heading the " +
      "text literally spells. Both are correct for their contract: one serves " +
      "the editor, the other serves offsets into the text as written. " +
      "MEASURED: the divergence is type-only — the block COUNT is the same, " +
      "which a declaration written from the description rather than the " +
      "output got wrong until the gate said so. Declared at the EXACT path: " +
      "an earlier `path: \"root\", subtree: true` with no detail suppressed " +
      "every future type divergence anywhere in this fixture, which is the " +
      "suppression-file failure this file's own header warns about.",
  },
  {
    fixtureId: "cm-bare-list-marker",
    path: "root.children[0].children[0]",
    kind: "attribute",
    detail: "value",
    documentValue: "text\n-",
    sourcePositionValue: "text",
    reason:
      "The same repair, one level down — and it was INVISIBLE until the diff " +
      "stopped short-circuiting on a type mismatch. `document` reads a " +
      "paragraph whose text is `text`, `source-position` a setext heading " +
      "whose text is `text` alone. CORRECTED: an earlier version of this " +
      "reason claimed both sides read `text`, written from expectation rather " +
      "than output. The values are pinned below so the claim cannot drift " +
      "from them again.",
  },
] as const;

/** Whether `delta` accounts for `divergence` in `fixtureId`. */
export function matches(
  delta: ExpectedDelta,
  divergence: Divergence,
  fixtureId: string
): boolean {
  if (delta.fixtureId !== fixtureId) return false;
  if (delta.path !== divergence.path) return false;
  if (delta.kind !== divergence.kind) return false;
  if (delta.detail !== divergence.detail) return false;
  // VALUES too, structurally. Matching on path and kind alone accepted any
  // change there — the declaration said "these two modes differ here", then
  // tolerated them differing in a completely new way. `JSON.stringify` was the
  // first attempt and equates NaN with null and `[undefined]` with `[null]`,
  // so a declaration could still over-match; it also throws on a cycle.
  return (
    sameValue(delta.documentValue, divergence.documentValue) &&
    sameValue(delta.sourcePositionValue, divergence.sourcePositionValue)
  );
}
