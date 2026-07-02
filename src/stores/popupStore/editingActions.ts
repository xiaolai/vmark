/**
 * Popup-store editing/toast action group — blockMathEditing, dropZone,
 * imageContextMenu, imagePasteToast, and inlineMathEditing.
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
  initialImageContextMenu,
  initialImagePasteToast,
  initialInlineMathEditing,
} from "./slices";
import type { EditingPopupActions, PopupGet, PopupSet } from "./types";

export function createEditingPopupActions(
  set: PopupSet,
  get: PopupGet,
): EditingPopupActions {
  /**
   * Clear inline-math editing state, guarded by position so a stale call
   * (e.g. from an unmounting editor) cannot clobber a newer session.
   * Shared by inlineMathStopEditing and inlineMathClear (identical semantics).
   */
  const inlineMathClearAt = (pos: number) => {
    if (get().inlineMathEditing.editingNodePos === pos) {
      set({ inlineMathEditing: initialInlineMathEditing });
    }
  };

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

    /* inlineMathEditing */
    inlineMathStartEditing: (pos, callbacks) => {
      const { editingNodePos, activeCallbacks } = get().inlineMathEditing;
      if (editingNodePos !== null && editingNodePos !== pos && activeCallbacks) {
        activeCallbacks.forceExit();
      }
      set({
        inlineMathEditing: { editingNodePos: pos, activeCallbacks: callbacks },
      });
    },
    inlineMathStopEditing: inlineMathClearAt,
    inlineMathIsEditingAt: (pos) => get().inlineMathEditing.editingNodePos === pos,
    inlineMathClear: inlineMathClearAt,
  };
}
