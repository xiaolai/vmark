/**
 * Input Rules for Highlight
 *
 * Enables live typing: ==text== auto-formats as you type.
 */

import { $inputRule } from "@milkdown/kit/utils";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { highlightSchema } from "./marks";

/**
 * Highlight input rule
 * Typing ==text== converts to highlight
 */
export const highlightInputRule = $inputRule((ctx) => {
  const markType = highlightSchema.type(ctx);
  return new InputRule(
    // Match ==text== at end of input (not ===)
    /(?:^|[^=])==([^=\s][^=]*[^=\s]|[^=\s])==$/,
    (state, match, start, end) => {
      const text = match[1];
      if (!text) return null;

      // Adjust start if we captured a non-= char before
      const actualStart = match[0].startsWith("==") ? start : start + 1;

      return state.tr
        .delete(actualStart, end)
        .insertText(text, actualStart)
        .addMark(actualStart, actualStart + text.length, markType.create());
    }
  );
});
