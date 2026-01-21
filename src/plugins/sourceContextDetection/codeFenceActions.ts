/**
 * Code Fence Actions
 *
 * Functions to modify code fence language in source mode.
 */

import type { EditorView } from "@codemirror/view";
import type { CodeFenceInfo } from "./codeFenceDetection";
import { addRecentLanguage } from "./languages";

/**
 * Set or change the language of a code fence.
 * Modifies the text after ``` on the opening line.
 * Moves cursor to the beginning of the next line (inside the code fence).
 */
export function setCodeFenceLanguage(
  view: EditorView,
  info: CodeFenceInfo,
  language: string
): void {
  const { languageStartPos, languageEndPos, startLine } = info;
  const doc = view.state.doc;

  // Calculate position of the next line (inside the code fence)
  const openingLine = doc.line(startLine);
  const nextLineStart = openingLine.to + 1; // Position after the newline

  // Calculate the adjustment for the cursor position
  const lengthDiff = language.length - (languageEndPos - languageStartPos);
  const cursorPos = nextLineStart + lengthDiff;

  // Replace the language portion and move cursor inside the fence
  view.dispatch({
    changes: {
      from: languageStartPos,
      to: languageEndPos,
      insert: language,
    },
    selection: { anchor: cursorPos },
  });

  // Track in recent languages (only if not empty)
  if (language) {
    addRecentLanguage(language);
  }
}

/**
 * Remove the language from a code fence.
 * Makes it a plain code block.
 */
export function removeCodeFenceLanguage(
  view: EditorView,
  info: CodeFenceInfo
): void {
  setCodeFenceLanguage(view, info, "");
}
