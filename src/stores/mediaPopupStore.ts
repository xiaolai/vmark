/**
 * Media Popup Store — WYSIWYG media (image/video/audio) popup state.
 *
 * Standalone Zustand store (T09 revert, WI-9 plan-20260803-161713): the
 * former merged-store slice re-inlined. The shim API is the contract —
 * consumers are unchanged.
 *
 * @module stores/mediaPopupStore
 */

import { create } from "zustand";
import type { ImageDimensions } from "@/types/image";
import type { AnchorRect } from "@/utils/popupPosition";

// Kept module-internal: consumers (plugins) speak the identical union from
// `plugins/shared/popupPorts.ts`; structural typing bridges the two.
type MediaNodeType = "image" | "block_image" | "block_video" | "block_audio";

interface MediaPopupData {
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

interface MediaPopupState extends MediaPopupData {
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

const initialState: MediaPopupData = {
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

export const useMediaPopupStore = create<MediaPopupState>((set) => ({
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
