/**
 * Toolbar label translation (audit 20260612 H17).
 *
 * Purpose: Resolve toolbar group/item labels through i18n at render time.
 *   The `toolbar.*` keys were translated in every locale but never consumed
 *   — toolbarGroups.ts hardcodes English labels, which stay the
 *   defaultValue fallback so a missing key can never blank a button.
 *
 * Key naming predates the group/item ids (section "heading" vs group id
 * "block", camelCase vs kebab-case), so the mapping is an explicit table.
 * toolbarI18n.test.ts asserts every id is mapped and every key exists in
 * en/editor.json, so the table cannot silently rot.
 *
 * @coordinates-with toolbarGroups.ts — id + fallback label source
 * @module components/Editor/UniversalToolbar/toolbarI18n
 */

type TranslateFn = (key: string, opts?: { defaultValue?: string; [k: string]: unknown }) => string;

/** Group id → editor-namespace label key. */
export const GROUP_LABEL_KEYS: Record<string, string> = {
  block: "toolbar.group.heading",
  inline: "toolbar.group.inline",
  list: "toolbar.group.list",
  table: "toolbar.group.table",
  blockquote: "toolbar.group.blockquote",
  insert: "toolbar.group.insert",
  link: "toolbar.group.link",
};

/** Item id → editor-namespace label key. */
export const ITEM_LABEL_KEYS: Record<string, string> = {
  // heading group (id "block")
  paragraph: "toolbar.heading.paragraph",
  h1: "toolbar.heading.h1",
  h2: "toolbar.heading.h2",
  h3: "toolbar.heading.h3",
  h4: "toolbar.heading.h4",
  h5: "toolbar.heading.h5",
  h6: "toolbar.heading.h6",
  // inline group
  bold: "toolbar.inline.bold",
  italic: "toolbar.inline.italic",
  underline: "toolbar.inline.underline",
  strikethrough: "toolbar.inline.strikethrough",
  highlight: "toolbar.inline.highlight",
  superscript: "toolbar.inline.superscript",
  subscript: "toolbar.inline.subscript",
  code: "toolbar.inline.code",
  "clear-formatting": "toolbar.inline.clearFormatting",
  // list group
  "bullet-list": "toolbar.list.bullet",
  "ordered-list": "toolbar.list.ordered",
  "task-list": "toolbar.list.task",
  indent: "toolbar.list.indent",
  outdent: "toolbar.list.outdent",
  "remove-list": "toolbar.list.remove",
  // table group
  "insert-table": "toolbar.table.insert",
  "add-row-above": "toolbar.table.rowAbove",
  "add-row": "toolbar.table.rowBelow",
  "add-col-left": "toolbar.table.colLeft",
  "add-col": "toolbar.table.colRight",
  "delete-row": "toolbar.table.deleteRow",
  "delete-col": "toolbar.table.deleteCol",
  "delete-table": "toolbar.table.deleteTable",
  "align-left": "toolbar.table.alignLeft",
  "align-center": "toolbar.table.alignCenter",
  "align-right": "toolbar.table.alignRight",
  "align-all-left": "toolbar.table.alignAllLeft",
  "align-all-center": "toolbar.table.alignAllCenter",
  "align-all-right": "toolbar.table.alignAllRight",
  "format-table": "toolbar.table.format",
  // blockquote group
  blockquote: "toolbar.blockquote.blockquote",
  "nest-blockquote": "toolbar.blockquote.nestDeeper",
  "unnest-blockquote": "toolbar.blockquote.unnest",
  // insert group
  "insert-image": "toolbar.insert.image",
  "insert-video": "toolbar.insert.video",
  "insert-audio": "toolbar.insert.audio",
  "insert-code-block": "toolbar.insert.codeBlock",
  "insert-diagram": "toolbar.insert.diagram",
  "insert-mindmap": "toolbar.insert.mindmap",
  "insert-math": "toolbar.insert.mathBlock",
  "insert-details": "toolbar.insert.details",
  "insert-alert-note": "toolbar.insert.alertNote",
  "insert-alert-tip": "toolbar.insert.alertTip",
  "insert-alert-important": "toolbar.insert.alertImportant",
  "insert-alert-warning": "toolbar.insert.alertWarning",
  "insert-alert-caution": "toolbar.insert.alertCaution",
  "insert-divider": "toolbar.insert.divider",
  // link group
  link: "toolbar.link.hyperlink",
  bookmark: "toolbar.link.bookmark",
  wikiLink: "toolbar.link.wikiLink",
  footnote: "toolbar.link.footnote",
};

/** Translated label for a top-level toolbar (group) button. */
export function toolbarGroupLabel(
  t: TranslateFn,
  button: { id: string; label: string }
): string {
  const key = GROUP_LABEL_KEYS[button.id];
  return key ? t(key, { defaultValue: button.label }) : button.label;
}

/** Translated label for a dropdown menu item. */
export function toolbarItemLabel(
  t: TranslateFn,
  item: { id: string; label: string }
): string {
  const key = ITEM_LABEL_KEYS[item.id];
  return key ? t(key, { defaultValue: item.label }) : item.label;
}
