/**
 * Image Popup Store
 *
 * Purpose: State for the image editing popup (click-to-edit) — tracks source
 *   URL, alt text, node position, node type (inline/block), and dimensions.
 *
 * @module stores/imagePopupStore
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";
import type { ImageDimensions } from "@/types/image";

type ImageNodeType = "image" | "block_image";

interface ImagePopupState {
  isOpen: boolean;
  imageSrc: string;
  imageAlt: string;
  imageNodePos: number;
  imageNodeType: ImageNodeType;
  imageDimensions: ImageDimensions | null;
  anchorRect: AnchorRect | null;
}

interface ImagePopupActions {
  openPopup: (data: {
    imageSrc: string;
    imageAlt: string;
    imageNodePos: number;
    imageNodeType?: ImageNodeType;
    imageDimensions?: ImageDimensions | null;
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
  imageDimensions: null,
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
      imageDimensions: data.imageDimensions ?? null,
      anchorRect: data.anchorRect,
    }),

  closePopup: () => set(initialState),

  setSrc: (src) => set({ imageSrc: src }),

  setAlt: (alt) => set({ imageAlt: alt }),

  setNodeType: (type) => set({ imageNodeType: type }),
}));

export type { ImageNodeType };
export type { ImageDimensions } from "@/types/image";
