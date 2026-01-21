/**
 * Source Math Popup Actions
 *
 * Actions for math editing in Source mode (CodeMirror 6).
 * Handles save and remove operations.
 */

import type { EditorView } from "@codemirror/view";
import { useMathPopupStore } from "@/stores/mathPopupStore";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { findMathAtPos } from "./mathDetection";

/**
 * Build inline math markdown syntax.
 */
function buildInlineMath(content: string): string {
  return `$${content}$`;
}

/**
 * Build block math markdown syntax.
 */
function buildBlockMath(
  content: string,
  blockType: "dollarBlock" | "latexFence" | null
): string {
  if (blockType === "latexFence") {
    return `\`\`\`latex\n${content}\n\`\`\``;
  }
  // Default to $$ blocks
  return `$$\n${content}\n$$`;
}

/**
 * Save math changes to the document.
 * Replaces the current math syntax with updated content.
 */
export function saveMathChanges(view: EditorView): void {
  const state = useMathPopupStore.getState();
  if (state.nodePos === null) {
    return;
  }

  const math = findMathAtPos(view, state.nodePos);
  if (!math) return;

  const newMarkdown = math.isBlock
    ? buildBlockMath(state.latex, math.blockType)
    : buildInlineMath(state.latex);

  runOrQueueCodeMirrorAction(view, () => {
    view.dispatch({
      changes: {
        from: math.from,
        to: math.to,
        insert: newMarkdown,
      },
    });
  });
}

/**
 * Remove math from the document.
 * Replaces the math syntax with just the content (no delimiters).
 */
export function removeMath(view: EditorView): void {
  const state = useMathPopupStore.getState();
  if (state.nodePos === null) {
    return;
  }

  const math = findMathAtPos(view, state.nodePos);
  if (!math) return;

  // Replace with just the content (remove math formatting)
  runOrQueueCodeMirrorAction(view, () => {
    view.dispatch({
      changes: {
        from: math.from,
        to: math.to,
        insert: state.latex,
      },
    });
  });
}
