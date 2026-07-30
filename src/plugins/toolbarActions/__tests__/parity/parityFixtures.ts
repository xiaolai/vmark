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

/** Documents chosen so block actions start from different existing structures. */
export const DOCS: Array<{ label: string; markdown: string; needle: string }> = [
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
  // line operations
  "duplicateLine", "moveLineUp", "moveLineDown", "deleteLine", "joinLines",
  "indent", "outdent",
  // whole-document cleanup
  "removeTrailingSpaces", "collapseBlankLines", "removeBlankLines",
  "lineEndingsLF", "lineEndingsCRLF",
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
  "link:wiki": "Opens the wiki-link popup.",
  unlink: "Paired with the link popup flow; needs a linked-document fixture plus store setup.",
  insertImage: "Opens the media popup / file dialog.",
  insertVideo: "Opens the media popup / file dialog.",
  insertAudio: "Opens the media popup / file dialog.",
  insertFootnote: "Inserts then opens the footnote popup to await the definition.",
  insertMath: "Opens the math popup for the expression.",
  insertInlineMath: "Opens the inline-math popup for the expression.",
  insertDiagram: "Opens the diagram editor.",
  insertGraphvizDiagram: "Opens the diagram editor.",
  insertMarkmap: "Opens the diagram editor.",

  // --- whole-file scope: acts on the file on disk rather than the open buffer.
  formatCJKFile: "Whole-FILE operation routed through persistence, not a buffer edit.",
};

/**
 * Ceiling on shared actions left uncompared.
 *
 * 20 of 83 is the standing gap after the first coverage pass took the compared
 * set from 33 to 63. Ratchets DOWN only: cover an action, delete its entry, lower
 * this number. Never raise it — a new uncompared action means the harness fell
 * behind the adapters, which the contract test exists to catch.
 */
export const MAX_UNCOVERED_ACTIONS = 20;

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
