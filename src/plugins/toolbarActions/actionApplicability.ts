/**
 * Action applicability — the ONE declaration of where each adapter action
 * applies (structural-merge follow-up to the 2026-07 audits).
 *
 * Two consumers, one table:
 *   - the toolbar/menu (`toolbarGroups.ts`) reads `enabledInFor` for its
 *     per-item enable rules — items no longer carry their own `enabledIn`;
 *   - the palette (`actionAvailability.ts`) derives its node/selection
 *     requirements via `paletteRequirementFor` — the hand-maintained
 *     ACTION_AVAILABILITY copy that had already diverged is gone.
 *
 * Palette semantics deliberately differ in ONE place: `heading:0`
 * ("Paragraph") is toolbar-gated to headings but the palette offers it
 * everywhere as "convert to paragraph" — encoded as an explicit override
 * below, not a second table.
 *
 * @coordinates-with components/Editor/UniversalToolbar/toolbarGroups.ts — toolbar consumer
 * @coordinates-with services/commands/actionAvailability.ts — palette consumer
 * @module plugins/toolbarActions/actionApplicability
 */

import type { AdapterAction } from "./adapterActions";

/** Contexts where an action is enabled (toolbar/menu vocabulary). */
export type EnableContext =
  | "always"       // Always enabled
  | "selection"    // When there's a text selection
  | "textblock"    // In any text block (paragraph, heading, etc.)
  | "heading"      // Inside a heading
  | "list"         // Inside a list item
  | "table"        // Inside a table cell
  | "blockquote"   // Inside a blockquote
  | "codeblock"    // Inside a code block
  | "never";       // Always disabled (not yet implemented)

/** Cursor-position axes the palette can require (subset of EnableContext). */
export type NodeAxis = "table" | "link" | "list" | "blockquote" | "codeBlock" | "heading";

/** Palette-side requirement derived from the applicability table. */
export interface PaletteRequirement {
  requiresNode?: readonly NodeAxis[];
  requiresSelection?: boolean;
}

const MARK_CONTEXTS: readonly EnableContext[] = ["selection", "textblock"];
const TEXTBLOCK: readonly EnableContext[] = ["textblock"];
const TABLE: readonly EnableContext[] = ["table"];
const LIST: readonly EnableContext[] = ["list"];

/**
 * Where each adapter action applies. Actions without an entry have no
 * positional constraint (line utilities, transforms handled below, …).
 */
export const ACTION_APPLICABILITY: Partial<Record<AdapterAction, readonly EnableContext[]>> = {
  // Inline marks — need a selection or a textblock caret.
  bold: MARK_CONTEXTS,
  italic: MARK_CONTEXTS,
  underline: MARK_CONTEXTS,
  strikethrough: MARK_CONTEXTS,
  highlight: MARK_CONTEXTS,
  superscript: MARK_CONTEXTS,
  subscript: MARK_CONTEXTS,
  code: MARK_CONTEXTS,
  link: MARK_CONTEXTS,
  clearFormatting: ["selection"],

  // Headings — level 0 ("Paragraph") only makes sense inside a heading on
  // the toolbar; see the palette override below.
  "heading:0": ["heading"],
  "heading:1": TEXTBLOCK,
  "heading:2": TEXTBLOCK,
  "heading:3": TEXTBLOCK,
  "heading:4": TEXTBLOCK,
  "heading:5": TEXTBLOCK,
  "heading:6": TEXTBLOCK,
  decreaseHeading: ["heading"],

  // Lists.
  bulletList: ["textblock", "list"],
  orderedList: ["textblock", "list"],
  taskList: ["textblock", "list"],
  indent: LIST,
  outdent: LIST,
  removeList: LIST,

  // Blockquotes.
  insertBlockquote: ["textblock", "blockquote"],
  nestBlockquote: ["blockquote"],
  unnestBlockquote: ["blockquote"],
  removeBlockquote: ["blockquote"],

  // Table-cell operations (insertTable creates one, so it is textblock).
  addRow: TABLE,
  addRowAbove: TABLE,
  addCol: TABLE,
  addColLeft: TABLE,
  deleteRow: TABLE,
  deleteCol: TABLE,
  deleteTable: TABLE,
  alignLeft: TABLE,
  alignCenter: TABLE,
  alignRight: TABLE,
  alignAllLeft: TABLE,
  alignAllCenter: TABLE,
  alignAllRight: TABLE,
  formatTable: TABLE,

  // Insertions — need a textblock to insert at.
  insertTable: TEXTBLOCK,
  insertCodeBlock: TEXTBLOCK,
  insertDivider: TEXTBLOCK,
  insertMath: TEXTBLOCK,
  insertImage: TEXTBLOCK,
  insertVideo: TEXTBLOCK,
  insertAudio: TEXTBLOCK,
  insertDetails: TEXTBLOCK,
  insertDiagram: TEXTBLOCK,
  insertGraphvizDiagram: TEXTBLOCK,
  insertMarkmap: TEXTBLOCK,
  insertFootnote: TEXTBLOCK,
  insertAlertNote: TEXTBLOCK,
  insertAlertTip: TEXTBLOCK,
  insertAlertImportant: TEXTBLOCK,
  insertAlertWarning: TEXTBLOCK,
  insertAlertCaution: TEXTBLOCK,
  "link:wiki": TEXTBLOCK,
  "link:bookmark": TEXTBLOCK,

  // Selection-consuming text transforms (no toolbar items; palette-relevant).
  transformUppercase: ["selection"],
  transformLowercase: ["selection"],
  transformTitleCase: ["selection"],
  transformToggleCase: ["selection"],
};

/**
 * The toolbar/menu enable contexts for an action. Actions outside the table
 * are always enabled (utilities with no positional constraint).
 */
export function enabledInFor(action: AdapterAction): readonly EnableContext[] {
  return ACTION_APPLICABILITY[action] ?? ["always"];
}

/**
 * Actions that must NOT run with the caret inside a table cell.
 *
 * This is a data-safety boundary, not a discoverability preference. A markdown
 * table row is one line, and a cell holds inline content only:
 * `pmBlockConverters.ts` emits a cell's PARAGRAPH children and silently skips
 * every other block child, so a heading or a blockquote created inside a cell
 * is dropped on save without a word. The two surfaces failed differently and
 * both destructively — WYSIWYG cleared the cell's text, Source prefixed the row
 * line and the table stopped parsing.
 *
 * Anything that converts or inserts a BLOCK belongs here. Inline marks, links,
 * footnotes, inline math, text and CJK transforms, selection and navigation,
 * undo/redo and the table's own row/column/alignment operations stay enabled —
 * they all keep the cell's content inline.
 *
 * `moveLineUp`/`moveLineDown`/`joinLines` are here because Source treats rows
 * as plain lines and reorders them across the `| --- |` delimiter.
 * `duplicateLine` and `deleteLine` are NOT: both surfaces now agree on row
 * semantics for them.
 */
export const TABLE_CELL_BLOCKED_ACTIONS: ReadonlySet<string> = new Set<string>([
  // Headings — a cell cannot contain one.
  "increaseHeading", "decreaseHeading",
  ...Array.from({ length: 7 }, (_, level) => `heading:${level}`),
  // Lists and their structural operations.
  "bulletList", "orderedList", "taskList",
  "insertBulletList", "insertOrderedList", "insertTaskList",
  "indent", "outdent", "removeList",
  // Blockquotes.
  "insertBlockquote", "nestBlockquote", "unnestBlockquote", "removeBlockquote",
  // Block insertions.
  "insertCodeBlock", "insertDivider", "insertTable", "insertTableBlock", "insertDetails",
  "insertAlertNote", "insertAlertTip", "insertAlertImportant",
  "insertAlertWarning", "insertAlertCaution",
  "insertMath", "insertDiagram", "insertGraphvizDiagram", "insertMarkmap",
  // Block media — the WYSIWYG pickers can produce block nodes the cell
  // serializer skips, so they are blocked until table-aware inline insertion
  // exists.
  "insertImage", "insertVideo", "insertAudio",
  // Line operations that reorder or fuse rows.
  "moveLineUp", "moveLineDown", "joinLines", "sortLinesAsc", "sortLinesDesc",
]);

/**
 * Actions that stay available with the caret inside a CODE BLOCK.
 *
 * An ALLOW-list, not a block-list, and deliberately so: a fence holds literal
 * text, so any action that writes markdown syntax into it corrupts source code.
 * Listing what is safe means a newly added action is refused there by default —
 * the fail-closed direction. A block-list would let every future action through
 * until someone remembered to add it.
 *
 * This is a correctness gate, not a discoverability one. Greying out the toolbar
 * button is not enough: a native menu accelerator bypasses the toolbar entirely,
 * and pressing Ctrl+Shift+8 with the caret in a fence turned `const a = 1;` into
 * `- const a = 1;`.
 *
 * What earns a place here:
 *   - history and navigation, which never write markdown;
 *   - `insertCodeBlock`, the ESCAPE hatch — it must unfence, or the user is
 *     trapped inside the block with every other action refused;
 *   - line operations with literal-text semantics, which manipulate lines
 *     without introducing markdown syntax.
 */
export const CODE_BLOCK_SAFE_ACTIONS: ReadonlySet<string> = new Set<string>([
  // History — bypasses the editor entirely (unified history).
  "undo", "redo",
  // The way OUT of the block. Refusing this would trap the caret.
  "insertCodeBlock",
  // Selection and navigation change no text.
  "selectWord", "selectLine", "selectBlock", "expandSelection",
  // Literal-line operations: they reorder or duplicate lines without writing
  // markdown syntax. `duplicateLine` is safe only because it now suppresses the
  // hard-break backslash inside a fence.
  "moveLineUp", "moveLineDown", "duplicateLine", "deleteLine",
  "sortLinesAsc", "sortLinesDesc",
  "transformUppercase", "transformLowercase", "transformTitleCase", "transformToggleCase",
  // Whole-document utilities. These are not scoped to the cursor, so gating them
  // on it would be meaningless; each must preserve fence content itself.
  "formatCJKFile", "removeTrailingSpaces", "lineEndingsLF", "lineEndingsCRLF",
]);

/**
 * Whether `action` must be refused with the caret inside a code block.
 *
 * `joinLines` is NOT safe: it fuses a fence delimiter with its neighbour.
 * `collapseBlankLines` is NOT safe: it rewrites blank lines document-wide,
 * including inside fences, so it needs to become fence-aware before it can be
 * listed above.
 */
export function isBlockedInCodeBlock(action: string): boolean {
  return !CODE_BLOCK_SAFE_ACTIONS.has(action);
}

/** Whether `action` must be refused with the caret inside a table cell. */
export function isBlockedInTableCell(action: string): boolean {
  return TABLE_CELL_BLOCKED_ACTIONS.has(action);
}

/** EnableContext values that name a cursor-position node axis. */
const NODE_CONTEXT_TO_AXIS: Partial<Record<EnableContext, NodeAxis>> = {
  table: "table",
  list: "list",
  blockquote: "blockquote",
  heading: "heading",
};

/**
 * Palette overrides — the places palette discoverability deliberately
 * differs from toolbar enablement. `null` = no requirement.
 */
const PALETTE_OVERRIDES: ReadonlyMap<string, PaletteRequirement | null> = new Map([
  // "Paragraph" in the palette is "convert to paragraph" — offered anywhere.
  ["heading:0", null],
]);

/**
 * The palette requirement for an adapter action, derived from the SAME
 * enabledIn declaration the toolbar uses:
 *   - a set containing "textblock"/"always" imposes nothing;
 *   - a set of only node contexts requires being inside one of those nodes;
 *   - a bare ["selection"] requires a non-empty selection.
 */
export function paletteRequirementFor(action: string): PaletteRequirement | undefined {
  const override = PALETTE_OVERRIDES.get(action);
  if (override !== undefined) return override ?? undefined;

  const enabledIn = ACTION_APPLICABILITY[action as AdapterAction];
  if (!enabledIn) return undefined;
  if (enabledIn.includes("always") || enabledIn.includes("textblock")) return undefined;

  const nodes = enabledIn
    .map((c) => NODE_CONTEXT_TO_AXIS[c])
    .filter((axis): axis is NodeAxis => axis !== undefined);
  if (nodes.length === enabledIn.length && nodes.length > 0) {
    return { requiresNode: nodes };
  }
  if (enabledIn.length === 1 && enabledIn[0] === "selection") {
    return { requiresSelection: true };
  }
  /* v8 ignore next -- @preserve defensive: no current entry mixes selection with node contexts */
  return undefined;
}
