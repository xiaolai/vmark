/**
 * Fixtures and the coverage partition for the behavioral parity harness.
 *
 * Purpose: name, in one place, exactly which of the adapters' shared actions are
 * behaviorally compared and which are not — and why. `coverageContract.test.ts`
 * derives the real shared vocabulary from the two adapter sources and fails if
 * this partition and reality disagree in either direction, so coverage cannot
 * shrink silently and a newly added action cannot slip in uncompared.
 *
 * @coordinates-with behavioralParity.test.ts — consumes DOCS and COVERED_ACTIONS
 * @coordinates-with coverageContract.test.ts — enforces the partition
 * @module plugins/toolbarActions/__tests__/parity/parityFixtures
 */

/**
 * Documents chosen so block actions start from different existing structures.
 *
 * `onlyFor` restricts a fixture to named actions. It exists because a fixture is
 * only valid for an action if BOTH surfaces start from the same document, and
 * WYSIWYG canonicalises whitespace when it parses — trailing spaces go, blank
 * runs collapse. A deliberately untidy document is therefore a different
 * document in the two surfaces, and every action that echoes raw text
 * "diverges" for a reason that has nothing to do with the action. Scoping it to
 * the whitespace actions measures them without that noise.
 */
export const DOCS: Array<{
  label: string;
  markdown: string;
  needle: string;
  onlyFor?: string[];
}> = [
  { label: "paragraph", markdown: "The quick brown fox\n", needle: "brown" },
  { label: "heading-h3", markdown: "### The quick brown fox\n", needle: "brown" },
  { label: "list-item", markdown: "- The quick brown fox\n", needle: "brown" },
  { label: "blockquote", markdown: "> The quick brown fox\n", needle: "brown" },
  {
    label: "table",
    markdown: "| Head A | Head B |\n| --- | --- |\n| brown cell | other |\n| third | fourth |\n",
    needle: "brown",
  },
  { label: "cjk", markdown: "中文段落brown混排English文本\n", needle: "brown" },

  // Multi-line structures. Single-line fixtures cannot distinguish "operate on
  // this line" from "operate on the whole container" — they made WYSIWYG's line
  // operations look correct while `deleteLine` inside a table was deleting the
  // ENTIRE TABLE. Any fixture used to justify a line-operation fix must have
  // more than one line in the container.
  { label: "multi-para", markdown: "First para\n\nSecond brown para\n\nThird para\n", needle: "brown" },
  { label: "multi-item-list", markdown: "- one\n- two brown\n- three\n", needle: "brown" },
  { label: "nested-list", markdown: "- outer\n  - inner brown\n- last\n", needle: "brown" },

  // Whitespace actions were "covered" while proving NOTHING: every fixture above
  // is already clean, so `removeTrailingSpaces`, `collapseBlankLines` and
  // `removeBlankLines` were mutual no-ops in both surfaces and compared equal by
  // construction. A gate that cannot tell agreement from two no-ops is not
  // measuring those actions.
  //
  // NOT added here: a CRLF fixture. It belongs, and it immediately shows a real
  // divergence — WYSIWYG round-trips `\r\n` while Source normalises to `\n`, so
  // EVERY action disagrees on a CRLF document. That is a line-ending policy
  // decision in the pipeline, not a toolbar-action defect, and folding ~60
  // divergences into this gate would bury the thing it measures. Tracked as its
  // own work; `lineEndingsLF`/`lineEndingsCRLF` stay unverified until then.
  {
    label: "untidy",
    markdown: "First brown para   \n\n\n\nSecond para\t\n\n\n\nThird para  \n",
    needle: "brown",
    onlyFor: ["removeTrailingSpaces", "collapseBlankLines", "removeBlankLines"],
  },
];

/**
 * Actions whose document outcome is compared across both surfaces.
 *
 * Every entry here is exercised against every document in DOCS, under both a
 * range and a caret selection.
 */
export const COVERED_ACTIONS: string[] = [
  // inline marks
  "bold", "italic", "strikethrough", "code", "highlight", "underline",
  "superscript", "subscript", "clearFormatting",
  // headings (heading:N is routed by the dispatch prefix parser, not a switch arm)
  "heading:1", "heading:3", "heading:6", "increaseHeading", "decreaseHeading",
  // lists
  "bulletList", "orderedList", "taskList",
  "insertBulletList", "insertOrderedList", "insertTaskList", "removeList",
  // blockquotes
  "insertBlockquote", "removeBlockquote", "nestBlockquote", "unnestBlockquote",
  // blocks
  "insertDivider", "insertCodeBlock", "insertDetails",
  "insertAlertNote", "insertAlertTip", "insertAlertImportant",
  "insertAlertWarning", "insertAlertCaution",
  "insertTable", "insertTableBlock",
  // table operations (exercised against the `table` document)
  "addRow", "addRowAbove", "addCol", "addColLeft",
  "deleteRow", "deleteCol", "deleteTable", "formatTable",
  "alignLeft", "alignCenter", "alignRight",
  "alignAllLeft", "alignAllCenter", "alignAllRight",
  // text transforms
  "transformUppercase", "transformLowercase", "transformTitleCase", "transformToggleCase",
  "formatCJK",
  "formatCJKFile",
  // line operations
  "duplicateLine", "moveLineUp", "moveLineDown", "deleteLine", "joinLines",
  "indent", "outdent",
  // whole-document cleanup
  "removeTrailingSpaces", "collapseBlankLines", "removeBlankLines",
  "lineEndingsLF", "lineEndingsCRLF",
  // block inserts that were excused as "opens a popup" — they are SYNCHRONOUS
  // (`handleBuildInsert(view, buildX)` / `insertXBlock(context)`), and the
  // popup is a separate follow-up the action does not await.
  "insertMath", "insertInlineMath", "insertDiagram", "insertGraphvizDiagram",
  "insertMarkmap",
  // link actions that likewise mutate synchronously
  "link:wiki", "unlink",
];

/**
 * Shared actions deliberately NOT behaviorally compared, each with the reason.
 *
 * A reason must be a structural obstacle, not inconvenience. Anything listed
 * here is a gap someone can pick up; `MAX_UNCOVERED_ACTIONS` ratchets it down.
 */
export const UNCOVERED_ACTIONS: Record<string, string> = {
  // --- selection-only: the document is unchanged, so a document-outcome gate
  //     cannot tell agreement from mutual no-op. Comparing these needs a
  //     selection-shape assertion, which this harness does not model.
  selectWord: "Selection-only — moves the selection, never the document.",
  selectLine: "Selection-only — moves the selection, never the document.",
  selectBlock: "Selection-only — moves the selection, never the document.",
  expandSelection: "Selection-only — moves the selection, never the document.",

  // --- history: the suite shares one editor, so undo history carries across
  //     cases. Covering these requires a fresh-editor path per case.
  undo: "Needs per-case history isolation; the suite shares one editor for speed.",
  redo: "Needs per-case history isolation; the suite shares one editor for speed.",

  // --- popup-driven: these open a popup or editor overlay and complete
  //     asynchronously through a store, so the outcome is not a synchronous
  //     document edit. Covering them means driving the popup stores.
  link: "Opens the link popup; completion is async through the popup store.",
  "link:bookmark": "Reads the clipboard and opens a popup.",
  insertImage: "Opens the media popup / file dialog.",
  insertVideo: "Opens the media popup / file dialog.",
  insertAudio: "Opens the media popup / file dialog.",
  insertFootnote: "Inserts then opens the footnote popup to await the definition.",

};

/**
 * Ceiling on shared actions left uncompared.
 *
 * 19 of 83 is the standing gap after the first coverage pass took the compared
 * set from 33 to 63. Ratchets DOWN only: cover an action, delete its entry, lower
 * this number. Never raise it — a new uncompared action means the harness fell
 * behind the adapters, which the contract test exists to catch.
 */
export const MAX_UNCOVERED_ACTIONS = 12;

/**
 * Actions only one surface routes, so parity is undefined for them by
 * construction rather than unmeasured. Mirrors the per-surface exclusives
 * `adapterActionParity.test.ts` pins, and the contract test cross-checks that
 * these really are exclusive in the adapter sources.
 */
export const SURFACE_EXCLUSIVE: Record<string, string> = {
  toggleQuoteStyle: "WYSIWYG-only: rewrites quote characters via the PM node, no source-mode equivalent.",
  sortLinesAsc: "Source-only: line-oriented, meaningless against a structured document.",
  sortLinesDesc: "Source-only: line-oriented, meaningless against a structured document.",
};
