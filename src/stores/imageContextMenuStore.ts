/**
 * Image Context Menu Store
 *
 * Manages state for the image context menu (right-click on images).
 */

import { create } from "zustand";

interface ImageContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number } | null;
  imageSrc: string;
  imageNodePos: number;
}

interface ImageContextMenuActions {
  openMenu: (data: {
    position: { x: number; y: number };
    imageSrc: string;
    imageNodePos: number;
  }) => void;
  closeMenu: () => void;
}

type ImageContextMenuStore = ImageContextMenuState & ImageContextMenuActions;

const initialState: ImageContextMenuState = {
  isOpen: false,
  position: null,
  imageSrc: "",
  imageNodePos: -1,
};

export const useImageContextMenuStore = create<ImageContextMenuStore>(
  (set) => ({
    ...initialState,

    openMenu: (data) =>
      set({
        isOpen: true,
        position: data.position,
        imageSrc: data.imageSrc,
        imageNodePos: data.imageNodePos,
      }),

    closeMenu: () => set(initialState),
  })
);
