/**
 * Source Format Popup Store
 *
 * Manages state for the floating formatting popup in source mode.
 * Shows when text is selected OR when cursor is in a table.
 */

import { create } from "zustand";
import type { EditorView } from "@codemirror/view";
import type { SourceTableInfo } from "@/plugins/sourceFormatPopup/tableDetection";
import type { CodeFenceInfo } from "@/plugins/sourceFormatPopup/codeFenceDetection";
import type { ListItemInfo } from "@/plugins/sourceFormatPopup/listDetection";
import type { BlockquoteInfo } from "@/plugins/sourceFormatPopup/blockquoteDetection";
import type { BlockMathInfo } from "@/plugins/sourceFormatPopup/blockMathDetection";

export interface AnchorRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Popup mode determines which buttons to show */
export type PopupMode =
  | "format"
  | "table"
  | "heading"
  | "code"
  | "list"
  | "blockquote"
  | "math"
  | "footnote";

/** Context mode for format popup (when mode is "format") */
export type ContextMode = "format" | "inline-insert" | "block-insert";

/** Heading info for heading mode */
export interface HeadingInfo {
  level: number; // 1-6, or 0 for paragraph
  lineStart: number;
  lineEnd: number;
}

interface SourceFormatState {
  isOpen: boolean;
  mode: PopupMode;
  contextMode: ContextMode;
  anchorRect: AnchorRect | null;
  selectedText: string;
  editorView: EditorView | null;
  tableInfo: SourceTableInfo | null;
  headingInfo: HeadingInfo | null;
  codeFenceInfo: CodeFenceInfo | null;
  listInfo: ListItemInfo | null;
  blockquoteInfo: BlockquoteInfo | null;
  blockMathInfo: BlockMathInfo | null;
  /** Original cursor position before auto-select (for restore on cancel) */
  originalCursorPos: number | null;
}

interface SourceFormatActions {
  openPopup: (data: {
    anchorRect: AnchorRect;
    selectedText: string;
    editorView: EditorView;
    contextMode?: ContextMode;
    originalCursorPos?: number;
  }) => void;
  openTablePopup: (data: {
    anchorRect: AnchorRect;
    editorView: EditorView;
    tableInfo: SourceTableInfo;
  }) => void;
  openHeadingPopup: (data: {
    anchorRect: AnchorRect;
    editorView: EditorView;
    headingInfo: HeadingInfo;
  }) => void;
  openCodePopup: (data: {
    anchorRect: AnchorRect;
    editorView: EditorView;
    codeFenceInfo: CodeFenceInfo;
  }) => void;
  openListPopup: (data: {
    anchorRect: AnchorRect;
    editorView: EditorView;
    listInfo: ListItemInfo;
  }) => void;
  openBlockquotePopup: (data: {
    anchorRect: AnchorRect;
    editorView: EditorView;
    blockquoteInfo: BlockquoteInfo;
  }) => void;
  openMathPopup: (data: {
    anchorRect: AnchorRect;
    editorView: EditorView;
    blockMathInfo: BlockMathInfo;
  }) => void;
  openFootnotePopup: (data: {
    anchorRect: AnchorRect;
    editorView: EditorView;
  }) => void;
  closePopup: () => number | null;
  /** Clear original cursor pos after format action (so close won't restore) */
  clearOriginalCursor: () => void;
  updatePosition: (anchorRect: AnchorRect) => void;
}

type SourceFormatStore = SourceFormatState & SourceFormatActions;

const initialState: SourceFormatState = {
  isOpen: false,
  mode: "format",
  contextMode: "format",
  anchorRect: null,
  selectedText: "",
  editorView: null,
  tableInfo: null,
  headingInfo: null,
  codeFenceInfo: null,
  listInfo: null,
  blockquoteInfo: null,
  blockMathInfo: null,
  originalCursorPos: null,
};

export const useSourceFormatStore = create<SourceFormatStore>((set, get) => ({
  ...initialState,

  openPopup: (data) => {
    const current = get();
    // Preserve originalCursorPos if popup is already open (don't overwrite with undefined)
    // This handles the case where extension listener re-opens the popup after Cmd+E
    const preservedCursorPos = current.isOpen && current.originalCursorPos !== null
      ? current.originalCursorPos
      : (data.originalCursorPos ?? null);

    set({
      ...initialState,
      isOpen: true,
      mode: "format",
      contextMode: data.contextMode ?? "format",
      anchorRect: data.anchorRect,
      selectedText: data.selectedText,
      editorView: data.editorView,
      originalCursorPos: preservedCursorPos,
    });
  },

  openTablePopup: (data) =>
    set({
      ...initialState,
      isOpen: true,
      mode: "table",
      anchorRect: data.anchorRect,
      editorView: data.editorView,
      tableInfo: data.tableInfo,
    }),

  openHeadingPopup: (data) =>
    set({
      ...initialState,
      isOpen: true,
      mode: "heading",
      anchorRect: data.anchorRect,
      editorView: data.editorView,
      headingInfo: data.headingInfo,
    }),

  openCodePopup: (data) =>
    set({
      ...initialState,
      isOpen: true,
      mode: "code",
      anchorRect: data.anchorRect,
      editorView: data.editorView,
      codeFenceInfo: data.codeFenceInfo,
    }),

  openListPopup: (data) =>
    set({
      ...initialState,
      isOpen: true,
      mode: "list",
      anchorRect: data.anchorRect,
      editorView: data.editorView,
      listInfo: data.listInfo,
    }),

  openBlockquotePopup: (data) =>
    set({
      ...initialState,
      isOpen: true,
      mode: "blockquote",
      anchorRect: data.anchorRect,
      editorView: data.editorView,
      blockquoteInfo: data.blockquoteInfo,
    }),

  openMathPopup: (data) =>
    set({
      ...initialState,
      isOpen: true,
      mode: "math",
      anchorRect: data.anchorRect,
      editorView: data.editorView,
      blockMathInfo: data.blockMathInfo,
    }),

  openFootnotePopup: (data) =>
    set({
      ...initialState,
      isOpen: true,
      mode: "footnote",
      anchorRect: data.anchorRect,
      editorView: data.editorView,
    }),

  closePopup: () => {
    const { originalCursorPos } = get();

    // Reset state first to prevent extension listener from re-closing
    set(initialState);

    // Return original cursor pos so caller can restore after focus
    return originalCursorPos;
  },

  clearOriginalCursor: () => set({ originalCursorPos: null }),

  updatePosition: (anchorRect) => set({ anchorRect }),
}));
