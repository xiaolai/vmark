/**
 * Image Tooltip Store
 *
 * Purpose: State for the read-only image tooltip (hover) — shows filename
 *   and dimensions. Separate from imagePopupStore which handles editing.
 *
 * @module stores/imageTooltipStore
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";
import type { ImageDimensions } from "@/types/image";

interface ImageTooltipState {
  isOpen: boolean;
  imageSrc: string;
  filename: string;
  dimensions: ImageDimensions | null;
  anchorRect: AnchorRect | null;
}

interface ImageTooltipActions {
  showTooltip: (data: {
    imageSrc: string;
    filename: string;
    dimensions: ImageDimensions | null;
    anchorRect: AnchorRect;
  }) => void;
  hideTooltip: () => void;
}

type ImageTooltipStore = ImageTooltipState & ImageTooltipActions;

const initialState: ImageTooltipState = {
  isOpen: false,
  imageSrc: "",
  filename: "",
  dimensions: null,
  anchorRect: null,
};

export const useImageTooltipStore = create<ImageTooltipStore>((set) => ({
  ...initialState,

  showTooltip: (data) =>
    set({
      isOpen: true,
      imageSrc: data.imageSrc,
      filename: data.filename,
      dimensions: data.dimensions,
      anchorRect: data.anchorRect,
    }),

  hideTooltip: () => set(initialState),
}));

export type { ImageDimensions } from "@/types/image";
