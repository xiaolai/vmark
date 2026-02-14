/**
 * Drop Zone Store
 *
 * Purpose: Tracks file drag-and-drop state over the editor area to show
 *   visual drop zone indicators (image count, type detection).
 *
 * @module stores/dropZoneStore
 */

import { create } from "zustand";

interface DropZoneState {
  /** Whether files are currently being dragged over the editor */
  isDragging: boolean;
  /** Whether the dragged files include images */
  hasImages: boolean;
  /** Number of image files being dragged */
  imageCount: number;
}

interface DropZoneActions {
  /** Set dragging state with image info */
  setDragging: (isDragging: boolean, hasImages?: boolean, imageCount?: number) => void;
  /** Reset to initial state */
  reset: () => void;
}

const initialState: DropZoneState = {
  isDragging: false,
  hasImages: false,
  imageCount: 0,
};

export const useDropZoneStore = create<DropZoneState & DropZoneActions>((set) => ({
  ...initialState,

  setDragging: (isDragging, hasImages = false, imageCount = 0) =>
    set({ isDragging, hasImages, imageCount }),

  reset: () => set(initialState),
}));
