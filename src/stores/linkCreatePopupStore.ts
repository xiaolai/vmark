/**
 * Link Create Popup Store
 *
 * Purpose: State for the link creation popup — used when creating a new link
 *   without a clipboard URL. Pre-fills text from selection or word expansion.
 *
 * @coordinates-with linkPopupStore.ts — handles editing existing links (separate flow)
 * @module stores/linkCreatePopupStore
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";

interface LinkCreatePopupState {
  isOpen: boolean;
  /** Pre-filled text (from selection or word expansion) */
  text: string;
  /** URL input value */
  url: string;
  /** Selection/word range in the document */
  rangeFrom: number;
  rangeTo: number;
  /** Anchor rect for popup positioning */
  anchorRect: AnchorRect | null;
  /** Whether text field should be shown (false when selection exists) */
  showTextInput: boolean;
}

interface LinkCreatePopupActions {
  openPopup: (data: {
    text: string;
    rangeFrom: number;
    rangeTo: number;
    anchorRect: AnchorRect;
    showTextInput: boolean;
  }) => void;
  closePopup: () => void;
  setText: (text: string) => void;
  setUrl: (url: string) => void;
}

const initialState: LinkCreatePopupState = {
  isOpen: false,
  text: "",
  url: "",
  rangeFrom: 0,
  rangeTo: 0,
  anchorRect: null,
  showTextInput: true,
};

export const useLinkCreatePopupStore = create<LinkCreatePopupState & LinkCreatePopupActions>((set) => ({
  ...initialState,

  openPopup: (data) =>
    set({
      isOpen: true,
      text: data.text,
      url: "",
      rangeFrom: data.rangeFrom,
      rangeTo: data.rangeTo,
      anchorRect: data.anchorRect,
      showTextInput: data.showTextInput,
    }),

  closePopup: () => set(initialState),

  setText: (text) => set({ text }),

  setUrl: (url) => set({ url }),
}));
