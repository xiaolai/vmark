/**
 * Popup-store editing/toast action group — blockMathEditing, dropZone,
 * editorContextMenu, imageContextMenu, imagePasteToast, and
 *
 * Purpose: action implementations for the transient editing-state and
 * image-toast slices of the popup store. Extracted verbatim from
 * `../popupStore.ts` (pure code motion; behavior unchanged). The
 * `EditingPopupActions` interface lives in `./types.ts` (one-directional
 * imports — no cycles). The composition root spreads
 * `createEditingPopupActions(set, get)` into the store factory.
 *
 * @module stores/popupStore/editingActions
 */

import {
  initialBlockMathEditing,
  initialDropZone,
  initialEditorContextMenu,
  initialImageContextMenu,
  initialImagePasteToast,
} from "./slices";
import type { EditingPopupActions, PopupGet, PopupSet } from "./types";

export function createEditingPopupActions(
  set: PopupSet,
  get: PopupGet,
): EditingPopupActions {
  return {
    /* blockMathEditing */
    blockMathStartEditing: (pos, content) =>
      set({ blockMathEditing: { editingPos: pos, originalContent: content } }),
    blockMathExitEditing: () => set({ blockMathEditing: initialBlockMathEditing }),
    blockMathIsEditingAt: (pos) => get().blockMathEditing.editingPos === pos,

    /* dropZone */
    dropZoneSetDragging: (isDragging, hasImages = false, imageCount = 0) =>
      set({ dropZone: { isDragging, hasImages, imageCount } }),
    dropZoneReset: () => set({ dropZone: initialDropZone }),

    /* editorContextMenu */
    editorContextOpenMenu: (data) =>
      set({
        editorContextMenu: {
          isOpen: true,
          position: data.position,
          snapshot: data.snapshot,
        },
      }),
    editorContextCloseMenu: () => set({ editorContextMenu: initialEditorContextMenu }),

    /* imageContextMenu */
    imageContextOpenMenu: (data) =>
      set({
        imageContextMenu: {
          isOpen: true,
          position: data.position,
          imageSrc: data.imageSrc,
          imageNodePos: data.imageNodePos,
        },
      }),
    imageContextCloseMenu: () => set({ imageContextMenu: initialImageContextMenu }),

    /* imagePasteToast */
    imagePasteShowToast: (data) =>
      set({
        imagePasteToast: {
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
        },
      }),
    imagePasteShowMultiToast: (data) =>
      set({
        imagePasteToast: {
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
        },
      }),
    imagePasteHideToast: () => set({ imagePasteToast: initialImagePasteToast }),
    // Capture the callback, reset first, then invoke (same pattern as
    // headingSelectHeading): a callback that opens a new toast must not be
    // clobbered by the reset, and a throwing callback must not leave the
    // toast stuck open.
    imagePasteConfirm: () => {
      const { onConfirm } = get().imagePasteToast;
      set({ imagePasteToast: initialImagePasteToast });
      if (onConfirm) onConfirm();
    },
    imagePasteDismiss: () => {
      const { onDismiss } = get().imagePasteToast;
      set({ imagePasteToast: initialImagePasteToast });
      if (onDismiss) onDismiss();
    },

  };
}
