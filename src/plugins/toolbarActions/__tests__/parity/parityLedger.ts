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
  // ---- Root cause 1: where a newly inserted block goes ---------------------
  ...family(
    [
      "insertDivider", "insertBulletList", "insertOrderedList", "insertTaskList",
      "insertAlertNote", "insertAlertTip", "insertAlertImportant",
      "insertAlertWarning", "insertAlertCaution",
      "insertDetails", "insertTable", "insertTableBlock",
    ],
    {
      verdict: "source-bug",
      wysiwyg: "appends after the current block; nests the new block where the cursor is",
      source: "appends on the next line, always at the TOP level, with different templates",
      rootCause: "block-insert-template-and-nesting",
      reason:
        "Two rounds of fixes landed here and neither claim below is the original one. First, source stopped splicing block markdown at the caret — it used to yield `The quick ---` (a paragraph ending in hyphens, not a thematic break) and `The quick > [!NOTE]` splitting a sentence. Then WYSIWYG's divider and table stopped SPLITTING the paragraph; both now append after the current block via `blockInsertPos`, the helper alerts and details already used. Placement in a plain paragraph therefore agrees. Three differences remain, all narrower than what they replaced: templates differ (WYSIWYG inserts an empty 2x2 table, source inserts `Header 1`/`Cell 1` placeholders; `<details open>` + 'Click to expand' versus `<details>` + 'Details'); source always inserts at the TOP level while WYSIWYG nests the new block inside the list item or quote the cursor sits in; and for a RANGE selection the alert builders fold the selection into the block in source but not in WYSIWYG. The nesting one is the real bug — inserting a divider inside a list item should stay in that item.",
    },
  ),

  // ---- Root cause 2: toggling a list off across several items ---------------
  ...family(["bulletList", "orderedList", "taskList"], {
    verdict: "source-bug",
    wysiwyg: "lifts just the item under the cursor out of a multi-item list",
    source: "`removeList` acts on the whole list block",
    rootCause: "source-list-toggle-off-scope",
    reason:
      "Four separate defects lived here and three are FIXED. The marker used to land at the caret (`The quick - brown fox`); it now goes after the line's indentation. It used to sit OUTSIDE a blockquote (`- > text`, a list containing a quote); it now nests inside (`> - text`). A heading kept its `#` run, giving `- ### text`, a bullet whose content is a heading; the run is now replaced. And re-applying the same list type did nothing, so the button was one-way in Source mode alone; it now turns the list off, as WYSIWYG does. What remains is the SCOPE of that turn-off: on a multi-item or nested list WYSIWYG lifts only the item under the cursor, while source's `removeList` unwraps the whole block. Same underlying helper as root cause 5.",
  }),

  // ---- Root cause 3: block conversions with the caret inside a table cell ---
  ...family(["heading:1", "heading:3", "heading:6", "increaseHeading", "insertBlockquote"], {
    verdict: "both-wrong",
    wysiwyg: "clears the cell's text, leaving an empty cell",
    source: "prefixes the ROW line, so `# | brown cell | other |` — the table stops parsing",
    rootCause: "block-conversion-inside-table-cell",
    reason:
      "The marker damage is FIXED: source used to emit `# - text` for a list item and `# > text` for a blockquote, destroying the quote, and the heading helpers now peel the quote wrapper, the list marker and any existing `#` run before rebuilding — keeping the quote and replacing the marker, as WYSIWYG does. Detection also sees through a quote now, so `> ## text` reads as level 2. Each heading action fell from ten diverging fixtures to two, and both are the SAME case: the caret inside a table cell. Neither surface handles it — WYSIWYG destroys the cell's text, source destroys the table. A cell cannot hold a heading or a blockquote in markdown, so the fix is an availability rule in `enableRules.ts` rather than either adapter, which also needs a row in the toolbar-state tests. Every action that converts a whole block needs the same rule.",
  }),

  // ---- Root cause 4: source line operations are structure-unaware -----------
  ...family(["moveLineUp", "moveLineDown", "joinLines"], {
    verdict: "source-bug",
    wysiwyg: "preserves the structure — declines a move that would break a table",
    source: "rows reordered across the delimiter, rows fused, blank-line separators mangled",
    rootCause: "source-line-ops-structure-unaware",
    reason:
      "In source mode a table is just lines, so moveLineUp hoists a body row above the `| --- |` delimiter and joinLines fuses two rows into `| a | b | | c | d |` — neither result parses as a table. The same blindness mangles blank-line separators between paragraphs. WYSIWYG now operates on the real line unit and explicitly refuses to displace a table's header row, so it is the correct side; source needs to learn the structure or decline inside one.",
  }),

  // ---- Root cause 5: source removeList leaves a lazy continuation ----------
  removeList: {
    action: "removeList",
    verdict: "source-bug",
    wysiwyg: "the item is lifted out of the list and becomes its own paragraph",
    source: "only the `- ` marker is stripped, leaving the text INSIDE the list",
    rootCause: "source-removelist-leaves-continuation",
    reason:
      "Stripping the marker from a middle item turns that line into a lazy continuation of the item above, so `- one` / `two brown` / `- three` re-parses as a two-item list whose first item is 'one two brown'. The text never leaves the list, which is the one thing the action promises. WYSIWYG lifts it out correctly. Surfaced only after the fixtures grew a multi-item list — a single-item list cannot tell the two apart.",
  },

  // ---- Root cause 6: source alignLeft omits the alignment colon -------------
  ...family(["alignLeft", "alignAllLeft"], {
    verdict: "source-bug",
    wysiwyg: "writes an explicit `:---` marker",
    source: "rewrites the dash run but adds no colon, leaving `---`",
    rootCause: "source-alignleft-omits-colon",
    reason:
      "Left is markdown's default alignment, so source treats 'align left' as 'remove alignment'. The result is that the column carries no explicit alignment, the toolbar's active state disagrees between modes, and a later alignment change starts from a different place. alignCenter and alignRight agree in both surfaces, which is why this shows up only on the left variants.",
  }),

  // ---- Root cause 7: source formatCJK does nothing on a range --------------
  formatCJK: {
    action: "formatCJK",
    verdict: "source-bug",
    wysiwyg: "`中文段落 brown 混排 English 文本` — spaces inserted at CJK/Latin boundaries",
    source: "unchanged",
    rootCause: "source-formatcjk-noop-on-range",
    reason:
      "CJK formatting is a headline feature, and in source mode the toolbar action is a no-op on a range selection while WYSIWYG applies it. Whatever the intended scope is (selection, line, or document), both surfaces must agree.",
  },

  // ---- Independent divergences ---------------------------------------------
  duplicateLine: {
    action: "duplicateLine",
    verdict: "both-defensible",
    wysiwyg: "two PARAGRAPHS — a blank line separates the copies",
    source: "two LINES within one paragraph, joined by a soft break",
    rootCause: "duplicateline-block-vs-softbreak",
    reason:
      "Now confined to plain paragraphs: the table, list and blockquote cases converged once WYSIWYG stopped operating on the top-level container. What remains is a real representational gap rather than a bug — a markdown soft line break is a LINE in source mode but not a BLOCK in WYSIWYG, so 'duplicate this line' has no single meaning for a soft-wrapped paragraph. Converging means deciding whether WYSIWYG should insert a hard break instead of a paragraph split.",
  },
  insertCodeBlock: {
    action: "insertCodeBlock",
    verdict: "source-bug",
    wysiwyg: "folds a whole list or a multi-block selection into ONE fence",
    source: "converts the paragraph, or the selected lines, that the cursor is in",
    rootCause: "codeblock-conversion-scope",
    reason:
      "The convert-versus-insert disagreement is RESOLVED, and it was never really ambiguous: the public action id is `codeBlock`, a block toggle; the command registry routes it here; and the user guide promises 'Convert to code'. Only this adapter's internal name said 'insert'. Source now converts the current block, or the selected lines, and emits `plaintext` to match WYSIWYG's `defaultLanguage` — which exists to stop `lowlight.highlightAuto()` mis-detecting, so omitting it would leave the two surfaces producing different documents. What remains is scope: WYSIWYG folds a whole list or a multi-block selection into ONE fence, source converts the paragraph it is in.",
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
 *
 * 31 entries is far fewer than 31 fixes — they collapse into 9 root causes, and
 * the largest (`source-inserts-block-at-caret`, 12 actions) is one insertion
 * helper.
 */
export const MAX_PARITY_DIVERGENCES = 30;
