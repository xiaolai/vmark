/**
 * Math Popup Store — WYSIWYG inline-math popup state.
 *
 * Standalone Zustand store (T09 revert, WI-9 plan-20260803-161713): the
 * former merged-store slice re-inlined. The shim API is the contract —
 * consumers are unchanged.
 *
 * @module stores/mathPopupStore
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";

interface MathPopupData {
  isOpen: boolean;
  anchorRect: AnchorRect | null;
  latex: string;
  nodePos: number | null;
}

interface MathPopupState extends MathPopupData {
  openPopup: (rect: AnchorRect, latex: string, pos: number) => void;
  closePopup: () => void;
  updateLatex: (latex: string) => void;
}

const initialState: MathPopupData = {
  isOpen: false,
  anchorRect: null,
  latex: "",
  nodePos: null,
};

export const useMathPopupStore = create<MathPopupState>((set) => ({
  ...initialState,
  openPopup: (rect, latex, pos) =>
    set({ isOpen: true, anchorRect: rect, latex, nodePos: pos }),
  closePopup: () => set(initialState),
  updateLatex: (latex) => set({ latex }),
}));
