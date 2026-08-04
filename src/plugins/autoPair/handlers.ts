/**
 * Auto-Pair Input Handlers
 *
 * Purpose: Core logic for auto-pairing — handles text input (insert closing char),
 * closing bracket skip-over (type `)` when already there), backspace pair deletion,
 * and directional Tab/Shift+Tab jump over brackets (with code context guard).
 * Backtick toggle is extracted to backtickToggle.ts.
 *
 * Key decisions:
 *   - Right double quote normalization converts `\u201D` to `\u201C` at line start for
 *     Chinese typographic convention where both open/close quotes look the same
 *   - Config is passed in rather than read from store to keep handlers pure/testable
 *
 * @coordinates-with pairs.ts — pair definitions and lookup functions
 * @coordinates-with utils.ts — context checks (code block, word boundary)
 * @coordinates-with keyHandler.ts — Shift+Tab jump and key event dispatch
 * @coordinates-with backtickToggle.ts — backtick code mark toggle logic
 * @coordinates-with tiptap.ts — wires these handlers into the ProseMirror plugin
 * @module plugins/autoPair/handlers
 */

import type { EditorView } from "@tiptap/pm/view";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import {
  getClosingChar,
  getOpeningChar,
  normalizeForPairing,
  straightToCurlyOpening,
  type PairConfig,
} from "./pairs";
import { shouldAutoPair, isInCodeBlock, isInInlineCode, getCharAt, getCharBefore } from "./utils";
import { handleBacktickCodeToggle, resetBacktickState } from "./backtickToggle";

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
  // Reset THIS view's consecutive backtick counter on any non-backtick input
  // (before early returns so multi-char pastes and disabled state also reset)
  if (text !== "`") {
    resetBacktickState(view);
  }

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
    // Wrap only when both endpoints sit inside textblocks. Depth-0
    // selections (AllSelection from Cmd+A, NodeSelection on a top-level
    // node) would insert the pair chars at the document level, creating
    // stray paragraphs containing just "(" and ")" — fall through to the
    // default input behavior instead.
    const $from = state.doc.resolve(from);
    const $to = state.doc.resolve(to);
    if (!$from.parent.isTextblock || !$to.parent.isTextblock) return false;

    // Wrap selection with the pair. Insert the closing char first (at `to`)
    // and then the opening char (at `from`) so earlier positions stay valid.
    // Inserting AROUND the existing slice preserves marks, inline atoms, and
    // block structure — serializing via textBetween + replaceWith destroyed
    // them (stripped marks, deleted atoms, flattened cross-block selections).
    const tr = state.tr;
    tr.insertText(closing, to, to);
    tr.insertText(inputChar, from, from);
    // Place cursor after the wrapped content (before closing): the original
    // `to` shifted by the one-char opening insert.
    tr.setSelection(TextSelection.create(tr.doc, to + 1));
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
 * Check if an opening character is allowed by the current config.
 * Verifies the char has a known closing pair and that pair is enabled.
 */
function isAllowedOpeningChar(char: string, config: AutoPairConfig): boolean {
  return getClosingChar(char, toPairConfig(config)) !== null;
}

/**
 * Directional bracket jump — shared logic for Tab (forward) and Shift+Tab (backward).
 * Checks the adjacent character and jumps over it if it matches the predicate.
 *
 * Tab: checks char at cursor (closing bracket), jumps forward (+1).
 * Shift+Tab: checks char before cursor (opening bracket), jumps backward (-1).
 *
 * Both are navigation-only (not content changes), so addToHistory is false.
 * Neither verifies full pair context (matching counterpart) — this mirrors
 * the auto-pair convention where bracket skip operates on individual characters.
 */
function handleDirectionalJump(
  view: EditorView,
  config: AutoPairConfig,
  getChar: (state: EditorState, pos: number) => string,
  isAllowed: (char: string, config: AutoPairConfig) => boolean,
  offset: 1 | -1,
): boolean {
  if (!config.enabled) return false;

  const { state } = view;
  const { from, to } = state.selection;

  if (from !== to) return false;

  // Don't jump over brackets in code blocks or inline code — let Tab indent instead
  if (isInCodeBlock(state) || isInInlineCode(state)) return false;

  const char = getChar(state, from);
  if (!char || !isAllowed(char, config)) return false;

  const tr = state.tr.setSelection(TextSelection.create(state.doc, from + offset));
  view.dispatch(tr.setMeta("addToHistory", false));
  return true;
}

/**
 * Handle Tab key — jump over closing bracket if cursor is right before one.
 * Returns true if jumped, false to allow normal Tab behavior.
 */
export function handleTabJump(
  view: EditorView,
  config: AutoPairConfig
): boolean {
  return handleDirectionalJump(view, config, getCharAt, isAllowedClosingChar, 1);
}

/**
 * Handle Shift+Tab key — jump before opening bracket if cursor is right after one.
 * Mirrors handleTabJump (which jumps over closing brackets).
 * Returns true if jumped, false to allow normal Shift+Tab behavior.
 */
export function handleShiftTabJump(
  view: EditorView,
  config: AutoPairConfig
): boolean {
  return handleDirectionalJump(view, config, getCharBefore, isAllowedOpeningChar, -1);
}

