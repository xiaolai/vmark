/**
 * Format Toolbar Store
 *
 * Manages the visibility and position of the format toolbar
 * in Milkdown WYSIWYG mode. Supports multiple modes:
 * - format: inline formatting (bold, italic, etc.)
 * - heading: heading level selection (H1-H6, paragraph)
 * - code: language picker for code blocks
 * - merged: format + node-specific actions (table, list, blockquote)
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";
import type { EditorView } from "@milkdown/kit/prose/view";

export type ToolbarMode = "format" | "heading" | "code" | "merged";
export type ContextMode = "format" | "inline-insert" | "block-insert";
export type NodeContextType = "table" | "list" | "blockquote" | null;

export interface HeadingInfo {
  level: number; // 1-6, or 0 for paragraph
  nodePos: number; // Position of the heading node
}

export interface CodeBlockInfo {
  language: string; // Current language (empty string if none)
  nodePos: number; // Position of the code_block node
}

export interface TableNodeContext {
  type: "table";
  tablePos: number;
  rowIndex: number;
  colIndex: number;
  numRows: number;
  numCols: number;
}

export interface ListNodeContext {
  type: "list";
  listType: "bullet" | "ordered" | "task";
  nodePos: number;
  depth: number; // Nesting level
}

export interface BlockquoteNodeContext {
  type: "blockquote";
  nodePos: number;
  depth: number; // Nesting level
}

export type NodeContext = TableNodeContext | ListNodeContext | BlockquoteNodeContext | null;

interface FormatToolbarState {
  isOpen: boolean;
  mode: ToolbarMode;
  contextMode: ContextMode;
  anchorRect: AnchorRect | null;
  editorView: EditorView | null;
  headingInfo: HeadingInfo | null;
  codeBlockInfo: CodeBlockInfo | null;
  nodeContext: NodeContext;
  /** Original cursor position before auto-select (for restore on cancel) */
  originalCursorPos: number | null;
}

interface OpenToolbarOptions {
  contextMode?: ContextMode;
  originalCursorPos?: number;
}

interface FormatToolbarActions {
  openToolbar: (rect: AnchorRect, view: EditorView, options?: ContextMode | OpenToolbarOptions) => void;
  openHeadingToolbar: (rect: AnchorRect, view: EditorView, headingInfo: HeadingInfo) => void;
  openCodeToolbar: (rect: AnchorRect, view: EditorView, codeBlockInfo: CodeBlockInfo) => void;
  openMergedToolbar: (rect: AnchorRect, view: EditorView, nodeContext: NodeContext) => void;
  closeToolbar: () => void;
  /** Clear original cursor pos after format action (so close won't restore) */
  clearOriginalCursor: () => void;
  updatePosition: (rect: AnchorRect) => void;
  updateNodeContext: (nodeContext: NodeContext) => void;
}

const initialState: FormatToolbarState = {
  isOpen: false,
  mode: "format",
  contextMode: "format",
  anchorRect: null,
  editorView: null,
  headingInfo: null,
  codeBlockInfo: null,
  nodeContext: null,
  originalCursorPos: null,
};

export const useFormatToolbarStore = create<FormatToolbarState & FormatToolbarActions>(
  (set, get) => ({
    ...initialState,

    openToolbar: (rect, view, options) => {
      // Handle backward compat: options can be string (contextMode) or object
      const opts: OpenToolbarOptions =
        typeof options === "string" ? { contextMode: options } : options ?? {};
      const contextMode = opts.contextMode ?? "format";
      const originalCursorPos = opts.originalCursorPos ?? null;

      set({
        isOpen: true,
        mode: "format",
        contextMode,
        anchorRect: rect,
        editorView: view,
        headingInfo: null,
        codeBlockInfo: null,
        nodeContext: null,
        originalCursorPos,
      });
    },

    openHeadingToolbar: (rect, view, headingInfo) =>
      set({
        isOpen: true,
        mode: "heading",
        anchorRect: rect,
        editorView: view,
        headingInfo,
        codeBlockInfo: null,
        nodeContext: null,
      }),

    openCodeToolbar: (rect, view, codeBlockInfo) =>
      set({
        isOpen: true,
        mode: "code",
        anchorRect: rect,
        editorView: view,
        headingInfo: null,
        codeBlockInfo,
        nodeContext: null,
      }),

    openMergedToolbar: (rect, view, nodeContext) =>
      set({
        isOpen: true,
        mode: "merged",
        contextMode: "format",
        anchorRect: rect,
        editorView: view,
        headingInfo: null,
        codeBlockInfo: null,
        nodeContext,
      }),

    closeToolbar: () => {
      const { editorView, originalCursorPos } = get();

      // Restore cursor position if we auto-selected a word
      if (editorView && originalCursorPos !== null) {
        try {
          const pos = Math.max(0, Math.min(originalCursorPos, editorView.state.doc.content.size));
          const selectionCtor = editorView.state.selection
            .constructor as unknown as { near: (pos: unknown, bias?: number) => unknown };
          const selection = selectionCtor.near(editorView.state.doc.resolve(pos));
          editorView.dispatch(editorView.state.tr.setSelection(selection as never));
        } catch {
          // Ignore restoration errors (e.g., stale position after doc changes)
        }
      }

      set(initialState);
    },

    clearOriginalCursor: () => set({ originalCursorPos: null }),

    updatePosition: (rect) => set({ anchorRect: rect }),

    updateNodeContext: (nodeContext) => set({ nodeContext }),
  })
);
