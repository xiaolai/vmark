/**
 * Image Popup Store
 *
 * Manages state for the image editing popup that appears when clicking images.
 */

import { create } from "zustand";

interface AnchorRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

type ImageNodeType = "image" | "block_image";

interface ImagePopupState {
  isOpen: boolean;
  imageSrc: string;
  imageAlt: string;
  imageNodePos: number;
  imageNodeType: ImageNodeType;
  anchorRect: AnchorRect | null;
}

interface ImagePopupActions {
  openPopup: (data: {
    imageSrc: string;
    imageAlt: string;
    imageNodePos: number;
    imageNodeType?: ImageNodeType;
    anchorRect: AnchorRect;
  }) => void;
  closePopup: () => void;
  setSrc: (src: string) => void;
  setAlt: (alt: string) => void;
  setNodeType: (type: ImageNodeType) => void;
}

type ImagePopupStore = ImagePopupState & ImagePopupActions;

const initialState: ImagePopupState = {
  isOpen: false,
  imageSrc: "",
  imageAlt: "",
  imageNodePos: -1,
  imageNodeType: "image",
  anchorRect: null,
};

export const useImagePopupStore = create<ImagePopupStore>((set) => ({
  ...initialState,

  openPopup: (data) =>
    set({
      isOpen: true,
      imageSrc: data.imageSrc,
      imageAlt: data.imageAlt,
      imageNodePos: data.imageNodePos,
      imageNodeType: data.imageNodeType ?? "image",
      anchorRect: data.anchorRect,
    }),

  closePopup: () => set(initialState),

  setSrc: (src) => set({ imageSrc: src }),

  setAlt: (alt) => set({ imageAlt: alt }),

  setNodeType: (type) => set({ imageNodeType: type }),
}));

export type { ImageNodeType };
