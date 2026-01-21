/**
 * Source Insertions for CodeMirror
 *
 * Provides block insertion helpers for details, alerts, and math blocks.
 */

export type AlertType = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";

export interface InsertionResult {
  /** The text to insert */
  text: string;
  /** Cursor position offset from insertion start */
  cursorOffset: number;
}

/**
 * Build an HTML details block.
 * @param selection - Selected text to wrap (empty for blank block)
 * @returns Block text and cursor offset
 */
export function buildDetailsBlock(selection: string): InsertionResult {
  if (selection) {
    const text = `<details>\n<summary>Details</summary>\n\n${selection}\n</details>`;
    const cursorOffset = "<details>\n<summary>Details</summary>\n\n".length;
    return { text, cursorOffset };
  }

  const text = "<details>\n<summary>Details</summary>\n\n</details>";
  const cursorOffset = "<details>\n<summary>Details</summary>\n".length;
  return { text, cursorOffset };
}

/**
 * Build a GitHub-style alert blockquote.
 * @param type - Alert type (NOTE, TIP, IMPORTANT, WARNING, CAUTION)
 * @returns Block text and cursor offset
 */
export function buildAlertBlock(type: AlertType): InsertionResult {
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
