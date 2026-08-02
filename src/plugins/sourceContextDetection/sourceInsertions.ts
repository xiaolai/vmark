/**
 * Source Insertions for CodeMirror
 *
 * Provides block insertion helpers for details, alerts, and math blocks.
 */

import { newDetailsMarkdown, newDetailsCursorOffset } from "@/plugins/shared/blockTemplates";
import { DEFAULT_MERMAID_DIAGRAM } from "@/plugins/mermaid/constants";
import { DEFAULT_GRAPHVIZ_DIAGRAM } from "@/plugins/graphviz/constants";
import { DEFAULT_MARKMAP_CONTENT } from "@/plugins/markmap/constants";

export type AlertType = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";

export interface InsertionResult {
  /** The text to insert */
  text: string;
  /** Cursor position offset from insertion start */
  cursorOffset: number;
}

/**
 * Build an HTML details block.
 *
 * The summary text and open state come from `blockTemplates`, the one place
 * that decides what a new block contains. This file used to spell them out
 * itself — `<details>` and the hardcoded English word "Details" — while WYSIWYG
 * inserted `<details open>` with a TRANSLATED summary, so the same toolbar
 * button produced two different blocks and the source one ignored the locale.
 *
 * @param selection - Selected text to wrap (empty for blank block)
 * @returns Block text and cursor offset
 */
export function buildDetailsBlock(selection: string): InsertionResult {
  return {
    text: newDetailsMarkdown(selection),
    cursorOffset: newDetailsCursorOffset(),
  };
}

/**
 * Build a GitHub-style alert blockquote.
 * @param type - Alert type (NOTE, TIP, IMPORTANT, WARNING, CAUTION)
 * @param selection - Selected text to quote under the marker (empty for blank alert)
 * @returns Block text and cursor offset
 */
export function buildAlertBlock(type: AlertType, selection: string): InsertionResult {
  if (selection) {
    const quoted = selection
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
    const text = `> [!${type}]\n${quoted}`;
    return { text, cursorOffset: text.length };
  }

  const text = `> [!${type}]\n> `;
  return { text, cursorOffset: text.length };
}

/**
 * Build a math block with $$ delimiters.
 * @param selection - Selected text to wrap (empty for blank block)
 * @returns Block text and cursor offset
 */
export function buildMathBlock(selection: string): InsertionResult {
  if (selection) {
    const text = `$$\n${selection}\n$$`;
    const cursorOffset = "$$\n".length;
    return { text, cursorOffset };
  }

  const text = "$$\n\n$$";
  const cursorOffset = "$$\n".length;
  return { text, cursorOffset };
}

/**
 * Build a fenced code block for a given language.
 * Shared builder behind the diagram/graphviz/markmap helpers.
 * @param selection - Selected text to wrap (empty for default content)
 * @param language - Fence info string (e.g. "mermaid", "dot", "markmap")
 * @param defaultContent - Content used when the selection is empty
 * @returns Block text and cursor offset (cursor lands at content start)
 */
export function buildFencedBlock(
  selection: string,
  language: string,
  defaultContent: string,
): InsertionResult {
  const content = selection || defaultContent;
  const fenceOpen = `\`\`\`${language}\n`;
  const text = `${fenceOpen}${content}\n\`\`\``;
  return { text, cursorOffset: fenceOpen.length };
}

/**
 * Build a mermaid diagram code block.
 * @param selection - Selected text to wrap (empty for default diagram)
 * @returns Block text and cursor offset
 */
export function buildDiagramBlock(selection: string): InsertionResult {
  return buildFencedBlock(selection, "mermaid", DEFAULT_MERMAID_DIAGRAM);
}

/**
 * Build a Graphviz DOT diagram code block.
 * @param selection - Selected text to wrap (empty for default diagram)
 * @returns Block text and cursor offset
 */
export function buildGraphvizBlock(selection: string): InsertionResult {
  return buildFencedBlock(selection, "dot", DEFAULT_GRAPHVIZ_DIAGRAM);
}

/**
 * Build a markmap mindmap code block.
 * @param selection - Selected text to wrap (empty for default mindmap)
 * @returns Block text and cursor offset
 */
export function buildMarkmapBlock(selection: string): InsertionResult {
  return buildFencedBlock(selection, "markmap", DEFAULT_MARKMAP_CONTENT);
}
