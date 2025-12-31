/**
 * Syntax Reveal Plugin - Inline Node Syntax
 *
 * Handles inline atom nodes: math_inline ($...$), image (![alt](url))
 */

import type { Decoration } from "@milkdown/kit/prose/view";
import type { ResolvedPos } from "@milkdown/kit/prose/model";
import { addWidgetDecoration } from "./utils";

/**
 * Add inline node syntax decorations (math, image)
 * Shows syntax when cursor is adjacent to inline atom nodes.
 */
export function addInlineNodeSyntaxDecorations(
  decorations: Decoration[],
  pos: number,
  $from: ResolvedPos
): void {
  const parent = $from.parent;
  const parentStart = $from.start();

  // Check nodes in the parent
  parent.forEach((child, offset) => {
    const nodeStart = parentStart + offset;
    const nodeEnd = nodeStart + child.nodeSize;

    // Check if cursor is adjacent to or inside the node range
    // For atom nodes, cursor can be right before (nodeStart) or right after (nodeEnd)
    const isAdjacent = pos === nodeStart || pos === nodeEnd;
    const isNearby = pos >= nodeStart - 1 && pos <= nodeEnd + 1;

    if (!isNearby) return;

    // Inline math node
    if (child.type.name === "math_inline") {
      if (isAdjacent || (pos > nodeStart && pos < nodeEnd)) {
        // Show $ before and after
        addWidgetDecoration(decorations, nodeStart, "$", "math-open", -1);
        addWidgetDecoration(decorations, nodeEnd, "$", "math-close", 1);
      }
    }

    // Image node - disabled, now handled by image popup
    // Clicking image opens popup instead of revealing syntax
  });
}
