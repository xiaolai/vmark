/**
 * Image Paste Toast Store — confirm/dismiss toast for pasted image paths.
 *
 * Standalone Zustand store (T09 revert, WI-9 plan-20260803-161713): the
 * former merged-store slice re-inlined. The shim API is the contract —
 * consumers are unchanged.
 *
 * @module stores/imagePasteToastStore
 */

import { create } from "zustand";
import type { ImagePathResult } from "@/utils/imagePathDetection";
import type { AnchorRect } from "@/utils/popupPosition";

interface ImagePasteToastData {
  isOpen: boolean;
  imagePath: string;
  imageType: "url" | "localPath";
  imagePaths: string[];
  imageResults: ImagePathResult[];
  isMultiple: boolean;
  imageCount: number;
  anchorRect: AnchorRect | null;
  editorDom: HTMLElement | null;
  onConfirm: (() => void) | null;
  onDismiss: (() => void) | null;
}

interface ImagePasteToastState extends ImagePasteToastData {
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

const initialState: ImagePasteToastData = {
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

export const useImagePasteToastStore = create<ImagePasteToastState>((set, get) => ({
  ...initialState,
  showToast: (data) =>
    set({
      ...initialState,
      isOpen: true,
      imagePath: data.imagePath,
      imageType: data.imageType,
      imageCount: 1,
      anchorRect: data.anchorRect,
      editorDom: data.editorDom,
      onConfirm: data.onConfirm,
      onDismiss: data.onDismiss,
    }),
  showMultiToast: (data) =>
    set({
      ...initialState,
      isOpen: true,
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
  // `hideToast` resets WITHOUT invoking callbacks — only confirm/dismiss do.
  hideToast: () => set(initialState),
  // Capture the callback, reset first, then invoke (same pattern as
  // headingPicker.selectHeading): a callback that opens a new toast must not
  // be clobbered by the reset, and a throwing callback must not leave the
  // toast stuck open.
  confirm: () => {
    const { onConfirm } = get();
    set(initialState);
    if (onConfirm) onConfirm();
  },
  dismiss: () => {
    const { onDismiss } = get();
    set(initialState);
    if (onDismiss) onDismiss();
  },
}));
