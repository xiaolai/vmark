/**
 * Image Paste Toast Store
 *
 * Manages state for the paste confirmation toast that appears when
 * pasting text that looks like an image URL or path.
 */

import { create } from "zustand";

interface AnchorRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

interface ImagePasteToastState {
  isOpen: boolean;
  imagePath: string;
  imageType: "url" | "localPath";
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
  hideToast: () => void;
  confirm: () => void;
  dismiss: () => void;
}

type ImagePasteToastStore = ImagePasteToastState & ImagePasteToastActions;

const initialState: ImagePasteToastState = {
  isOpen: false,
  imagePath: "",
  imageType: "url",
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
