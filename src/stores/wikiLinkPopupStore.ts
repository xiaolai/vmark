/**
 * Wiki Link Popup Store — WYSIWYG wiki-link popup state.
 *
 * Standalone Zustand store (T09 revert, WI-9 plan-20260803-161713): the
 * former merged-store slice re-inlined. The shim API is the contract —
 * consumers are unchanged.
 *
 * @module stores/wikiLinkPopupStore
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";

interface WikiLinkPopupData {
  isOpen: boolean;
  anchorRect: AnchorRect | null;
  target: string;
  nodePos: number | null;
}

interface WikiLinkPopupState extends WikiLinkPopupData {
  openPopup: (rect: AnchorRect, target: string, pos: number) => void;
  closePopup: () => void;
  updateTarget: (target: string) => void;
}

const initialState: WikiLinkPopupData = {
  isOpen: false,
  anchorRect: null,
  target: "",
  nodePos: null,
};

export const useWikiLinkPopupStore = create<WikiLinkPopupState>((set) => ({
  ...initialState,
  openPopup: (rect, target, pos) =>
    set({ isOpen: true, anchorRect: rect, target, nodePos: pos }),
  closePopup: () => set(initialState),
  updateTarget: (target) => set({ target }),
}));
