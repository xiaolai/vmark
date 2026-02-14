/**
 * Math Popup Store
 *
 * Purpose: State for the inline math edit popup — tracks anchor rect, LaTeX
 *   content, and node position for live editing of $...$ expressions.
 *
 * @module stores/mathPopupStore
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";

interface MathPopupState {
  isOpen: boolean;
  anchorRect: AnchorRect | null;
  latex: string;
  nodePos: number | null;
}

interface MathPopupActions {
  openPopup: (rect: AnchorRect, latex: string, pos: number) => void;
  closePopup: () => void;
  updateLatex: (latex: string) => void;
}

type MathPopupStore = MathPopupState & MathPopupActions;

const initialState: MathPopupState = {
  isOpen: false,
  anchorRect: null,
  latex: "",
  nodePos: null,
};

export const useMathPopupStore = create<MathPopupStore>((set) => ({
  ...initialState,

  openPopup: (rect, latex, pos) =>
    set({
      isOpen: true,
      anchorRect: rect,
      latex,
      nodePos: pos,
    }),

  closePopup: () => set(initialState),

  updateLatex: (latex) => set({ latex }),
}));
