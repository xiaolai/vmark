/**
 * Auto-Pair Input Handlers
 *
 * Handlers for text input, closing bracket skip, and backspace pair deletion.
 */

import type { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection } from "@milkdown/kit/prose/state";
import {
  getClosingChar,
  isClosingChar,
  getOpeningChar,
  ASCII_PAIRS,
  CJK_BRACKET_PAIRS,
  CJK_CURLY_QUOTE_PAIRS,
  type PairConfig,
} from "./pairs";
import { shouldAutoPair, getCharAt, getCharBefore } from "./utils";

export interface AutoPairConfig {
  enabled: boolean;
  includeCJK: boolean;
  includeCurlyQuotes: boolean;
}

/** Convert AutoPairConfig to PairConfig for pair lookup functions */
function toPairConfig(config: AutoPairConfig): PairConfig {
  return {
    includeCJK: config.includeCJK,
    includeCurlyQuotes: config.includeCurlyQuotes,
  };
}

/**
 * Handle text input - auto-pair opening characters.
 * Returns true if the input was handled.
 */
export function handleTextInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  config: AutoPairConfig
): boolean {
  if (!config.enabled) return false;

  // Only handle single character input
  if (text.length !== 1) return false;

  const closing = getClosingChar(text, toPairConfig(config));
  if (!closing) return false;

  const { state } = view;

  // Check if we should auto-pair
  if (!shouldAutoPair(state, from, text)) return false;

  // Check if next char is already the closing char (avoid double-pairing)
  const nextChar = getCharAt(state, to);
  if (nextChar === closing) return false;

  const { dispatch } = view;

  if (from !== to) {
    // Wrap selection with the pair
    const selectedText = state.doc.textBetween(from, to);
    const tr = state.tr.replaceWith(
      from,
      to,
      state.schema.text(text + selectedText + closing)
    );
    // Place cursor after the selected text (before closing)
    tr.setSelection(
      TextSelection.create(tr.doc, from + 1 + selectedText.length)
    );
    dispatch(tr);
  } else {
    // Insert pair with cursor between
    const tr = state.tr.insertText(text + closing, from);
    tr.setSelection(TextSelection.create(tr.doc, from + 1));
    dispatch(tr);
  }

  return true;
}

/**
 * Handle closing bracket input - skip over if already present.
 * Returns true if the input was skipped.
 */
export function handleClosingBracket(
  view: EditorView,
  char: string,
  config: AutoPairConfig
): boolean {
  if (!config.enabled) return false;

  // Check if this is a closing character
  if (!isClosingChar(char)) return false;

  // Verify we have a valid opening char (respecting CJK config)
  const openingChar = getOpeningChar(char);
  if (!openingChar) return false;

  // Check if CJK bracket pair but CJK not enabled
  if (!config.includeCJK && CJK_BRACKET_PAIRS[openingChar]) return false;

  // Check if curly quote pair but curly quotes not enabled
  if (CJK_CURLY_QUOTE_PAIRS[openingChar]) {
    if (!config.includeCJK || !config.includeCurlyQuotes) return false;
  }

  const { state } = view;
  const { from, to } = state.selection;

  // Only skip when no selection
  if (from !== to) return false;

  // Check if next character matches
  const nextChar = getCharAt(state, from);
  if (nextChar !== char) return false;

  // Skip over the closing bracket
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + 1)));
  return true;
}

/**
 * Handle backspace - delete pair if cursor is between matching brackets.
 * Returns true if both characters were deleted.
 */
export function handleBackspacePair(
  view: EditorView,
  config: AutoPairConfig
): boolean {
  if (!config.enabled) return false;

  const { state } = view;
  const { from, to } = state.selection;

  // Only handle when no selection and not at start
  if (from !== to || from < 1) return false;

  const prevChar = getCharBefore(state, from);
  const nextChar = getCharAt(state, from);

  // Check if prev char is an opening bracket
  const expectedClosing = ASCII_PAIRS[prevChar];
  const expectedClosingCJKBracket = config.includeCJK
    ? CJK_BRACKET_PAIRS[prevChar]
    : null;
  const expectedClosingCurlyQuote =
    config.includeCJK && config.includeCurlyQuotes
      ? CJK_CURLY_QUOTE_PAIRS[prevChar]
      : null;

  if (
    expectedClosing === nextChar ||
    expectedClosingCJKBracket === nextChar ||
    expectedClosingCurlyQuote === nextChar
  ) {
    // Delete both characters
    view.dispatch(state.tr.delete(from - 1, from + 1));
    return true;
  }

  return false;
}

/**
 * Handle Tab key - jump over closing bracket if cursor is right before one.
 * Returns true if jumped, false to allow normal Tab behavior.
 */
export function handleTabJump(
  view: EditorView,
  config: AutoPairConfig
): boolean {
  if (!config.enabled) return false;

  const { state } = view;
  const { from, to } = state.selection;

  // Only handle when no selection
  if (from !== to) return false;

  // Check if next character is a closing bracket
  const nextChar = getCharAt(state, from);
  if (!isClosingChar(nextChar)) return false;

  // Verify it's a valid closing char based on config
  const openingChar = getOpeningChar(nextChar);
  if (!openingChar) return false;

  // Check if CJK bracket pair but CJK not enabled
  if (!config.includeCJK && CJK_BRACKET_PAIRS[openingChar]) return false;

  // Check if curly quote pair but curly quotes not enabled
  if (CJK_CURLY_QUOTE_PAIRS[openingChar]) {
    if (!config.includeCJK || !config.includeCurlyQuotes) return false;
  }

  // Jump over the closing bracket
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + 1)));
  return true;
}

/**
 * Create keyboard event handler.
 */
export function createKeyHandler(config: AutoPairConfig) {
  return function handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
    // Skip if modifiers are pressed (except Shift)
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return false;
    }

    // Handle Tab to jump over closing bracket
    if (event.key === "Tab" && !event.shiftKey) {
      if (handleTabJump(view, config)) {
        event.preventDefault();
        return true;
      }
      // Let normal Tab behavior happen (indent)
      return false;
    }

    // Handle backspace for pair deletion
    if (event.key === "Backspace") {
      return handleBackspacePair(view, config);
    }

    // Handle closing bracket skip
    if (event.key.length === 1 && isClosingChar(event.key)) {
      if (handleClosingBracket(view, event.key, config)) {
        event.preventDefault();
        return true;
      }
    }

    return false;
  };
}
