/**
 * Wiki Link Popup Store
 *
 * Purpose: State for the wiki link edit popup — manages the link target.
 *   Alias (display text) is edited inline in the editor, so this store
 *   only tracks the target field and node position.
 *
 * @module stores/wikiLinkPopupStore
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";

interface WikiLinkPopupState {
  isOpen: boolean;
  anchorRect: AnchorRect | null;
  target: string;
  nodePos: number | null;
}

interface WikiLinkPopupActions {
  openPopup: (rect: AnchorRect, target: string, pos: number) => void;
  closePopup: () => void;
  updateTarget: (target: string) => void;
}

type WikiLinkPopupStore = WikiLinkPopupState & WikiLinkPopupActions;

const initialState: WikiLinkPopupState = {
  isOpen: false,
  anchorRect: null,
  target: "",
  nodePos: null,
};

export const useWikiLinkPopupStore = create<WikiLinkPopupStore>((set) => ({
  ...initialState,

  openPopup: (rect, target, pos) =>
    set({
      isOpen: true,
      anchorRect: rect,
      target,
      nodePos: pos,
    }),

  closePopup: () => set(initialState),

  updateTarget: (target) => set({ target }),
}));
