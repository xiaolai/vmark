/**
 * Image Paste Toast Store — slice projection of usePopupStore.
 * Routes to popupStore's `imagePasteToast` slice.
 *
 * @module stores/imagePasteToastStore
 */

import { usePopupStore } from "./popupStore";
import { createSliceShim } from "./_shimHelper";
import type { ImagePathResult } from "@/utils/imagePathDetection";
import type { AnchorRect } from "@/utils/popupPosition";

export const useImagePasteToastStore = createSliceShim("imagePasteToast", {
  showToast: (data: {
    imagePath: string;
    imageType: "url" | "localPath";
    anchorRect: AnchorRect;
    editorDom: HTMLElement;
    onConfirm: () => void;
    onDismiss: () => void;
  }) => usePopupStore.getState().imagePasteShowToast(data),
  showMultiToast: (data: {
    imageResults: ImagePathResult[];
    anchorRect: AnchorRect;
    editorDom: HTMLElement;
    onConfirm: () => void;
    onDismiss: () => void;
  }) => usePopupStore.getState().imagePasteShowMultiToast(data),
  hideToast: () => usePopupStore.getState().imagePasteHideToast(),
  confirm: () => usePopupStore.getState().imagePasteConfirm(),
  dismiss: () => usePopupStore.getState().imagePasteDismiss(),
});
