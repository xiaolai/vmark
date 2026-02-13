/**
 * Auto-Pair Input Handlers
 *
 * Handlers for text input, closing bracket skip, and backspace pair deletion.
 */

import type { EditorView } from "@tiptap/pm/view";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import {
  getClosingChar,
  isClosingChar,
  getOpeningChar,
  normalizeForPairing,
  straightToCurlyOpening,
  straightToCurlyClosing,
  type PairConfig,
} from "./pairs";
import { shouldAutoPair, isInCodeBlock, getCharAt, getCharBefore } from "./utils";

export interface AutoPairConfig {
  enabled: boolean;
  includeCJK: boolean;
  includeCurlyQuotes: boolean;
  normalizeRightDoubleQuote: boolean;
}

/** Convert AutoPairConfig to PairConfig for pair lookup functions */
function toPairConfig(config: AutoPairConfig): PairConfig {
  return {
    includeCJK: config.includeCJK,
    includeCurlyQuotes: config.includeCurlyQuotes,
  };
}

/**
 * Check if a closing character is allowed by the current config.
 * Verifies the char has a known opening pair and that pair is enabled.
 */
function isAllowedClosingChar(char: string, config: AutoPairConfig): boolean {
  const openingChar = getOpeningChar(char);
  if (!openingChar) return false;
  // Re-use getClosingChar which already centralizes config gating
  return getClosingChar(openingChar, toPairConfig(config)) === char;
}

/**
 * Handle backtick as code mark toggle in WYSIWYG mode.
 * - Outside code: activate code mark (or wrap selection)
 * - Inside code: escape to end of code mark
 * Returns true if handled.
 */
function handleBacktickCodeToggle(
  view: EditorView,
  from: number,
  to: number
): boolean {
  const { state, dispatch } = view;

  // Don't handle if preceded by backslash (escaped)
  if (from > 0) {
    const $pos = state.doc.resolve(from);
    const textBefore = $pos.parent.textBetween(
      Math.max(0, $pos.parentOffset - 1),
      $pos.parentOffset,
      ""
    );
    if (textBefore === "\\") return false;
  }

  // Don't handle in code blocks
  if (isInCodeBlock(state)) return false;

  const codeMarkType = state.schema.marks.code;
  if (!codeMarkType) return false;

  // Check if cursor is in inline code
  const $from = state.doc.resolve(from);
  const inCode = $from.marks().some((m) => m.type === codeMarkType);

  if (inCode) {
    // Escape: move cursor to end of code mark
    const endPos = findCodeMarkEnd(state, from, codeMarkType);
    if (endPos !== null) {
      const tr = state.tr.setSelection(TextSelection.create(state.doc, endPos));
      tr.removeStoredMark(codeMarkType);
      dispatch(tr);
      return true;
    }
    return false;
  }

  // Outside code: toggle code mark
  if (from !== to) {
    // Selection: wrap with code mark
    const tr = state.tr.addMark(from, to, codeMarkType.create());
    dispatch(tr);
    return true;
  }

  // No selection: activate code mark for subsequent typing
  const tr = state.tr.addStoredMark(codeMarkType.create());
  dispatch(tr);
  return true;
}

/**
 * Find the end position of the code mark containing the given position.
 */
function findCodeMarkEnd(
  state: EditorState,
  pos: number,
  codeMarkType: ReturnType<EditorState["schema"]["marks"]["code"]["create"]>["type"]
): number | null {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const parentStart = $pos.start();

  let offset = 0;
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childStart = parentStart + offset;
    const childEnd = childStart + child.nodeSize;

    if (pos >= childStart && pos <= childEnd) {
      if (child.marks.some((m) => m.type === codeMarkType)) {
        return childEnd;
      }
    }
    offset += child.nodeSize;
  }
  return null;
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

  // Handle backtick as code mark toggle (before normal auto-pair)
  if (text === "`") {
    return handleBacktickCodeToggle(view, from, to);
  }

  // Normalize right double curly quote → left double curly (IME compat)
  let inputChar = config.normalizeRightDoubleQuote
    ? normalizeForPairing(text)
    : text;

  // Convert straight quotes to curly opening equivalents when curly quotes
  // are enabled. This ensures the auto-pair always produces curly quotes,
  // eliminating conflicts with macOS Smart Quotes which converts " at the
  // OS level and can cause garbled output (issue #57).
  const pairConfig = toPairConfig(config);
  inputChar = straightToCurlyOpening(inputChar, pairConfig);

  const closing = getClosingChar(inputChar, pairConfig);
  if (!closing) return false;

  const { state } = view;

  // Check if we should auto-pair
  if (!shouldAutoPair(state, from, inputChar)) return false;

  // Check if next char is already the closing char (avoid double-pairing)
  // Only skip when there's no selection — with a selection we should wrap it
  const nextChar = getCharAt(state, to);
  if (from === to && nextChar === closing) return false;

  const { dispatch } = view;

  if (from !== to) {
    // Wrap selection with the pair
    const selectedText = state.doc.textBetween(from, to);
    const tr = state.tr.replaceWith(
      from,
      to,
      state.schema.text(inputChar + selectedText + closing)
    );
    // Place cursor after the selected text (before closing)
    tr.setSelection(
      TextSelection.create(tr.doc, from + 1 + selectedText.length)
    );
    dispatch(tr);
  } else {
    // Insert pair with cursor between
    const tr = state.tr.insertText(inputChar + closing, from);
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

  // Check if this closing char is enabled by config
  if (!isAllowedClosingChar(char, config)) return false;

  const { state } = view;
  const { from, to } = state.selection;

  // Only skip when no selection
  if (from !== to) return false;

  // Check if next character matches
  const nextChar = getCharAt(state, from);
  if (nextChar !== char) return false;

  // Skip over the closing bracket (navigation, not content change)
  const tr = state.tr.setSelection(TextSelection.create(state.doc, from + 1));
  view.dispatch(tr.setMeta("addToHistory", false));
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

  // Check if prev char is an opening bracket/quote whose closing matches next char
  const expectedClosing = getClosingChar(prevChar, toPairConfig(config));
  if (expectedClosing && expectedClosing === nextChar) {
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

  // Check if next character is an allowed closing bracket
  const nextChar = getCharAt(state, from);
  if (!isAllowedClosingChar(nextChar, config)) return false;

  // Jump over the closing bracket (navigation, not content change)
  const tr = state.tr.setSelection(TextSelection.create(state.doc, from + 1));
  view.dispatch(tr.setMeta("addToHistory", false));
  return true;
}

/**
 * Create keyboard event handler.
 * Accepts a config getter so the handler always reads fresh settings
 * without allocating a new closure on every keydown.
 */
export function createKeyHandler(getConfig: () => AutoPairConfig) {
  return function handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
    // Skip if modifiers are pressed (except Shift)
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return false;
    }

    const config = getConfig();

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
      if (handleBackspacePair(view, config)) {
        event.preventDefault();
        return true;
      }
      return false;
    }

    // Handle closing bracket skip
    if (event.key.length === 1 && isClosingChar(event.key)) {
      if (handleClosingBracket(view, event.key, config)) {
        event.preventDefault();
        return true;
      }
      // When curly quotes are enabled, also try the curly closing equivalent.
      // event.key is always the physical key (" straight) even when the document
      // contains curly quotes from auto-pair or macOS Smart Quotes.
      const pairConfig = toPairConfig(config);
      const curlyClosing = straightToCurlyClosing(event.key, pairConfig);
      if (curlyClosing !== event.key && handleClosingBracket(view, curlyClosing, config)) {
        event.preventDefault();
        return true;
      }
    }

    return false;
  };
}
