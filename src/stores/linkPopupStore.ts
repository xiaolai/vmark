/**
 * Link Popup Store — WYSIWYG link-edit popup state.
 *
 * Standalone Zustand store (T09 revert, WI-9 plan-20260803-161713): the
 * former merged-store slice re-inlined. The shim API is the contract —
 * consumers are unchanged.
 *
 * @module stores/linkPopupStore
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";

interface LinkPopupData {
  isOpen: boolean;
  href: string;
  linkFrom: number;
  linkTo: number;
  anchorRect: AnchorRect | null;
}

interface LinkPopupState extends LinkPopupData {
  openPopup: (data: {
    href: string;
    linkFrom: number;
    linkTo: number;
    anchorRect: AnchorRect;
  }) => void;
  closePopup: () => void;
  setHref: (href: string) => void;
  /** Remap the tracked link range after an external doc change (WI-1). */
  setLinkRange: (linkFrom: number, linkTo: number) => void;
}

const initialState: LinkPopupData = {
  isOpen: false,
  href: "",
  linkFrom: 0,
  linkTo: 0,
  anchorRect: null,
};

export const useLinkPopupStore = create<LinkPopupState>((set) => ({
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
  setLinkRange: (linkFrom, linkTo) => set({ linkFrom, linkTo }),
}));
