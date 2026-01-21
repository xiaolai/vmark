/**
 * List Detection for Source Mode
 *
 * Detects if cursor is inside a markdown list item.
 */

import type { EditorView } from "@codemirror/view";

export type ListType = "bullet" | "ordered" | "task";

export interface ListItemInfo {
  /** Type of list */
  type: ListType;
  /** Start position of the list item line */
  lineStart: number;
  /** End position of the list item line */
  lineEnd: number;
  /** Indentation level (0-based) */
  indent: number;
  /** For ordered lists, the number; for others, null */
  number: number | null;
  /** For task lists, whether checked */
  checked: boolean | null;
  /** The marker text (e.g., "- ", "1. ", "- [ ] ") */
  marker: string;
  /** Position where content starts (after marker) */
  contentStart: number;
}

/**
 * Detect if cursor is on a list item line and get its info.
 */
export function getListItemInfo(view: EditorView, pos?: number): ListItemInfo | null {
  const { state } = view;
  const from = typeof pos === "number" ? pos : state.selection.main.from;
  const doc = state.doc;
  const line = doc.lineAt(from);
  const lineText = line.text;

  // Match task list: - [ ] or - [x] or * [ ] etc.
  const taskMatch = lineText.match(/^(\s*)([-*+])\s*\[([ xX])\]\s/);
  if (taskMatch) {
    const indent = taskMatch[1].length;
    const checked = taskMatch[3].toLowerCase() === "x";
    const marker = taskMatch[0];
    return {
      type: "task",
      lineStart: line.from,
      lineEnd: line.to,
      indent: Math.floor(indent / 2),
      number: null,
      checked,
      marker,
      contentStart: line.from + marker.length,
    };
  }

  // Match unordered list: - , * , +
  const bulletMatch = lineText.match(/^(\s*)([-*+])\s/);
  if (bulletMatch) {
    const indent = bulletMatch[1].length;
    const marker = bulletMatch[0];
    return {
      type: "bullet",
      lineStart: line.from,
      lineEnd: line.to,
      indent: Math.floor(indent / 2),
      number: null,
      checked: null,
      marker,
      contentStart: line.from + marker.length,
    };
  }

  // Match ordered list: 1. , 2. , etc.
  const orderedMatch = lineText.match(/^(\s*)(\d+)\.\s/);
  if (orderedMatch) {
    const indent = orderedMatch[1].length;
    const num = parseInt(orderedMatch[2], 10);
    const marker = orderedMatch[0];
    return {
      type: "ordered",
      lineStart: line.from,
      lineEnd: line.to,
      indent: Math.floor(indent / 2),
      number: num,
      checked: null,
      marker,
      contentStart: line.from + marker.length,
    };
  }

  return null;
}

/**
 * Indent a list item by adding 2 spaces.
 */
export function indentListItem(view: EditorView, info: ListItemInfo): void {
  const { state, dispatch } = view;
  const changes = { from: info.lineStart, insert: "  " };
  dispatch(state.update({ changes, scrollIntoView: true }));
  view.focus();
}

/**
 * Outdent a list item by removing up to 2 spaces.
 */
export function outdentListItem(view: EditorView, info: ListItemInfo): void {
  const { state, dispatch } = view;
  const line = state.doc.lineAt(info.lineStart);
  const lineText = line.text;

  // Find leading spaces (up to 2)
  const match = lineText.match(/^(\s{1,2})/);
  if (!match) return; // No indentation to remove

  const spacesToRemove = match[1].length;
  const changes = { from: info.lineStart, to: info.lineStart + spacesToRemove };
  dispatch(state.update({ changes, scrollIntoView: true }));
  view.focus();
}

/**
 * Convert list item to bullet list.
 */
export function toBulletList(view: EditorView, info: ListItemInfo): void {
  if (info.type === "bullet") return; // Already bullet

  const { state, dispatch } = view;
  const line = state.doc.lineAt(info.lineStart);
  const lineText = line.text;

  // Get indentation
  const indentMatch = lineText.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : "";

  // Get content after marker
  const content = lineText.slice(info.marker.length);

  // Create new bullet marker
  const newLine = `${indent}- ${content}`;
  const changes = { from: info.lineStart, to: info.lineEnd, insert: newLine };
  dispatch(state.update({ changes, scrollIntoView: true }));
  view.focus();
}

/**
 * Convert list item to ordered list.
 */
export function toOrderedList(view: EditorView, info: ListItemInfo): void {
  if (info.type === "ordered") return; // Already ordered

  const { state, dispatch } = view;
  const line = state.doc.lineAt(info.lineStart);
  const lineText = line.text;

  // Get indentation
  const indentMatch = lineText.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : "";

  // Get content after marker
  const content = lineText.slice(info.marker.length);

  // Create new ordered marker (use 1. for simplicity)
  const newLine = `${indent}1. ${content}`;
  const changes = { from: info.lineStart, to: info.lineEnd, insert: newLine };
  dispatch(state.update({ changes, scrollIntoView: true }));
  view.focus();
}

/**
 * Convert list item to task list.
 */
export function toTaskList(view: EditorView, info: ListItemInfo): void {
  if (info.type === "task") return; // Already task

  const { state, dispatch } = view;
  const line = state.doc.lineAt(info.lineStart);
  const lineText = line.text;

  // Get indentation
  const indentMatch = lineText.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : "";

  // Get content after marker
  const content = lineText.slice(info.marker.length);

  // Create new task marker
  const newLine = `${indent}- [ ] ${content}`;
  const changes = { from: info.lineStart, to: info.lineEnd, insert: newLine };
  dispatch(state.update({ changes, scrollIntoView: true }));
  view.focus();
}

/**
 * Remove list formatting, converting to plain paragraph.
 */
export function removeList(view: EditorView, info: ListItemInfo): void {
  const { state, dispatch } = view;
  const line = state.doc.lineAt(info.lineStart);
  const lineText = line.text;

  // Get content after marker (no indentation for paragraph)
  const content = lineText.slice(info.marker.length);

  const changes = { from: info.lineStart, to: info.lineEnd, insert: content };
  dispatch(state.update({ changes, scrollIntoView: true }));
  view.focus();
}
