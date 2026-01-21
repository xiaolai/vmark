import type { EditorView } from "@codemirror/view";
import {
  findInlineMathAtCursor,
  findBlockMathAtCursor,
} from "@/plugins/toolbarActions/sourceAdapterLinks";

export interface MathRange {
  from: number;
  to: number;
  content: string;
  isBlock: boolean;
  blockType: "dollarBlock" | "latexFence" | null;
}

export function findMathAtPos(view: EditorView, pos: number): MathRange | null {
  const blockMath = findBlockMathAtCursor(view, pos);
  if (blockMath) {
    return {
      from: blockMath.from,
      to: blockMath.to,
      content: blockMath.content,
      isBlock: true,
      blockType: blockMath.type,
    };
  }

  const inlineMath = findInlineMathAtCursor(view, pos);
  if (inlineMath) {
    return {
      from: inlineMath.from,
      to: inlineMath.to,
      content: inlineMath.content,
      isBlock: false,
      blockType: null,
    };
  }

  return null;
}
