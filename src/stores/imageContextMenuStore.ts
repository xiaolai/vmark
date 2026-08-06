/**
 * Image Context Menu Store — right-click menu state for editor images.
 *
 * Standalone Zustand store (T09 revert, WI-9 plan-20260803-161713): the
 * former merged-store slice re-inlined. The shim API is the contract —
 * consumers are unchanged.
 *
 * @module stores/imageContextMenuStore
 */

import { create } from "zustand";

interface ImageContextMenuData {
  isOpen: boolean;
  position: { x: number; y: number } | null;
  imageSrc: string;
  imageNodePos: number;
}

interface ImageContextMenuState extends ImageContextMenuData {
  openMenu: (data: {
    position: { x: number; y: number };
    imageSrc: string;
    imageNodePos: number;
  }) => void;
  closeMenu: () => void;
}

const initialState: ImageContextMenuData = {
  isOpen: false,
  position: null,
  imageSrc: "",
  imageNodePos: -1,
};

export const useImageContextMenuStore = create<ImageContextMenuState>((set) => ({
  ...initialState,
  openMenu: (data) =>
    set({
      isOpen: true,
      position: data.position,
      imageSrc: data.imageSrc,
      imageNodePos: data.imageNodePos,
    }),
  closeMenu: () => set(initialState),
}));
