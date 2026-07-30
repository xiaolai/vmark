/**
 * Behavioral parity ledger for the two toolbar adapters.
 *
 * Purpose: record every action whose document OUTCOME differs between WYSIWYG
 * and Source mode, with what each surface does and an assessment of which is
 * wrong.
 *
 * Why a ledger rather than fixes: these are user-visible behavior changes, and
 * choosing the right behavior for each is a product decision, not a mechanical
 * one. Recording them makes the set finite, countable and ratcheted, so it
 * shrinks instead of drifting. `adapterActionParity.test.ts` already pins the two
 * switches to one action VOCABULARY; nothing until now compared what the actions
 * DO, which is how `wysiwygAdapter.ts` could take fixes through 2026-07-30 while
 * `sourceAdapter.ts` sat untouched since 2026-02-10 with no gate ever firing.
 *
 * Entries are grouped by ROOT CAUSE. Most of the count is a handful of defects
 * repeated across an action family, so the number of entries is much larger than
 * the number of fixes needed.
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

/** Build one entry per action in a family that shares a single root cause. */
function family(
  actions: string[],
  spec: Omit<ParityDivergence, "action">,
): Record<string, ParityDivergence> {
  return Object.fromEntries(actions.map((action) => [action, { action, ...spec }]));
}

/**
 * Every known outcome divergence, keyed by action.
 *
 * A divergence NOT listed here fails the gate. A listed divergence that stops
 * occurring also fails, so a fix forces the entry's removal rather than leaving a
 * false claim behind.
 */
export const PARITY_DIVERGENCES: Record<string, ParityDivergence> = {
  // ---- Root cause 1: source mode inserts BLOCK constructs at the caret -------
  ...family(
    [
      "insertDivider", "insertBulletList", "insertOrderedList", "insertTaskList",
      "insertAlertNote", "insertAlertTip", "insertAlertImportant",
      "insertAlertWarning", "insertAlertCaution",
      "insertDetails", "insertTable", "insertTableBlock",
    ],
    {
      verdict: "source-bug",
      wysiwyg: "the block is inserted as its own node, after the current block",
      source: "the block's markdown is spliced in AT THE CARET, mid-sentence",
      rootCause: "source-inserts-block-at-caret",
      reason:
        "Source mode writes block markdown at the cursor instead of at a block boundary, so inserting a divider mid-sentence yields `The quick ---` (a paragraph ending in hyphens, not a thematic break), an alert yields `The quick > [!NOTE]` splitting the sentence, and a table or <details> opens inside a paragraph. Every one produces markdown that does not mean what the user asked for. The fix is one insertion helper that moves to a block boundary first; WYSIWYG is correct throughout. `insertDetails` additionally differs in default content (`<details open>` + 'Click to expand' versus `<details>` + 'Details'), which is a separate, smaller decision.",
    },
  ),

  // ---- Root cause 2: source mode writes LIST markers at the caret -----------
  ...family(["bulletList", "orderedList", "taskList"], {
    verdict: "source-bug",
    wysiwyg: "the line becomes a list item — `- The quick brown fox`",
    source: "the marker lands at the caret — `The quick - brown fox`",
    rootCause: "source-list-marker-at-caret",
    reason:
      "The list toggle inserts its marker at the cursor rather than at the start of the line, so toggling a list mid-sentence corrupts the sentence; with a range selection it replaces the selected word outright. Closely related to root cause 1 but a different call path. WYSIWYG is correct.",
  }),

  // ---- Root cause 3: source heading run added over an existing marker -------
  ...family(["heading:1", "heading:3", "heading:6"], {
    verdict: "source-bug",
    wysiwyg: "list item → `# text`; blockquote → `> # text` (quote preserved)",
    source: "list item → `# - text`; blockquote → `# > text` (quote destroyed)",
    rootCause: "source-heading-keeps-block-marker",
    reason:
      "setSourceHeadingLevel prepends the `#` run to the raw line without stripping the block marker already there. A list item becomes a heading whose text begins `- `, and a blockquote becomes a HEADING CONTAINING a literal `>` — the quote is gone. WYSIWYG converts the block and keeps the quote wrapper. One fix retires all three entries.",
  }),

  // ---- Root cause 4: the two surfaces invert the heading direction ----------
  ...family(["increaseHeading", "decreaseHeading"], {
    verdict: "both-defensible",
    wysiwyg: "increase → more prominent (`level - 1`): paragraph → H6, H3 → H2",
    source: "increase → higher number (`level + 1`): paragraph → H1, H3 → H4",
    rootCause: "inverted-heading-direction",
    reason:
      "wysiwygAdapterFormatting and sourceBlockActions read the word 'increase' in opposite directions. Each is internally coherent and each pairs correctly with its own inverse, so neither is wrong in isolation — which is exactly why no single-surface test could catch it. From an H3 the same toolbar button gives H2 in one mode and H4 in the other. Decide which reading the menu label means, then flip one pair; the two entries must move together.",
  }),

  // ---- Root cause 5: source line operations are table-unaware ---------------
  ...family(["moveLineUp", "moveLineDown", "joinLines"], {
    verdict: "source-bug",
    wysiwyg: "no-op inside a table — the structure is preserved",
    source: "rows are reordered or merged across the delimiter row, breaking the table",
    rootCause: "source-line-ops-table-unaware",
    reason:
      "In source mode a table is just lines, so moveLineUp can hoist a body row above the `| --- |` delimiter and joinLines can fuse two rows into `| a | b | | c | d |`. Both leave markdown that no longer parses as a table. WYSIWYG declines the operation instead. Either teach the source line ops about table structure or decline inside one.",
  }),

  // ---- Root cause 6: WYSIWYG deleteLine deletes the whole table -------------
  deleteLine: {
    action: "deleteLine",
    verdict: "wysiwyg-bug",
    wysiwyg: "with the caret in a table cell, the ENTIRE TABLE is deleted",
    source: "only the current row is deleted, leaving a valid table",
    rootCause: "wysiwyg-deleteline-deletes-table",
    reason:
      "The worst divergence found: deleteLine with the cursor in a table cell empties the document in WYSIWYG mode, and useTiptapFlush persists that on the next edit. Source deletes one row, which is what the action name implies. Source is correct.",
  },

  // ---- Root cause 7: source alignLeft omits the alignment colon -------------
  ...family(["alignLeft", "alignAllLeft"], {
    verdict: "source-bug",
    wysiwyg: "writes an explicit `:---` marker",
    source: "rewrites the dash run but adds no colon, leaving `---`",
    rootCause: "source-alignleft-omits-colon",
    reason:
      "Left is markdown's default alignment, so source treats 'align left' as 'remove alignment'. The result is that the column carries no explicit alignment, the toolbar's active state disagrees between modes, and a later alignment change starts from a different place. alignCenter and alignRight agree in both surfaces, which is why this shows up only on the left variants.",
  }),

  // ---- Root cause 8: source formatCJK does nothing on a range --------------
  formatCJK: {
    action: "formatCJK",
    verdict: "source-bug",
    wysiwyg: "`中文段落 brown 混排 English 文本` — spaces inserted at CJK/Latin boundaries",
    source: "unchanged",
    rootCause: "source-formatcjk-noop-on-range",
    reason:
      "CJK formatting is a headline feature, and in source mode the toolbar action is a no-op on a range selection while WYSIWYG applies it. Whatever the intended scope is (selection, line, or document), both surfaces must agree.",
  },

  // ---- Root cause 9: blockquote-inside-table mishandled by both ------------
  insertBlockquote: {
    action: "insertBlockquote",
    verdict: "both-wrong",
    wysiwyg: "clears the cell's content, leaving an empty cell",
    source: "prepends `> ` to the row line, breaking the table",
    rootCause: "blockquote-in-table-unhandled",
    reason:
      "Neither surface handles 'quote this' with the caret inside a table cell: WYSIWYG destroys the cell text, source destroys the table. The action should be unavailable there — which is an enable-rule fix in `enableRules.ts` rather than an adapter fix, so it also needs a row in the toolbar-state tests.",
  },

  // ---- Independent divergences ---------------------------------------------
  duplicateLine: {
    action: "duplicateLine",
    verdict: "wysiwyg-bug",
    wysiwyg: "two PARAGRAPHS — a blank line separates the copies",
    source: "two LINES within one paragraph",
    rootCause: "duplicateline-block-vs-line",
    reason:
      "The action is named duplicateLine and source duplicates a line. WYSIWYG duplicates the whole block and produces a second paragraph, so the documents genuinely differ — one block versus two. Source matches the name.",
  },
  insertCodeBlock: {
    action: "insertCodeBlock",
    verdict: "both-defensible",
    wysiwyg: "wraps the current block: ```` ```plaintext\\n…\\n``` ````",
    source: "inserts an EMPTY fence at the caret, splitting the line",
    rootCause: "insertcodeblock-convert-vs-insert",
    reason:
      "Two readings: WYSIWYG converts the block to code, source inserts a new empty code block. Source's output is broken markdown when the caret is mid-line (root cause 1 again), but which reading the shared button should mean is a product decision.",
  },
  outdent: {
    action: "outdent",
    verdict: "both-defensible",
    wysiwyg: "a top-level list item is lifted OUT of the list, becoming a paragraph",
    source: "a top-level list item is left unchanged",
    rootCause: "outdent-at-outermost-level",
    reason:
      "Disagreement about what outdent means at the outermost level: WYSIWYG treats it as 'remove one level of structure', source as 'no level left to remove'. Both are common editor conventions, so this needs a decision rather than a fix.",
  },
};

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
 * History: 12 at 33 actions compared; 31 at 63, after coverage expanded from 33
 * to 63 and `MAX_UNCOVERED_ACTIONS` fell from 50 to 20.
 *
 * 31 entries is far fewer than 31 fixes — they collapse into 9 root causes, and
 * the largest (`source-inserts-block-at-caret`, 12 actions) is one insertion
 * helper.
 */
export const MAX_PARITY_DIVERGENCES = 31;
