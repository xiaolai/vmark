/**
 * Adapter action vocabulary (WI-4, audit-followups 20260729).
 *
 * The ONE list of every action id the WYSIWYG and Source toolbar adapters
 * route (their switches stay the documented giant-switch style; this union
 * types the DEFINITIONS that feed them). `heading:N` actions are handled by
 * the dispatch prefix parser, so they are a template-literal member rather
 * than 7 list entries.
 *
 * Per-surface exclusives stay in the union — the availability layer decides
 * per surface; the union only rules out ids NEITHER surface routes:
 *   - source-only: sortLinesAsc, sortLinesDesc
 *   - wysiwyg-only: toggleQuoteStyle
 *
 * `__tests__/adapterActionParity.test.ts` extracts the real `case` labels
 * from both adapter sources and fails when this list and the switches drift
 * in either direction.
 *
 * @coordinates-with wysiwygAdapter.ts / sourceAdapter.ts — the routed switches
 * @coordinates-with components/Editor/UniversalToolbar/toolbarGroups.ts — typed consumer
 * @coordinates-with components/Editor/EditorContextMenu/menuModel.ts — typed consumer
 * @module plugins/toolbarActions/adapterActions
 */

/** Every non-heading action id routed by at least one adapter switch. */
export const ADAPTER_ACTION_IDS = [
  "addCol",
  "addColLeft",
  "addRow",
  "addRowAbove",
  "alignAllCenter",
  "alignAllLeft",
  "alignAllRight",
  "alignCenter",
  "alignLeft",
  "alignRight",
  "bold",
  "bulletList",
  "clearFormatting",
  "code",
  "collapseBlankLines",
  "decreaseHeading",
  "deleteCol",
  "deleteLine",
  "deleteRow",
  "deleteTable",
  "duplicateLine",
  "expandSelection",
  "formatCJK",
  "formatCJKFile",
  "formatTable",
  "highlight",
  "increaseHeading",
  "indent",
  "insertAlertCaution",
  "insertAlertImportant",
  "insertAlertNote",
  "insertAlertTip",
  "insertAlertWarning",
  "insertAudio",
  "insertBlockquote",
  "insertBulletList",
  "insertCodeBlock",
  "insertDetails",
  "insertDiagram",
  "insertDivider",
  "insertFootnote",
  "insertGraphvizDiagram",
  "insertImage",
  "insertInlineMath",
  "insertMarkmap",
  "insertMath",
  "insertOrderedList",
  "insertTable",
  "insertTableBlock",
  "insertTaskList",
  "insertVideo",
  "italic",
  "joinLines",
  "lineEndingsCRLF",
  "lineEndingsLF",
  "link",
  "link:bookmark",
  "link:wiki",
  "moveLineDown",
  "moveLineUp",
  "nestBlockquote",
  "orderedList",
  "outdent",
  "redo",
  "removeBlankLines",
  "removeBlockquote",
  "removeList",
  "removeTrailingSpaces",
  "selectBlock",
  "selectLine",
  "selectWord",
  "sortLinesAsc",
  "sortLinesDesc",
  "strikethrough",
  "subscript",
  "superscript",
  "taskList",
  "toggleQuoteStyle",
  "transformLowercase",
  "transformTitleCase",
  "transformToggleCase",
  "transformUppercase",
  "underline",
  "undo",
  "unlink",
  "unnestBlockquote",
] as const;

/** Heading actions carry their level; level 0 means "back to paragraph". */
export type HeadingAdapterAction = `heading:${0 | 1 | 2 | 3 | 4 | 5 | 6}`;

export type AdapterAction = (typeof ADAPTER_ACTION_IDS)[number] | HeadingAdapterAction;

const ID_SET: ReadonlySet<string> = new Set(ADAPTER_ACTION_IDS);
const HEADING_RE = /^heading:[0-6]$/;

/** Boundary guard for untrusted strings (menu/palette entry points). */
export function isAdapterAction(action: string): action is AdapterAction {
  return ID_SET.has(action) || HEADING_RE.test(action);
}
