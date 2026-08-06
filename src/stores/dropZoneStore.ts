/**
 * Drop Zone Store — drag-over state for image drops onto the editor.
 *
 * Standalone Zustand store (T09 revert, WI-9 plan-20260803-161713): the
 * former merged-store slice re-inlined. The shim API is the contract —
 * consumers are unchanged.
 *
 * @module stores/dropZoneStore
 */

import { create } from "zustand";

interface DropZoneData {
  isDragging: boolean;
  hasImages: boolean;
  imageCount: number;
}

interface DropZoneState extends DropZoneData {
  setDragging: (isDragging: boolean, hasImages?: boolean, imageCount?: number) => void;
  reset: () => void;
}

const initialState: DropZoneData = {
  isDragging: false,
  hasImages: false,
  imageCount: 0,
};

export const useDropZoneStore = create<DropZoneState>((set) => ({
  ...initialState,
  setDragging: (isDragging, hasImages = false, imageCount = 0) =>
    set({ isDragging, hasImages, imageCount }),
  reset: () => set(initialState),
}));
