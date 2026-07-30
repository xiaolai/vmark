/**
 * Behavioral parity ledger for the two toolbar adapters.
 *
 * Purpose: record every action whose OUTCOME differs between WYSIWYG and Source
 * mode, with what each surface does and an assessment of which is wrong.
 *
 * Why a ledger rather than fixes: the divergences are user-visible behavior
 * changes, and choosing the correct behavior for each is a product decision, not
 * a mechanical one. Recording them makes the set finite, countable and
 * ratcheted, so it shrinks instead of drifting. `adapterActionParity.test.ts`
 * already pins the two switches to one action VOCABULARY; nothing until now
 * compared what the actions actually DO, which is how `wysiwygAdapter.ts` could
 * take fixes through 2026-07-30 while `sourceAdapter.ts` sat untouched since
 * 2026-02-10 with no gate ever firing.
 *
 * @coordinates-with surfaces.ts — runs both real surfaces
 * @coordinates-with behavioralParity.test.ts — the gate
 * @coordinates-with ../../adapterActions.ts — the vocabulary contract this complements
 * @module plugins/toolbarActions/__tests__/parity/parityLedger
 */

/**
 * `source-bug` / `wysiwyg-bug` — one surface is clearly wrong; the other is the
 *   behavior to converge on.
 * `both-defensible` — the surfaces implement different, internally coherent
 *   readings of the action. Needs a product decision before either is "fixed".
 */
export type ParityVerdict = "source-bug" | "wysiwyg-bug" | "both-defensible";

export interface ParityDivergence {
  /** Action id, exactly as the adapters route it. */
  action: string;
  verdict: ParityVerdict;
  /** What WYSIWYG produces. */
  wysiwyg: string;
  /** What Source produces. */
  source: string;
  /** The assessment, and what converging would mean. */
  reason: string;
}

/**
 * Every known outcome divergence, keyed by action.
 *
 * A divergence NOT listed here fails the gate. A listed divergence that stops
 * occurring also fails, so a fix forces the entry's removal rather than leaving
 * a false claim behind.
 */
export const PARITY_DIVERGENCES: Record<string, ParityDivergence> = {
  increaseHeading: {
    action: "increaseHeading",
    verdict: "both-defensible",
    wysiwyg: "paragraph → H6, then H6→H5→…→H1 (`level - 1`)",
    source: "paragraph → H1, then H1→H2→…→H6 (`level + 1`)",
    reason:
      "The two surfaces use opposite conventions for the word 'increase'. wysiwygAdapterFormatting.increaseHeadingLevel treats it as 'more prominent' and walks the level DOWN; sourceBlockActions.increaseHeadingLevel treats it as 'higher number' and walks it UP. Each is internally coherent and each pairs correctly with its own decreaseHeading, so neither is wrong in isolation — which is exactly why no single-surface test could catch it. From an H3 the same button gives H2 in one mode and H4 in the other. Converging requires deciding which reading the menu label means, then flipping one pair.",
  },
  bulletList: {
    action: "bulletList",
    verdict: "source-bug",
    wysiwyg: "`- The quick brown fox` — the line becomes a list item",
    source: "`The quick - brown fox` — the marker is inserted AT THE CURSOR",
    reason:
      "Source mode writes the bullet marker at the caret instead of at the start of the line, so toggling a list mid-sentence corrupts the text rather than converting the block. With a range selection it also replaces the selected word. WYSIWYG is correct.",
  },
  orderedList: {
    action: "orderedList",
    verdict: "source-bug",
    wysiwyg: "`1. The quick brown fox`",
    source: "`The quick 1. brown fox` — marker at the cursor",
    reason: "Same defect as bulletList: marker inserted at the caret rather than at the line start.",
  },
  taskList: {
    action: "taskList",
    verdict: "source-bug",
    wysiwyg: "`- [ ] The quick brown fox`",
    source: "`The quick - [ ] brown fox` — marker at the cursor",
    reason: "Same defect as bulletList: marker inserted at the caret rather than at the line start.",
  },
  insertDivider: {
    action: "insertDivider",
    verdict: "source-bug",
    wysiwyg: "splits the paragraph and puts a `---` block between the halves",
    source: "`The quick ---\\nbrown fox` — `---` inserted inline",
    reason:
      "Source mode inserts the rule inline, producing `The quick ---`, which is not a thematic break at all — it is a paragraph ending in three hyphens. WYSIWYG splits the block correctly. Note WYSIWYG has its own wart here: with a range selection it emits `&#x20;` character entities around the split, which leak into the saved markdown.",
  },
  insertCodeBlock: {
    action: "insertCodeBlock",
    verdict: "both-defensible",
    wysiwyg: "wraps the current block: ```` ```plaintext\\nThe quick brown fox\\n``` ````",
    source: "inserts an EMPTY fence at the caret, splitting the line",
    reason:
      "Two different readings: WYSIWYG converts the block to code, Source inserts a new empty code block. Source's output is broken markdown when the caret is mid-line (the fence opens inside a paragraph), so at minimum it should insert on its own lines. Which reading is right is a product decision — 'insert' argues for Source's, the shared toolbar button argues for one answer.",
  },
  decreaseHeading: {
    action: "decreaseHeading",
    verdict: "both-defensible",
    wysiwyg: "H3 → H4 (`level + 1`)",
    source: "H3 → H2 (`level - 1`)",
    reason:
      "The mirror image of increaseHeading, and the same root cause: the two surfaces disagree on which direction 'decrease' travels. Fix both pairs together or the modes stay inconsistent.",
  },
  "heading:1": {
    action: "heading:1",
    verdict: "source-bug",
    wysiwyg: "list item → `# text`; blockquote → `> # text`",
    source: "list item → `# - text`; blockquote → `# > text`",
    reason:
      "setSourceHeadingLevel prepends `#` to the raw line without removing the block marker already there, so a list item becomes a heading whose text begins `- `, and a blockquote becomes a HEADING containing a literal `>` — the quote is destroyed. WYSIWYG converts the block properly and keeps the quote wrapper. Shared root cause with heading:3 and heading:6.",
  },
  "heading:3": {
    action: "heading:3",
    verdict: "source-bug",
    wysiwyg: "list item → `### text`; blockquote → `> ### text`",
    source: "list item → `### - text`; blockquote → `### > text`",
    reason: "Same defect as heading:1 — the existing block marker is not stripped before the `#` run is added.",
  },
  "heading:6": {
    action: "heading:6",
    verdict: "source-bug",
    wysiwyg: "list item → `###### text`; blockquote → `> ###### text`",
    source: "list item → `###### - text`; blockquote → `###### > text`",
    reason: "Same defect as heading:1 — the existing block marker is not stripped before the `#` run is added.",
  },
  outdent: {
    action: "outdent",
    verdict: "both-defensible",
    wysiwyg: "a top-level list item is lifted OUT of the list, becoming a paragraph",
    source: "a top-level list item is left unchanged",
    reason:
      "Disagreement about what outdent means at the outermost level: WYSIWYG treats it as 'remove one level of structure', Source as 'no level left to remove'. Both are common editor conventions, so this needs a decision rather than a fix.",
  },
  duplicateLine: {
    action: "duplicateLine",
    verdict: "wysiwyg-bug",
    wysiwyg: "two PARAGRAPHS (blank line between the copies)",
    source: "two LINES within one paragraph",
    reason:
      "The action is named duplicateLine and Source duplicates a line. WYSIWYG duplicates the whole block and yields a second paragraph, so the documents genuinely differ — one block versus two. Source matches the name.",
  },
};

/**
 * Ceiling on known parity divergences.
 *
 * 12 is the FIRST measurement of a surface nothing had ever measured, not an
 * allowance that grew. It ratchets DOWN only from here: converge a pair, delete
 * its entry, lower this number. Never raise it — a new divergence means the two
 * surfaces drifted again, which is what this gate exists to catch.
 *
 * Three of the twelve (`heading:1`, `heading:3`, `heading:6`) share one root
 * cause in `setSourceHeadingLevel`, so a single fix should retire three entries.
 * Two more (`increaseHeading`, `decreaseHeading`) are one inverted convention and
 * must be decided together.
 */
export const MAX_PARITY_DIVERGENCES = 12;
