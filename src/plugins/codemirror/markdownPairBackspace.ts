/**
 * Markdown Pair Backspace for CodeMirror
 *
 * Purpose: Backspace between the halves of a symmetric markdown pair
 * (e.g. *|*, ~~|~~, `|`) deletes both halves in one keystroke.
 *
 * Key decisions:
 *   - Works for both single (e.g., *|*) and double (e.g., ~~|~~) pairs
 *   - Disabled inside fenced code blocks — pair chars there are literal code
 *     (e.g. `__init__`, `a ** b`), so the handler falls through and default
 *     backspace deletes a single char
 *   - IME composition is guarded via guardCodeMirrorKeyBinding
 *
 * @coordinates-with markdownAutoPair.ts — inserts the pairs this deletes
 * @coordinates-with sourceContextDetection/codeFenceDetection.ts — fence guard
 * @module plugins/codemirror/markdownPairBackspace
 */

import type { KeyBinding } from "@codemirror/view";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";
import { getCodeFenceInfo } from "@/plugins/sourceContextDetection/codeFenceDetection";

// Pairs for backspace deletion (char -> same char for symmetric pairs)
const SYMMETRIC_PAIRS: Record<string, string> = {
  "~": "~",
  "*": "*",
  "_": "_",
  "=": "=",
  "^": "^",
  "`": "`",
};

/**
 * Backspace handler: delete both halves of symmetric pairs.
 * Works for both single (e.g., *|*) and double (e.g., ~~|~~) pairs.
 */
export const markdownPairBackspace: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Backspace",
  run: (view) => {
    const { state } = view;
    const { from, to } = state.selection.main;

    // Only handle when no selection
    if (from !== to) return false;
    if (from === 0) return false;

    const charBefore = state.doc.sliceString(from - 1, from);
    const charAfter = state.doc.sliceString(from, from + 1);

    // Quick reject before the fence scan: both the single- and double-pair
    // branches require the char before the cursor to be a pair char.
    if (!SYMMETRIC_PAIRS[charBefore]) return false;

    // Inside fenced code blocks pair chars are literal code (e.g. `__init__`,
    // `a ** b`) — fall through so default backspace deletes one char.
    if (getCodeFenceInfo(view) !== null) return false;

    // Check for double-char pairs first (~~, **, __, ==)
    if (from >= 2) {
      const twoBefore = state.doc.sliceString(from - 2, from);
      const twoAfter = state.doc.sliceString(from, from + 2);

      // Check if we're between double pairs like ~~|~~
      if (
        twoBefore.length === 2 &&
        twoBefore[0] === twoBefore[1] &&
        twoAfter === twoBefore &&
        SYMMETRIC_PAIRS[twoBefore[0]]
      ) {
        view.dispatch({
          changes: { from: from - 2, to: from + 2 },
          selection: { anchor: from - 2 },
        });
        return true;
      }
    }

    // Check for single-char pairs like *|*
    if (SYMMETRIC_PAIRS[charBefore] && charAfter === charBefore) {
      view.dispatch({
        changes: { from: from - 1, to: from + 1 },
        selection: { anchor: from - 1 },
      });
      return true;
    }

    return false; // Let default backspace handle it
  },
});
