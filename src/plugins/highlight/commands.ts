/**
 * Toggle Command for Highlight
 *
 * Command to toggle highlight mark on selection.
 */

import { $command } from "@milkdown/kit/utils";
import { toggleMark } from "@milkdown/kit/prose/commands";
import { highlightSchema } from "./marks";

/**
 * Toggle highlight mark on current selection
 */
export const toggleHighlightCommand = $command(
  "ToggleHighlight",
  (ctx) => () => toggleMark(highlightSchema.type(ctx))
);
