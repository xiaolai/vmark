/**
 * Format Toolbar Store
 *
 * Manages the visibility and position of the format toolbar
 * in Milkdown WYSIWYG mode. Supports multiple modes:
 * - format: inline formatting (bold, italic, etc.)
 * - heading: heading level selection (H1-H6, paragraph)
 * - code: language picker for code blocks
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";
import type { EditorView } from "@milkdown/kit/prose/view";

export type ToolbarMode = "format" | "heading" | "code";
export type ContextMode = "format" | "inline-insert" | "block-insert";

export interface HeadingInfo {
  level: number; // 1-6, or 0 for paragraph
  nodePos: number; // Position of the heading node
}

export interface CodeBlockInfo {
  language: string; // Current language (empty string if none)
  nodePos: number; // Position of the code_block node
}

interface FormatToolbarState {
  isOpen: boolean;
  mode: ToolbarMode;
  contextMode: ContextMode;
  anchorRect: AnchorRect | null;
  editorView: EditorView | null;
  headingInfo: HeadingInfo | null;
  codeBlockInfo: CodeBlockInfo | null;
}

interface FormatToolbarActions {
  openToolbar: (rect: AnchorRect, view: EditorView, contextMode?: ContextMode) => void;
  openHeadingToolbar: (rect: AnchorRect, view: EditorView, headingInfo: HeadingInfo) => void;
  openCodeToolbar: (rect: AnchorRect, view: EditorView, codeBlockInfo: CodeBlockInfo) => void;
  closeToolbar: () => void;
  updatePosition: (rect: AnchorRect) => void;
}

const initialState: FormatToolbarState = {
  isOpen: false,
  mode: "format",
  contextMode: "format",
  anchorRect: null,
  editorView: null,
  headingInfo: null,
  codeBlockInfo: null,
};

export const useFormatToolbarStore = create<FormatToolbarState & FormatToolbarActions>(
  (set) => ({
    ...initialState,

    openToolbar: (rect, view, contextMode = "format") =>
      set({
        isOpen: true,
        mode: "format",
        contextMode,
        anchorRect: rect,
        editorView: view,
        headingInfo: null,
        codeBlockInfo: null,
      }),

    openHeadingToolbar: (rect, view, headingInfo) =>
      set({
        isOpen: true,
        mode: "heading",
        anchorRect: rect,
        editorView: view,
        headingInfo,
        codeBlockInfo: null,
      }),

    openCodeToolbar: (rect, view, codeBlockInfo) =>
      set({
        isOpen: true,
        mode: "code",
        anchorRect: rect,
        editorView: view,
        headingInfo: null,
        codeBlockInfo,
      }),

    closeToolbar: () => set(initialState),

    updatePosition: (rect) => set({ anchorRect: rect }),
  })
);
