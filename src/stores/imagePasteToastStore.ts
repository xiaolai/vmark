/**
 * Image Paste Toast Store
 *
 * Purpose: State for the paste confirmation toast that appears when pasting
 *   text detected as an image URL or local path. Supports single and
 *   multiple image paths with distinct toast presentations.
 *
 * Pipeline: Paste event → imagePathDetection util detects image paths →
 *   showToast/showMultiToast → user confirms (insert as image) or
 *   dismisses (paste as text) → callbacks clean up and toast hides.
 *
 * @coordinates-with imagePathDetection.ts — detects image paths in pasted text
 * @coordinates-with ImagePasteToast component — renders the confirmation UI
 * @module stores/imagePasteToastStore
 */

import { create } from "zustand";
import type { ImagePathResult } from "@/utils/imagePathDetection";

interface AnchorRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

interface ImagePasteToastState {
  isOpen: boolean;
  // Single image (backward compat)
  imagePath: string;
  imageType: "url" | "localPath";
  // Multi-image support
  imagePaths: string[];
  imageResults: ImagePathResult[];
  isMultiple: boolean;
  imageCount: number;
  // Common
  anchorRect: AnchorRect | null;
  editorDom: HTMLElement | null;
  onConfirm: (() => void) | null;
  onDismiss: (() => void) | null;
}

interface ImagePasteToastActions {
  showToast: (data: {
    imagePath: string;
    imageType: "url" | "localPath";
    anchorRect: AnchorRect;
    editorDom: HTMLElement;
    onConfirm: () => void;
    onDismiss: () => void;
  }) => void;
  showMultiToast: (data: {
    imageResults: ImagePathResult[];
    anchorRect: AnchorRect;
    editorDom: HTMLElement;
    onConfirm: () => void;
    onDismiss: () => void;
  }) => void;
  hideToast: () => void;
  confirm: () => void;
  dismiss: () => void;
}

type ImagePasteToastStore = ImagePasteToastState & ImagePasteToastActions;

const initialState: ImagePasteToastState = {
  isOpen: false,
  imagePath: "",
  imageType: "url",
  imagePaths: [],
  imageResults: [],
  isMultiple: false,
  imageCount: 0,
  anchorRect: null,
  editorDom: null,
  onConfirm: null,
  onDismiss: null,
};

export const useImagePasteToastStore = create<ImagePasteToastStore>((set, get) => ({
  ...initialState,

  showToast: (data) =>
    set({
      isOpen: true,
      imagePath: data.imagePath,
      imageType: data.imageType,
      imagePaths: [],
      imageResults: [],
      isMultiple: false,
      imageCount: 1,
      anchorRect: data.anchorRect,
      editorDom: data.editorDom,
      onConfirm: data.onConfirm,
      onDismiss: data.onDismiss,
    }),

  showMultiToast: (data) =>
    set({
      isOpen: true,
      imagePath: "",
      imageType: "localPath",
      imagePaths: data.imageResults.map((r) => r.path),
      imageResults: data.imageResults,
      isMultiple: true,
      imageCount: data.imageResults.length,
      anchorRect: data.anchorRect,
      editorDom: data.editorDom,
      onConfirm: data.onConfirm,
      onDismiss: data.onDismiss,
    }),

  hideToast: () => set(initialState),

  confirm: () => {
    const { onConfirm } = get();
    if (onConfirm) {
      onConfirm();
    }
    set(initialState);
  },

  dismiss: () => {
    const { onDismiss } = get();
    if (onDismiss) {
      onDismiss();
    }
    set(initialState);
  },
}));
