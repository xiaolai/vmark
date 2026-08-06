/**
 * Link Create Popup Store — WYSIWYG link-create popup state.
 *
 * Standalone Zustand store (T09 revert, WI-9 plan-20260803-161713): the
 * former merged-store slice re-inlined. The shim API is the contract —
 * consumers are unchanged.
 *
 * @module stores/linkCreatePopupStore
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";

interface LinkCreatePopupData {
  isOpen: boolean;
  text: string;
  url: string;
  rangeFrom: number;
  rangeTo: number;
  anchorRect: AnchorRect | null;
  showTextInput: boolean;
}

interface LinkCreatePopupState extends LinkCreatePopupData {
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

const initialState: LinkCreatePopupData = {
  isOpen: false,
  text: "",
  url: "",
  rangeFrom: 0,
  rangeTo: 0,
  anchorRect: null,
  showTextInput: true,
};

export const useLinkCreatePopupStore = create<LinkCreatePopupState>((set) => ({
  ...initialState,
  // `url` intentionally resets on every open — a new create session never
  // inherits the previous session's URL.
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
