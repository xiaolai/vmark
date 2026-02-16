/**
 * Media Popup Store
 *
 * Purpose: Unified state for the media editing popup (click-to-edit) — handles all 4
 * media types: image, block_image, block_video, block_audio. Tracks source URL, alt text,
 * title, node position, node type, poster image, and image dimensions.
 *
 * @coordinates-with plugins/mediaPopup/MediaPopupView.ts — popup rendering
 * @coordinates-with plugins/blockVideo/BlockVideoNodeView.ts — opens popup on click
 * @coordinates-with plugins/blockAudio/BlockAudioNodeView.ts — opens popup on click
 * @coordinates-with plugins/blockImage/BlockImageNodeView.ts — opens popup on click
 * @coordinates-with plugins/imageView/index.ts — opens popup on click
 * @module stores/mediaPopupStore
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";
import type { ImageDimensions } from "@/types/image";

type MediaNodeType = "image" | "block_image" | "block_video" | "block_audio";

interface MediaPopupState {
  isOpen: boolean;
  mediaSrc: string;
  mediaAlt: string;
  mediaTitle: string;
  mediaNodePos: number;
  mediaNodeType: MediaNodeType;
  mediaDimensions: ImageDimensions | null;
  mediaPoster: string;
  anchorRect: AnchorRect | null;
}

interface MediaPopupActions {
  openPopup: (data: {
    mediaSrc: string;
    mediaNodePos: number;
    mediaNodeType: MediaNodeType;
    anchorRect: AnchorRect;
    mediaAlt?: string;
    mediaTitle?: string;
    mediaDimensions?: ImageDimensions | null;
    mediaPoster?: string;
  }) => void;
  closePopup: () => void;
  setSrc: (src: string) => void;
  setAlt: (alt: string) => void;
  setTitle: (title: string) => void;
  setNodeType: (type: MediaNodeType) => void;
  setDimensions: (dims: ImageDimensions | null) => void;
  setPoster: (poster: string) => void;
}

type MediaPopupStore = MediaPopupState & MediaPopupActions;

const initialState: MediaPopupState = {
  isOpen: false,
  mediaSrc: "",
  mediaAlt: "",
  mediaTitle: "",
  mediaNodePos: -1,
  mediaNodeType: "block_video",
  mediaDimensions: null,
  mediaPoster: "",
  anchorRect: null,
};

export const useMediaPopupStore = create<MediaPopupStore>((set) => ({
  ...initialState,

  openPopup: (data) =>
    set({
      isOpen: true,
      mediaSrc: data.mediaSrc,
      mediaAlt: data.mediaAlt ?? "",
      mediaTitle: data.mediaTitle ?? "",
      mediaNodePos: data.mediaNodePos,
      mediaNodeType: data.mediaNodeType,
      mediaDimensions: data.mediaDimensions ?? null,
      mediaPoster: data.mediaPoster ?? "",
      anchorRect: data.anchorRect,
    }),

  closePopup: () => set(initialState),

  setSrc: (src) => set({ mediaSrc: src }),

  setAlt: (alt) => set({ mediaAlt: alt }),

  setTitle: (title) => set({ mediaTitle: title }),

  setNodeType: (type) => set({ mediaNodeType: type }),

  setDimensions: (dims) => set({ mediaDimensions: dims }),

  setPoster: (poster) => set({ mediaPoster: poster }),
}));

export type { MediaNodeType };
export type { ImageDimensions } from "@/types/image";
