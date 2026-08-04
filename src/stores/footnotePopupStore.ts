/**
 * Footnote Popup Store — WYSIWYG footnote edit popup state.
 *
 * Standalone Zustand store (T09 revert, WI-9 plan-20260803-161713): the
 * former merged-store slice re-inlined. The shim API is the contract —
 * consumers are unchanged.
 *
 * @module stores/footnotePopupStore
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";

interface FootnotePopupData {
  isOpen: boolean;
  label: string;
  content: string;
  anchorRect: AnchorRect | null;
  definitionPos: number | null;
  referencePos: number | null;
  autoFocus: boolean;
}

interface FootnotePopupState extends FootnotePopupData {
  openPopup: (
    label: string,
    content: string,
    anchorRect: AnchorRect,
    definitionPos: number | null,
    referencePos: number | null,
    autoFocus?: boolean,
  ) => void;
  setContent: (content: string) => void;
  closePopup: () => void;
}

const initialState: FootnotePopupData = {
  isOpen: false,
  label: "",
  content: "",
  anchorRect: null,
  definitionPos: null,
  referencePos: null,
  autoFocus: false,
};

export const useFootnotePopupStore = create<FootnotePopupState>((set) => ({
  ...initialState,
  openPopup: (label, content, anchorRect, definitionPos, referencePos, autoFocus = false) =>
    set({
      isOpen: true,
      label,
      content,
      anchorRect,
      definitionPos,
      referencePos,
      autoFocus,
    }),
  setContent: (content) => set({ content }),
  closePopup: () => set(initialState),
}));
