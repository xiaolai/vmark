/**
 * Auto-Pair Utility Functions
 *
 * Helper functions for smart auto-pairing detection.
 */

import type { EditorState } from "@milkdown/kit/prose/state";
import { SMART_QUOTE_CHARS } from "./pairs";

/**
 * Check if the cursor is inside a code block.
 */
export function isInCodeBlock(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const nodeName = $from.node(d).type.name;
    if (nodeName === "code_block" || nodeName === "fence") {
      return true;
    }
  }
  return false;
}

/**
 * Check if the cursor is inside inline code mark.
 */
export function isInInlineCode(state: EditorState): boolean {
  const { $from } = state.selection;
  const marks = $from.marks();
  return marks.some(
    (mark) => mark.type.name === "inlineCode" || mark.type.name === "code"
  );
}

/**
 * Check if the character before the cursor is a word character.
 * Used for smart quote detection (don't auto-pair after word chars).
 */
export function isAfterWordChar(state: EditorState, pos: number): boolean {
  if (pos <= 0) return false;

  const $pos = state.doc.resolve(pos);
  const textBefore = $pos.parent.textBetween(
    Math.max(0, $pos.parentOffset - 1),
    $pos.parentOffset,
    ""
  );

  if (!textBefore) return false;

  // Match word characters (letters, numbers, underscore)
  // Also match CJK characters
  return /[\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(
    textBefore
  );
}

/**
 * Check if auto-pairing should occur for the given character.
 */
export function shouldAutoPair(
  state: EditorState,
  pos: number,
  char: string
): boolean {
  // Don't auto-pair in code blocks
  if (isInCodeBlock(state)) return false;

  // Don't auto-pair in inline code
  if (isInInlineCode(state)) return false;

  // Smart quote: don't pair after word character (it's an apostrophe)
  if (SMART_QUOTE_CHARS.has(char) && isAfterWordChar(state, pos)) {
    return false;
  }

  // Don't auto-pair if preceded by backslash (escaped)
  if (pos > 0) {
    const $pos = state.doc.resolve(pos);
    const textBefore = $pos.parent.textBetween(
      Math.max(0, $pos.parentOffset - 1),
      $pos.parentOffset,
      ""
    );
    if (textBefore === "\\") return false;
  }

  return true;
}

/**
 * Get the character at a specific position in the document.
 */
export function getCharAt(state: EditorState, pos: number): string {
  if (pos < 0 || pos >= state.doc.content.size) return "";

  try {
    const $pos = state.doc.resolve(pos);
    return $pos.parent.textBetween(
      $pos.parentOffset,
      Math.min($pos.parentOffset + 1, $pos.parent.content.size),
      ""
    );
  } catch {
    return "";
  }
}

/**
 * Get the character before the cursor position.
 */
export function getCharBefore(state: EditorState, pos: number): string {
  if (pos <= 0) return "";

  try {
    const $pos = state.doc.resolve(pos);
    return $pos.parent.textBetween(
      Math.max(0, $pos.parentOffset - 1),
      $pos.parentOffset,
      ""
    );
  } catch {
    return "";
  }
}
