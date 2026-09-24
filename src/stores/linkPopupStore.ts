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
  /** Take keyboard focus on open — false for a pointer click (#1448). */
  autoFocus: boolean;
}

interface LinkPopupState extends LinkPopupData {
  openPopup: (data: {
    href: string;
    linkFrom: number;
    linkTo: number;
    anchorRect: AnchorRect;
    autoFocus?: boolean;
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
  autoFocus: true,
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
      autoFocus: data.autoFocus ?? true,
    }),
  closePopup: () => set(initialState),
  setHref: (href) => set({ href }),
  setLinkRange: (linkFrom, linkTo) => set({ linkFrom, linkTo }),
}));
