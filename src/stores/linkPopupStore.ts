/**
 * Link Popup Store
 *
 * Manages state for the link editing popup that appears when clicking links.
 */

import { create } from "zustand";

interface AnchorRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

interface LinkPopupState {
  isOpen: boolean;
  href: string;
  linkFrom: number;
  linkTo: number;
  anchorRect: AnchorRect | null;
}

interface LinkPopupActions {
  openPopup: (data: {
    href: string;
    linkFrom: number;
    linkTo: number;
    anchorRect: AnchorRect;
  }) => void;
  closePopup: () => void;
  setHref: (href: string) => void;
}

type LinkPopupStore = LinkPopupState & LinkPopupActions;

const initialState: LinkPopupState = {
  isOpen: false,
  href: "",
  linkFrom: 0,
  linkTo: 0,
  anchorRect: null,
};

export const useLinkPopupStore = create<LinkPopupStore>((set) => ({
  ...initialState,

  openPopup: (data) =>
    set({
      isOpen: true,
      href: data.href,
      linkFrom: data.linkFrom,
      linkTo: data.linkTo,
      anchorRect: data.anchorRect,
    }),

  closePopup: () => set(initialState),

  setHref: (href) => set({ href }),
}));
