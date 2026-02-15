/**
 * Media Popup Store
 *
 * Purpose: State for the media editing popup (click-to-edit) — tracks source URL,
 * title, node position, node type (block_video/block_audio), and poster image.
 *
 * @coordinates-with plugins/mediaPopup/MediaPopupView.ts — popup rendering
 * @coordinates-with plugins/blockVideo/BlockVideoNodeView.ts — opens popup on click
 * @coordinates-with plugins/blockAudio/BlockAudioNodeView.ts — opens popup on click
 * @module stores/mediaPopupStore
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";

type MediaNodeType = "block_video" | "block_audio";

interface MediaPopupState {
  isOpen: boolean;
  mediaSrc: string;
  mediaTitle: string;
  mediaNodePos: number;
  mediaNodeType: MediaNodeType;
  mediaPoster: string;
  anchorRect: AnchorRect | null;
}

interface MediaPopupActions {
  openPopup: (data: {
    mediaSrc: string;
    mediaTitle: string;
    mediaNodePos: number;
    mediaNodeType: MediaNodeType;
    mediaPoster: string;
    anchorRect: AnchorRect;
  }) => void;
  closePopup: () => void;
  setSrc: (src: string) => void;
  setTitle: (title: string) => void;
  setPoster: (poster: string) => void;
}

type MediaPopupStore = MediaPopupState & MediaPopupActions;

const initialState: MediaPopupState = {
  isOpen: false,
  mediaSrc: "",
  mediaTitle: "",
  mediaNodePos: -1,
  mediaNodeType: "block_video",
  mediaPoster: "",
  anchorRect: null,
};

export const useMediaPopupStore = create<MediaPopupStore>((set) => ({
  ...initialState,

  openPopup: (data) =>
    set({
      isOpen: true,
      mediaSrc: data.mediaSrc,
      mediaTitle: data.mediaTitle,
      mediaNodePos: data.mediaNodePos,
      mediaNodeType: data.mediaNodeType,
      mediaPoster: data.mediaPoster,
      anchorRect: data.anchorRect,
    }),

  closePopup: () => set(initialState),

  setSrc: (src) => set({ mediaSrc: src }),

  setTitle: (title) => set({ mediaTitle: title }),

  setPoster: (poster) => set({ mediaPoster: poster }),
}));

export type { MediaNodeType };
