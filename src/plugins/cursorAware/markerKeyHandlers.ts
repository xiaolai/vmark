/**
 * Marker Key Handlers for Editable Syntax Markers
 *
 * Intercepts Backspace/Delete at mark boundaries to perform granular
 * mark transitions instead of removing marks entirely.
 *
 * Behavior (downgrade):
 * - `**bold|**` + Backspace → `*bold|*` (strong → emphasis)
 * - `**|bold**` + Delete → `*|bold*` (strong → emphasis)
 * - `*italic|*` + Backspace → `italic|` (emphasis removed)
 *
 * Behavior (upgrade) - works with cursor INSIDE or OUTSIDE mark:
 * - `*italic|*` + type `*` → `**italic|**` (cursor inside at end)
 * - `*|italic*` + type `*` → `**|italic**` (cursor inside at start)
 * - `*italic*|` + type `*` → `**italic**|` (cursor outside after mark)
 * - `|*italic*` + type `*` → `|**italic**` (cursor outside before mark)
 * - `~sub~|` + type `~` → `~~sub~~|` (subscript → strikethrough)
 *
 * Only active when `allowEditMarkers` setting is enabled.
 */

import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { useSettingsStore } from "@/stores/settingsStore";
import { findMarksAtPosition, findAdjacentMarks, type MarkRange } from "./markDecorations";

/**
 * Mark DOWNGRADE rules: what mark type to convert to when deleting one char.
 * - string value: convert to that mark type
 * - null: remove mark entirely
 * - undefined: not a supported mark, use default behavior
 */
const MARK_TRANSITIONS: Record<string, string | null> = {
  strong: "emphasis", // ** → *
  emphasis: null, // * → remove
  inlineCode: null, // ` → remove
  strikethrough: "subscript", // ~~ → ~
  subscript: null, // ~ → remove
  superscript: null, // ^ → remove
  highlight: null, // == → remove (no single = syntax)
  link: null, // remove entirely (no partial syntax)
};

/**
 * Mark UPGRADE rules: what mark type to convert to when adding a syntax char.
 * Maps: { triggerChar: { fromMark: toMark } }
 */
const MARK_UPGRADES: Record<string, Record<string, string>> = {
  "*": {
    emphasis: "strong", // * + type * → **
  },
  "~": {
    subscript: "strikethrough", // ~ + type ~ → ~~
  },
  "=": {
    // No upgrade for = (highlight is already ==)
  },
};

/**
 * Apply mark transition: convert or remove mark.
 */
function applyMarkTransition(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  markRange: MarkRange
): boolean {
  const { mark, from, to } = markRange;
  const markName = mark.type.name;
  const targetMarkName = MARK_TRANSITIONS[markName];

  // Not a supported mark for transitions
  if (targetMarkName === undefined) {
    return false;
  }

  let tr = state.tr;

  // Remove the current mark from the range
  tr = tr.removeMark(from, to, mark.type);

  // If transitioning to another mark (not removing), add the new mark
  if (targetMarkName !== null) {
    const newMarkType = state.schema.marks[targetMarkName];
    if (newMarkType) {
      tr = tr.addMark(from, to, newMarkType.create());
    }
  }

  dispatch?.(tr);
  return true;
}

/**
 * Find the innermost (deepest) mark at cursor position.
 * When marks are nested (e.g., bold inside italic), we want to
 * modify the innermost one first.
 */
function findInnermostMark(markRanges: MarkRange[]): MarkRange | null {
  if (markRanges.length === 0) return null;
  if (markRanges.length === 1) return markRanges[0];

  // Sort by range size (smallest = innermost)
  return markRanges.reduce((smallest, current) => {
    const currentSize = current.to - current.from;
    const smallestSize = smallest.to - smallest.from;
    return currentSize < smallestSize ? current : smallest;
  });
}

/**
 * Handle Backspace at mark boundary.
 * Cursor at end of marked text: `**bold|**`
 */
export function handleMarkerBackspace(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  _view?: EditorView
): boolean {
  const { allowEditMarkers, revealInlineSyntax } =
    useSettingsStore.getState().markdown;

  // Only active when both settings are enabled
  if (!allowEditMarkers || !revealInlineSyntax) {
    return false;
  }

  const { selection } = state;
  const { from, empty } = selection;

  // Only handle collapsed selection
  if (!empty) {
    return false;
  }

  const $from = state.doc.resolve(from);
  const markRanges = findMarksAtPosition(from, $from);

  if (markRanges.length === 0) {
    return false;
  }

  // Find marks where cursor is at the END of the marked text
  // (i.e., cursor pos equals mark.to)
  const atEndRanges = markRanges.filter((mr) => mr.to === from);

  if (atEndRanges.length === 0) {
    return false;
  }

  // Get innermost mark at end
  const targetMark = findInnermostMark(atEndRanges);
  if (!targetMark) {
    return false;
  }

  return applyMarkTransition(state, dispatch, targetMark);
}

/**
 * Handle Delete at mark boundary.
 * Cursor at start of marked text: `**|bold**`
 */
export function handleMarkerDelete(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  _view?: EditorView
): boolean {
  const { allowEditMarkers, revealInlineSyntax } =
    useSettingsStore.getState().markdown;

  // Only active when both settings are enabled
  if (!allowEditMarkers || !revealInlineSyntax) {
    return false;
  }

  const { selection } = state;
  const { from, empty } = selection;

  // Only handle collapsed selection
  if (!empty) {
    return false;
  }

  const $from = state.doc.resolve(from);
  const markRanges = findMarksAtPosition(from, $from);

  if (markRanges.length === 0) {
    return false;
  }

  // Find marks where cursor is at the START of the marked text
  // (i.e., cursor pos equals mark.from)
  const atStartRanges = markRanges.filter((mr) => mr.from === from);

  if (atStartRanges.length === 0) {
    return false;
  }

  // Get innermost mark at start
  const targetMark = findInnermostMark(atStartRanges);
  if (!targetMark) {
    return false;
  }

  return applyMarkTransition(state, dispatch, targetMark);
}

/**
 * Apply mark upgrade: convert mark to a "stronger" version.
 */
function applyMarkUpgrade(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  markRange: MarkRange,
  targetMarkName: string
): boolean {
  const { mark, from, to } = markRange;

  let tr = state.tr;

  // Remove the current mark
  tr = tr.removeMark(from, to, mark.type);

  // Add the upgraded mark
  const newMarkType = state.schema.marks[targetMarkName];
  if (newMarkType) {
    tr = tr.addMark(from, to, newMarkType.create());
  }

  dispatch?.(tr);
  return true;
}

/**
 * Handle text input at mark boundary for upgrades.
 * Supports both INSIDE and OUTSIDE cursor positions:
 * - `*italic|*` + type `*` → `**italic|**` (cursor inside at boundary)
 * - `*italic*|` + type `*` → `**italic**|` (cursor outside after mark)
 * - `|*italic*` + type `*` → `|**italic**` (cursor outside before mark)
 *
 * @returns true if the input was handled (upgrade performed), false otherwise
 */
export function handleMarkerInput(
  view: EditorView,
  _from: number,
  _to: number,
  text: string
): boolean {
  const { allowEditMarkers, revealInlineSyntax } =
    useSettingsStore.getState().markdown;

  // Only active when both settings are enabled
  if (!allowEditMarkers || !revealInlineSyntax) {
    return false;
  }

  // Check if this character can trigger an upgrade
  const upgradeMap = MARK_UPGRADES[text];
  if (!upgradeMap || Object.keys(upgradeMap).length === 0) {
    return false;
  }

  const { state } = view;
  const { selection } = state;
  const { from, empty } = selection;

  // Only handle collapsed selection
  if (!empty) {
    return false;
  }

  const $from = state.doc.resolve(from);

  // First, check marks that contain the cursor (cursor inside mark)
  const markRanges = findMarksAtPosition(from, $from);
  const atBoundaryRanges = markRanges.filter(
    (mr) => mr.from === from || mr.to === from
  );

  for (const markRange of atBoundaryRanges) {
    const markName = markRange.mark.type.name;
    const targetMarkName = upgradeMap[markName];

    if (targetMarkName) {
      return applyMarkUpgrade(view.state, view.dispatch, markRange, targetMarkName);
    }
  }

  // Second, check adjacent marks (cursor OUTSIDE mark: `*italic*|` or `|*italic*`)
  const adjacentRanges = findAdjacentMarks(from, $from);

  for (const markRange of adjacentRanges) {
    const markName = markRange.mark.type.name;
    const targetMarkName = upgradeMap[markName];

    if (targetMarkName) {
      return applyMarkUpgrade(view.state, view.dispatch, markRange, targetMarkName);
    }
  }

  return false;
}
