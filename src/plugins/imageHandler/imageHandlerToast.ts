/**
 * Image Handler Toast Operations
 *
 * Purpose: Functions for showing image paste confirmation toasts —
 * single image toast, multi-image toast, and path validation before showing.
 *
 * @coordinates-with plugins/imageHandler/tiptap.ts — extension entry point
 * @coordinates-with plugins/imageHandler/imageHandlerUtils.ts — shared utilities
 * @coordinates-with plugins/imageHandler/imageHandlerInsert.ts — image insertion
 * @coordinates-with stores/imagePasteToastStore.ts — toast UI state
 * @module plugins/imageHandler/imageHandlerToast
 */

import type { EditorView } from "@tiptap/pm/view";
import { imeToast as toast } from "@/utils/imeToast";
import i18n from "@/i18n";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { detectMultipleImagePaths, type ImagePathResult } from "@/utils/imagePathDetection";
import { parseMultiplePaths } from "@/utils/multiImageParsing";
import { insertImageFromPath, insertMultipleImages, pasteAsText } from "./imageHandlerInsert";
import { imageHandlerWarn, imageHandlerError } from "@/utils/debug";
import {
  isViewConnected,
  validateLocalPath,
  expandHomePath,
  getToastAnchorRect,
} from "./imageHandlerUtils";

/**
 * Check if pasted text is an image path and show toast.
 * Returns true if we're handling it (showing toast), false otherwise.
 * Supports both single and multiple image paths.
 */
export function tryTextImagePaste(view: EditorView, text: string): boolean {
  if (!text) return false;

  // Parse potential paths from clipboard text
  const { paths } = parseMultiplePaths(text);
  if (paths.length === 0) return false;

  // Check if ALL parsed items are valid images
  const detection = detectMultipleImagePaths(paths);
  if (!detection.allImages) return false;

  // Capture selection state at paste time
  const { from, to } = view.state.selection;
  // Capture selected text to use as alt text
  const capturedAltText = from !== to ? view.state.doc.textBetween(from, to) : "";

  if (detection.imageCount === 1) {
    // Single image: use existing behavior
    const result = detection.results[0];

    // For URLs, show toast immediately
    if (result.type === "url" || result.type === "dataUrl") {
      showImagePasteToast(view, result, text, from, to, capturedAltText);
      return true;
    }

    // For local paths, validate first
    validateAndShowToast(view, result, text, from, to, capturedAltText).catch((error) => {
      imageHandlerError("Failed to validate path:", error);
      if (isViewConnected(view)) {
        pasteAsText(view, text, from, to);
      }
    });
    return true;
  }

  // Multiple images: new behavior (alt text only applies to single image)
  validateAndShowMultiToast(view, detection.results, text, from, to).catch((error) => {
    imageHandlerError("Failed to validate multi-image paths:", error);
    if (isViewConnected(view)) {
      pasteAsText(view, text, from, to);
    }
  });
  return true;
}

/**
 * Validate local path and show toast if valid.
 */
async function validateAndShowToast(
  view: EditorView,
  detection: ImagePathResult,
  originalText: string,
  capturedFrom: number,
  capturedTo: number,
  capturedAltText: string
): Promise<void> {
  let pathToCheck = detection.path;

  // Expand home path for validation
  if (detection.type === "homePath") {
    const expanded = await expandHomePath(detection.path);
    if (!expanded) {
      // Home expansion failed - just paste as text + tell the user why
      if (isViewConnected(view)) {
        pasteAsText(view, originalText, capturedFrom, capturedTo);
        toast.info(i18n.t("dialog:toast.imagePathFallbackPasted"));
      }
      return;
    }
    pathToCheck = expanded;
  }

  // For absolute paths, validate existence
  if (detection.type === "absolutePath" || detection.type === "homePath") {
    const exists = await validateLocalPath(pathToCheck);
    if (!exists) {
      // File doesn't exist - paste as text + tell the user why
      if (isViewConnected(view)) {
        pasteAsText(view, originalText, capturedFrom, capturedTo);
        toast.info(i18n.t("dialog:toast.imagePathFallbackPasted"));
      }
      return;
    }
  }

  // Verify view is still connected before showing toast
  if (!isViewConnected(view)) {
    return;
  }

  // For relative paths, we can't validate without doc path, show toast anyway
  showImagePasteToast(view, detection, originalText, capturedFrom, capturedTo, capturedAltText);
}

/**
 * Show the image paste confirmation toast.
 */
function showImagePasteToast(
  view: EditorView,
  detection: ImagePathResult,
  originalText: string,
  capturedFrom: number,
  capturedTo: number,
  capturedAltText: string
): void {
  const anchorRect = getToastAnchorRect(view);
  const imageType = detection.type === "url" || detection.type === "dataUrl" ? "url" : "localPath";

  useImagePasteToastStore.getState().showToast({
    imagePath: detection.path,
    imageType,
    anchorRect,
    editorDom: view.dom,
    /* v8 ignore start -- @preserve reason: onConfirm callback only fires on user click in the toast UI; not triggered in unit tests */
    onConfirm: () => {
      if (!isViewConnected(view)) {
        imageHandlerWarn("View disconnected, cannot insert image");
        return;
      }
      insertImageFromPath(view, detection, capturedFrom, capturedTo, capturedAltText).catch((error) => {
        imageHandlerError("Failed to insert image:", error);
        toast.error(i18n.t("dialog:toast.failedToInsertImage"));
      });
    },
    /* v8 ignore stop */
    onDismiss: () => {
      if (!isViewConnected(view)) {
        return;
      }
      pasteAsText(view, originalText, capturedFrom, capturedTo);
    },
  });
}

/**
 * Validate multiple local paths and show multi-image toast if all valid.
 */
async function validateAndShowMultiToast(
  view: EditorView,
  results: ImagePathResult[],
  originalText: string,
  capturedFrom: number,
  capturedTo: number
): Promise<void> {
  // Validate all local paths in parallel
  const validationPromises = results.map(async (result) => {
    // URLs don't need validation
    if (result.type === "url" || result.type === "dataUrl") {
      return { result, valid: true };
    }

    let pathToCheck = result.path;

    // Expand home paths
    if (result.type === "homePath") {
      const expanded = await expandHomePath(result.path);
      if (!expanded) {
        return { result, valid: false };
      }
      pathToCheck = expanded;
    }

    // Validate absolute and home paths exist
    if (result.type === "absolutePath" || result.type === "homePath") {
      const exists = await validateLocalPath(pathToCheck);
      return { result, valid: exists };
    }

    // Relative paths can't be validated without doc path, assume valid
    return { result, valid: true };
  });

  const validations = await Promise.all(validationPromises);

  // If any path is invalid, paste as text + tell the user why
  if (validations.some((v) => !v.valid)) {
    if (isViewConnected(view)) {
      pasteAsText(view, originalText, capturedFrom, capturedTo);
      toast.info(i18n.t("dialog:toast.imagePathFallbackPasted"));
    }
    return;
  }

  // Verify view is still connected
  if (!isViewConnected(view)) {
    return;
  }

  // All paths valid - show multi-image toast
  showMultiImagePasteToast(view, results, originalText, capturedFrom, capturedTo);
}

/**
 * Show the multi-image paste confirmation toast.
 */
function showMultiImagePasteToast(
  view: EditorView,
  results: ImagePathResult[],
  originalText: string,
  capturedFrom: number,
  capturedTo: number
): void {
  const anchorRect = getToastAnchorRect(view);

  useImagePasteToastStore.getState().showMultiToast({
    imageResults: results,
    anchorRect,
    editorDom: view.dom,
    /* v8 ignore start -- @preserve reason: onConfirm callback only fires on user click in the toast UI; not triggered in unit tests */
    onConfirm: () => {
      if (!isViewConnected(view)) {
        imageHandlerWarn("View disconnected, cannot insert images");
        return;
      }
      insertMultipleImages(view, results, capturedFrom, capturedTo).catch((error) => {
        imageHandlerError("Failed to insert images:", error);
        toast.error(
          i18n.t("dialog:toast.failedToInsertImages", { count: results.length }),
        );
      });
    },
    /* v8 ignore stop */
    onDismiss: () => {
      if (!isViewConnected(view)) {
        return;
      }
      pasteAsText(view, originalText, capturedFrom, capturedTo);
    },
  });
}
