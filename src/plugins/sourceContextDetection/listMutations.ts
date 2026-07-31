/**
 * Single-item list mutations for Source mode.
 *
 * Purpose: indent/outdent, per-item type conversion, and list removal for the
 * line the cursor is on. Whole-list conversion lives in listBlockConversion;
 * detection stays in listDetection, which re-exports these for consumers.
 *
 * Key decisions:
 *   - The three type converters share one implementation; they used to be
 *     three copy-pasted functions that drifted apart.
 *   - Type checks come from ListItemInfo, whose parse recognises ordered
 *     tasks, so "1. [x] done" no longer gains a second checkbox.
 *
 * @coordinates-with listDetection.ts — getListItemInfo produces ListItemInfo
 * @module plugins/sourceContextDetection/listMutations
 */
import type { EditorView } from "@codemirror/view";
import { useSettingsStore } from "@/stores/settingsStore";
import type { ListItemInfo } from "./listMarkerParsing";
import { parseListMarker } from "./listMarkerParsing";

/** Get the tab size from settings. */
export function getTabSize(): number {
  return useSettingsStore.getState().general.tabSize;
}

/**
 * Indent a list item by adding spaces based on tab size setting.
 */
export function indentListItem(view: EditorView, info: ListItemInfo): void {
  const { state, dispatch } = view;
  const tabSize = getTabSize();
  const indent = " ".repeat(tabSize);
  const changes = { from: info.lineStart, insert: indent };
  dispatch(state.update({ changes, scrollIntoView: true }));
  view.focus();
}

/** Outdent by up to tabSize spaces. False at the outermost level. */
export function outdentListItem(view: EditorView, info: ListItemInfo): boolean {
  const { state, dispatch } = view;
  const line = state.doc.lineAt(info.lineStart);
  const lineText = line.text;
  const tabSize = getTabSize();

  // Find leading spaces (up to tabSize)
  const match = lineText.match(new RegExp(`^(\\s{1,${tabSize}})`));
  if (!match) return false; // Outermost level — nothing to remove

  const spacesToRemove = match[1].length;
  const changes = { from: info.lineStart, to: info.lineStart + spacesToRemove };
  dispatch(state.update({ changes, scrollIntoView: true }));
  view.focus();
  return true;
}

/**
 * Rewrite the item's marker as `newMarker`, keeping indentation and content.
 * No-op when the item is already the target type.
 */
function convertListItem(
  view: EditorView,
  info: ListItemInfo,
  target: ListItemInfo["type"],
  newMarker: string,
): void {
  if (info.type === target) return;

  const { state, dispatch } = view;
  const line = state.doc.lineAt(info.lineStart);
  const lineText = line.text;

  const indentMatch = lineText.match(/^(\s*)/);
  /* v8 ignore next -- @preserve reason: /^(\s*)/ always matches any string */
  const indent = indentMatch ? indentMatch[1] : "";

  // info.marker spans indent, marker, and any checkbox, so a task's checkbox
  // is consumed here rather than leaking into the converted content.
  const content = lineText.slice(info.marker.length);

  const newLine = `${indent}${newMarker}${content}`;
  const changes = { from: info.lineStart, to: info.lineEnd, insert: newLine };
  dispatch(state.update({ changes, scrollIntoView: true }));
  view.focus();
}

/** Convert list item to bullet list. */
export function toBulletList(view: EditorView, info: ListItemInfo): void {
  convertListItem(view, info, "bullet", "- ");
}

/** Convert list item to ordered list (numbered 1. for simplicity). */
export function toOrderedList(view: EditorView, info: ListItemInfo): void {
  convertListItem(view, info, "ordered", "1. ");
}

/** Convert list item to an unchecked task item. */
export function toTaskList(view: EditorView, info: ListItemInfo): void {
  convertListItem(view, info, "task", "- [ ] ");
}

/**
 * Remove list formatting, converting to plain paragraph.
 */
export function removeList(view: EditorView, info: ListItemInfo): void {
  const { state, dispatch } = view;
  const { doc } = state;
  const line = doc.lineAt(info.lineStart);
  // Stripping the marker alone leaves a LAZY CONTINUATION of the item above;
  // a blank line beside each list neighbour is what lifts the text out.
  const pad = (n: number): string =>
    n >= 1 && n <= doc.lines && parseListMarker(doc.line(n).text) !== null ? "\n" : "";
  const insert = `${pad(line.number - 1)}${line.text.slice(info.marker.length)}${pad(line.number + 1)}`;
  const changes = { from: line.from, to: line.to, insert };
  dispatch(state.update({ changes, scrollIntoView: true }));
  view.focus();
}
