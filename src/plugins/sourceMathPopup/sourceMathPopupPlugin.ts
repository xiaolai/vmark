/**
 * Source Math Popup Plugin
 *
 * CodeMirror 6 plugin for editing math in Source mode.
 * Shows a popup when cursor is inside math syntax ($...$ or $$...$$).
 */

import type { EditorView } from "@codemirror/view";
import { createSourcePopupPlugin } from "@/plugins/sourcePopup";
import { useMathPopupStore } from "@/stores/mathPopupStore";
import { SourceMathPopupView } from "./SourceMathPopupView";
import { findMathAtPos } from "./mathDetection";

/**
 * Detect trigger for math popup.
 * Returns the math range if cursor is inside math, null otherwise.
 */
function detectMathTrigger(view: EditorView): { from: number; to: number } | null {
  const { from, to } = view.state.selection.main;
  if (from !== to) return null;
  const math = findMathAtPos(view, from);
  if (!math) {
    return null;
  }
  return { from: math.from, to: math.to };
}

/**
 * Extract math data for the popup.
 */
function extractMathData(
  view: EditorView,
  range: { from: number; to: number }
): { latex: string; nodePos: number } {
  // Re-run detection to get full data
  const math = findMathAtPos(view, range.from);
  if (!math) {
    return {
      latex: "",
      nodePos: range.from,
    };
  }

  return {
    latex: math.content,
    nodePos: math.from,
  };
}

/**
 * Create the Source math popup plugin.
 */
export function createSourceMathPopupPlugin() {
  return createSourcePopupPlugin({
    store: useMathPopupStore,
    createView: (view, store) => new SourceMathPopupView(view, store),
    detectTrigger: detectMathTrigger,
    detectTriggerAtPos: (view, pos) => {
      const math = findMathAtPos(view, pos);
      if (!math) return null;
      return { from: math.from, to: math.to };
    },
    extractData: extractMathData,
    openPopup: ({ anchorRect, data }) => {
      useMathPopupStore.getState().openPopup(anchorRect, data.latex, data.nodePos);
    },
    triggerOnClick: true,
    triggerOnHover: false,
  });
}
