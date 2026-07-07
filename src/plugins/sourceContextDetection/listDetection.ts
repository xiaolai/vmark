/**
 * List Detection for Source Mode
 *
 * Detects if cursor is inside a markdown list item.
 */

import type { EditorView } from "@codemirror/view";
import { useSettingsStore } from "@/stores/settingsStore";

type ListType = "bullet" | "ordered" | "task";

/**
 * Get the tab size from settings.
 */
function getTabSize(): number {
  return useSettingsStore.getState().general.tabSize;
}

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

  const tabSize = getTabSize();

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
      indent: Math.floor(indent / tabSize),
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
      indent: Math.floor(indent / tabSize),
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
      indent: Math.floor(indent / tabSize),
      number: num,
      checked: null,
      marker,
      contentStart: line.from + marker.length,
    };
  }

  return null;
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

/**
 * Outdent a list item by removing up to tabSize spaces.
 */
export function outdentListItem(view: EditorView, info: ListItemInfo): void {
  const { state, dispatch } = view;
  const line = state.doc.lineAt(info.lineStart);
  const lineText = line.text;
  const tabSize = getTabSize();

  // Find leading spaces (up to tabSize)
  const match = lineText.match(new RegExp(`^(\\s{1,${tabSize}})`));
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
  /* v8 ignore next -- @preserve reason: /^(\s*)/ always matches any string */
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
  /* v8 ignore next -- @preserve reason: /^(\s*)/ always matches any string */
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
  /* v8 ignore next -- @preserve reason: /^(\s*)/ always matches any string */
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
 * Pattern matching any list item line (bullet, ordered, or task).
 * Used by getListBlockBounds to detect contiguous list regions.
 */
const LIST_LINE_PATTERN = /^(\s*)([-*+]\s*\[[ xX]\]\s|[-*+]\s|\d+\.\s)/;

/**
 * Check if a line of text is a list item (any type).
 */
function isListLine(text: string): boolean {
  return LIST_LINE_PATTERN.test(text);
}

/**
 * Check if a line looks like a horizontal rule (---, ***, ___) rather than a list marker.
 */
function isHorizontalRule(text: string): boolean {
  const trimmed = text.trim();
  return /^[-*_]{3,}$/.test(trimmed);
}

/**
 * Get the bounds of a contiguous list block around the cursor.
 * Includes blank lines within the list (GFM loose lists) if the next
 * non-blank line is also a list item.
 *
 * Returns { from, to } character offsets or null if cursor is not in a list.
 */
export function getListBlockBounds(view: EditorView): { from: number; to: number } | null {
  const { state } = view;
  const { from } = state.selection.main;
  const doc = state.doc;
  const currentLine = doc.lineAt(from);

  // Cursor must be on a list line
  if (!isListLine(currentLine.text) || isHorizontalRule(currentLine.text)) {
    return null;
  }

  const totalLines = doc.lines;
  let startLineNum = currentLine.number;
  let endLineNum = currentLine.number;

  // Scan upward
  for (let lineNum = currentLine.number - 1; lineNum >= 1; lineNum--) {
    const line = doc.line(lineNum);
    if (isListLine(line.text) && !isHorizontalRule(line.text)) {
      startLineNum = lineNum;
      continue;
    }
    // Blank line: include if a list line exists above it
    if (line.text.trim() === "") {
      // Look further up for a list line
      let foundList = false;
      for (let above = lineNum - 1; above >= 1; above--) {
        const aboveLine = doc.line(above);
        if (aboveLine.text.trim() === "") continue;
        if (isListLine(aboveLine.text) && !isHorizontalRule(aboveLine.text)) {
          foundList = true;
        }
        break;
      }
      if (foundList) {
        startLineNum = lineNum;
        continue;
      }
    }
    break;
  }

  // Scan downward
  for (let lineNum = currentLine.number + 1; lineNum <= totalLines; lineNum++) {
    const line = doc.line(lineNum);
    if (isListLine(line.text) && !isHorizontalRule(line.text)) {
      endLineNum = lineNum;
      continue;
    }
    // Blank line: include if a list line follows
    if (line.text.trim() === "") {
      let foundList = false;
      for (let below = lineNum + 1; below <= totalLines; below++) {
        const belowLine = doc.line(below);
        if (belowLine.text.trim() === "") continue;
        if (isListLine(belowLine.text) && !isHorizontalRule(belowLine.text)) {
          foundList = true;
        }
        break;
      }
      if (foundList) {
        endLineNum = lineNum;
        continue;
      }
    }
    break;
  }

  // Trim trailing blank lines from the block
  /* v8 ignore next -- @preserve reason: list blocks rarely have trailing blank lines in practice */
  while (endLineNum > startLineNum && doc.line(endLineNum).text.trim() === "") {
    endLineNum--;
  }
  // Trim leading blank lines from the block
  /* v8 ignore next -- @preserve reason: list blocks rarely have leading blank lines in practice */
  while (startLineNum < endLineNum && doc.line(startLineNum).text.trim() === "") {
    startLineNum++;
  }

  return {
    from: doc.line(startLineNum).from,
    to: doc.line(endLineNum).to,
  };
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
