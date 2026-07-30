/**
 * Behavioral parity ledger for the two toolbar adapters.
 *
 * Purpose: record every action whose document OUTCOME differs between WYSIWYG
 * and Source mode, with what each surface does and an assessment of which is
 * wrong.
 *
 * THE LEDGER IS EMPTY. Every one of the 64 compared actions now produces the
 * same document in both surfaces, across all nine fixtures and both selection
 * shapes. It started at 31 declared divergences across 9 root causes.
 *
 * An empty ledger is not the end of the mechanism, it is the point of it: with
 * `MAX_PARITY_DIVERGENCES` at 0, the NEXT divergence cannot be declared away. It
 * has to be fixed, or the ceiling has to be raised in a commit that says why.
 *
 * A ledger existed at all because these are user-visible behaviour changes and
 * choosing the right one per action is a product decision, not a mechanical one.
 * Recording them made the set finite, countable and ratcheted, so it shrank
 * instead of drifting. `adapterActionParity.test.ts` already pins the two
 * switches to one action VOCABULARY; nothing before this compared what the
 * actions DO, which is how `wysiwygAdapter.ts` could take fixes through
 * 2026-07-30 while `sourceAdapter.ts` sat untouched since 2026-02-10 with no
 * gate ever firing.
 *
 * If you need to add an entry back, group by ROOT CAUSE: historically most of
 * the count was a handful of defects repeated across an action family, so the
 * number of entries ran far ahead of the number of fixes needed.
 *
 * @coordinates-with surfaces.ts — runs both real surfaces
 * @coordinates-with behavioralParity.test.ts — the gate
 * @coordinates-with parityFixtures.ts — the coverage partition
 * @module plugins/toolbarActions/__tests__/parity/parityLedger
 */

/**
 * `source-bug` / `wysiwyg-bug` — one surface is clearly wrong; the other is the
 *   behavior to converge on.
 * `both-wrong` — both surfaces mishandle the case, differently.
 * `both-defensible` — different, internally coherent readings of the action.
 *   Needs a product decision before either is "fixed".
 */
type ParityVerdict = "source-bug" | "wysiwyg-bug" | "both-wrong" | "both-defensible";

export interface ParityDivergence {
  action: string;
  verdict: ParityVerdict;
  /** What WYSIWYG produces. */
  wysiwyg: string;
  /** What Source produces. */
  source: string;
  /** Shared root-cause identifier — one fix should retire every action sharing it. */
  rootCause: string;
  /** The assessment, and what converging would mean. */
  reason: string;
}

/**
 * Every known outcome divergence, keyed by action. Currently none.
 *
 * A divergence NOT listed here fails the gate. A listed divergence that stops
 * occurring also fails, so a fix forces the entry's removal rather than leaving a
 * false claim behind.
 */
export const PARITY_DIVERGENCES: Record<string, ParityDivergence> = {};

/**
 * Ceiling on known parity divergences.
 *
 * **This number may only rise in a change that also LOWERS
 * `MAX_UNCOVERED_ACTIONS`** — i.e. when newly measured ground reveals
 * pre-existing divergence. At fixed coverage it ratchets DOWN only: converge a
 * pair, delete its entry, lower this number. A rise without a coverage
 * expansion means the two surfaces drifted apart again, which is what this gate
 * exists to catch.
 *
 * History:
 *   12 — at 33 actions compared.
 *   31 — at 63 actions, after `MAX_UNCOVERED_ACTIONS` fell from 50 to 20.
 *   31 — `deleteLine` CONVERGED (the WYSIWYG line operations now resolve the
 *        real line unit instead of the top-level block, so deleting a table row
 *        no longer deletes the table); `removeList` newly surfaced once the
 *        fixtures grew multi-line structures. One out, one in.
 *   30 — `decreaseHeading` CONVERGED: WYSIWYG adopted the numeric reading of
 *        "heading level", so both surfaces now step the same direction.
 *        `increaseHeading` stayed, reclassified — its direction is fixed too,
 *        and what remains is the source-side marker damage it shares with
 *        `heading:N`.
 *   28 — `alignLeft` and `alignAllLeft` CONVERGED: source now writes an
 *        explicit `:---` when left alignment is REQUESTED, while table
 *        re-formatting still leaves an unaligned column alone.
 *   27 — `outdent` CONVERGED: WYSIWYG stopped lifting a TOP-LEVEL item out of
 *        its list, which is what Remove List and the toggles are for.
 *   18 — `duplicateLine` CONVERGED: a plain paragraph now duplicates with an
 *        explicit HARD BREAK on both surfaces, so one block shows two lines
 *        rather than WYSIWYG making a second paragraph and Source a soft break
 *        that renders as one. Headings, list items and table rows keep
 *        duplicating as siblings.
 *   19 — `moveLineUp`, `moveLineDown` and `joinLines` CONVERGED: source line
 *        operations now treat a blank line as a block separator rather than
 *        something to swap with, refuse to hoist a nested item past its
 *        parent, and decline a join that would fuse two blocks.
 *   22 — `insertDivider` CONVERGED once source blocks inherited the enclosing
 *        structure's continuation prefix, so one dropped inside a list item or
 *        a quote stays there instead of ending it.
 *   23 — the `block-conversion-inside-table-cell` family CONVERGED:
 *        `heading:1/3/6` and `increaseHeading` are refused inside a cell by
 *        the shared availability policy, so there is no outcome left to
 *        disagree about. `insertBlockquote` stayed, reclassified — its table
 *        half is gone and a separate list-scope defect remains.
 *
 *   24 — the block-INSERT family CONVERGED, and the ledger had mis-described
 *        what was left in it. The stated remainder was "template content";
 *        behind that sat a DATA-LOSS bug (the builders folded in the selected
 *        characters while replacing whole lines, deleting the rest of the
 *        line) and a duplicate implementation of the list toggles that
 *        prepended a second marker. Shared `blockTemplates`, `blockSpan` and
 *        `wrapBlocks` retired the family.
 *   25 — the LAST eight CONVERGED, on one rule per surface. Source's code
 *        block, blockquote and CJK actions now reach whole blocks and strip
 *        block markup, so fencing `### Title` yields `Title` and quoting a
 *        list keeps it one list. WYSIWYG's range path stopped over-reaching
 *        when the selection sits inside a single list item, and its blockquote
 *        wraps the outermost list instead of shattering one. Source's
 *        toggle-off now outdents a nested item by one level, as WYSIWYG and
 *        VMark's own docs say it should.
 *
 * 0 entries. The ceiling is 0, so the next divergence must be FIXED rather than
 * declared — or the ceiling raised in a commit that argues for it.
 */
export const MAX_PARITY_DIVERGENCES = 0;
