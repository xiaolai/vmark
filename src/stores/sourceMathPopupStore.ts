/**
 * Source Math Popup Store — Source-mode math edit popup state.
 *
 * Standalone Zustand store (T09 revert, WI-9 plan-20260803-161713): the
 * former merged-store slice re-inlined. The shim API is the contract —
 * consumers are unchanged.
 *
 * @module stores/sourceMathPopupStore
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";

interface SourceMathPopupData {
  isOpen: boolean;
  anchorRect: AnchorRect | null;
  latex: string;
  originalLatex: string;
  mathFrom: number;
  mathTo: number;
  isBlock: boolean;
}

interface SourceMathPopupState extends SourceMathPopupData {
  openPopup: (
    rect: AnchorRect,
    latex: string,
    mathFrom: number,
    mathTo: number,
    isBlock: boolean,
  ) => void;
  closePopup: () => void;
  updateLatex: (latex: string) => void;
}

const initialState: SourceMathPopupData = {
  isOpen: false,
  anchorRect: null,
  latex: "",
  originalLatex: "",
  mathFrom: 0,
  mathTo: 0,
  isBlock: false,
};

export const useSourceMathPopupStore = create<SourceMathPopupState>((set) => ({
  ...initialState,
  openPopup: (rect, latex, mathFrom, mathTo, isBlock) =>
    set({
      isOpen: true,
      anchorRect: rect,
      latex,
      originalLatex: latex,
      mathFrom,
      mathTo,
      isBlock,
    }),
  closePopup: () => set(initialState),
  updateLatex: (latex) => set({ latex }),
}));
