/**
 * Link Popup Store
 *
 * Purpose: State for the link editing popup (click-to-edit existing links) —
 *   tracks href, link range in the document, and anchor rect for positioning.
 *
 * @coordinates-with linkCreatePopupStore.ts — handles creating new links (separate flow)
 * @module stores/linkPopupStore
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";

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
