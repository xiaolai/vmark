/**
 * Source Format Popup Store
 *
 * Manages state for the floating formatting popup in source mode.
 * Shows when text is selected OR when cursor is in a table.
 */

import { create } from "zustand";
import type { EditorView } from "@codemirror/view";
import type { SourceTableInfo } from "@/plugins/sourceFormatPopup/tableDetection";

export interface AnchorRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Popup mode determines which buttons to show */
export type PopupMode = "format" | "table" | "heading";

/** Heading info for heading mode */
export interface HeadingInfo {
  level: number; // 1-6, or 0 for paragraph
  lineStart: number;
  lineEnd: number;
}

interface SourceFormatState {
  isOpen: boolean;
  mode: PopupMode;
  anchorRect: AnchorRect | null;
  selectedText: string;
  editorView: EditorView | null;
  tableInfo: SourceTableInfo | null;
  headingInfo: HeadingInfo | null;
}

interface SourceFormatActions {
  openPopup: (data: {
    anchorRect: AnchorRect;
    selectedText: string;
    editorView: EditorView;
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
  closePopup: () => void;
  updatePosition: (anchorRect: AnchorRect) => void;
}

type SourceFormatStore = SourceFormatState & SourceFormatActions;

const initialState: SourceFormatState = {
  isOpen: false,
  mode: "format",
  anchorRect: null,
  selectedText: "",
  editorView: null,
  tableInfo: null,
  headingInfo: null,
};

export const useSourceFormatStore = create<SourceFormatStore>((set) => ({
  ...initialState,

  openPopup: (data) =>
    set({
      isOpen: true,
      mode: "format",
      anchorRect: data.anchorRect,
      selectedText: data.selectedText,
      editorView: data.editorView,
      tableInfo: null,
      headingInfo: null,
    }),

  openTablePopup: (data) =>
    set({
      isOpen: true,
      mode: "table",
      anchorRect: data.anchorRect,
      selectedText: "",
      editorView: data.editorView,
      tableInfo: data.tableInfo,
      headingInfo: null,
    }),

  openHeadingPopup: (data) =>
    set({
      isOpen: true,
      mode: "heading",
      anchorRect: data.anchorRect,
      selectedText: "",
      editorView: data.editorView,
      tableInfo: null,
      headingInfo: data.headingInfo,
    }),

  closePopup: () => set(initialState),

  updatePosition: (anchorRect) => set({ anchorRect }),
}));
