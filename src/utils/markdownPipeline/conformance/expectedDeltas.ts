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
 *   - Each entry is KEYED on a stable fixture ID and a node path, so it cannot
 *     accidentally match a different divergence.
 *   - `reason` is required. A delta nobody can explain is a bug that has been
 *     written down rather than fixed.
 *
 * @coordinates-with fixtures.ts — the stable IDs keyed on here
 * @coordinates-with parserConformance.test.ts — the gate that consumes this
 * @module utils/markdownPipeline/conformance/expectedDeltas
 */
import type { Divergence } from "./semanticProjection";

export interface ExpectedDelta {
  /** Stable fixture ID from `fixtures.ts`. */
  fixtureId: string;
  /** Node path, or a prefix — see `matches`. */
  path: string;
  /** Match any divergence at or below `path`, for whole-subtree differences. */
  subtree?: boolean;
  kind: Divergence["kind"];
  /** Attribute name, or a `type`/`child-count` detail. Omit to match any. */
  detail?: string;
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
    path: "root",
    subtree: true,
    kind: "type",
    reason:
      "THE repair. An indented lone list marker (`  -`) is a setext underline " +
      "to CommonMark, so `document` runs remarkDisableSetextHeadings and reads " +
      "a paragraph plus a list, while `source-position` reads the heading the " +
      "text literally spells. Both are correct for their contract: one serves " +
      "the editor, the other serves offsets into the text as written. " +
      "MEASURED: the divergence is type-only (paragraph vs heading) — the " +
      "block COUNT is the same, which a declaration written from the " +
      "description rather than the output got wrong until the gate said so.",
  },
] as const;

/** Whether `delta` accounts for `divergence` in `fixtureId`. */
export function matches(
  delta: ExpectedDelta,
  divergence: Divergence,
  fixtureId: string
): boolean {
  if (delta.fixtureId !== fixtureId) return false;
  if (delta.kind !== divergence.kind) return false;
  if (delta.detail !== undefined && delta.detail !== divergence.detail) return false;
  return delta.subtree
    ? divergence.path === delta.path || divergence.path.startsWith(`${delta.path}.`)
    : divergence.path === delta.path;
}
