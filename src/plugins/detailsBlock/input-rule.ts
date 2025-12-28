/**
 * Details Block Input Rule
 *
 * Triggers details block creation when typing <details> or :::details
 */

import { $inputRule } from "@milkdown/kit/utils";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { TextSelection } from "@milkdown/kit/prose/state";
import { detailsBlockSchema, detailsSummarySchema } from "./node";

// Pattern: <details> or :::details at start of line
const DETAILS_INPUT_PATTERN = /^(?:<details>|:::details)\s*$/i;

/**
 * Input rule to create details block
 */
export const detailsBlockInputRule = $inputRule((ctx) => {
  const detailsType = detailsBlockSchema.type(ctx);
  const summaryType = detailsSummarySchema.type(ctx);

  return new InputRule(DETAILS_INPUT_PATTERN, (state, _match, start, end) => {
    // Get paragraph node type for content
    const paragraphType = state.schema.nodes.paragraph;
    if (!paragraphType) {
      return null;
    }

    // Find the paragraph boundaries to replace the entire paragraph
    const $start = state.doc.resolve(start);
    const paragraphStart = $start.before($start.depth);
    const paragraphEnd = $start.after($start.depth);

    // Create summary with default text
    const summaryNode = summaryType.create(
      null,
      state.schema.text("Click to expand")
    );

    // Create empty paragraph for content
    const contentNode = paragraphType.create();

    // Create details block
    const detailsNode = detailsType.create(
      { open: true }, // Start expanded so user can edit
      [summaryNode, contentNode]
    );

    // Replace the entire paragraph with the details block
    const tr = state.tr.replaceWith(paragraphStart, paragraphEnd, detailsNode);

    // Move cursor to the content paragraph
    // Position: paragraphStart + 1 (enter details) + summary size + 1 (enter paragraph)
    const summarySize = summaryNode.nodeSize;
    const cursorPos = paragraphStart + 1 + summarySize + 1;

    return tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPos)));
  });
});
