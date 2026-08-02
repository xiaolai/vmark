/**
 * Smart Paste Image Handling
 *
 * Purpose: Handles single and multi-image paste logic for Source mode, including
 * path validation, toast confirmation, and markdown insertion.
 *
 * Pipeline: detect image paths -> validate -> show toast -> copy to assets -> insert markdown
 *
 * @coordinates-with smartPaste.ts — plugin factory
 * @coordinates-with smartPasteUtils.ts — shared utilities
 * @coordinates-with stores/imagePasteToastStore.ts — toast UI for image paste confirmation
 * @module plugins/codemirror/smartPasteImage
 */

import { EditorView } from "@codemirror/view";
import { message } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { copyImageToAssets } from "@/hooks/useImageOperations";
import { hostPopups } from "@/plugins/shared/hostPopups";
import { smartPasteWarn, smartPasteError } from "@/utils/debug";
import { detectMultipleImagePaths, type ImagePathResult } from "@/utils/imagePathDetection";
import { encodeMarkdownUrl } from "@/utils/markdownUrl";
import { parseMultiplePaths } from "@/utils/multiImageParsing";
import { findWordAtCursorSource } from "@/plugins/toolbarActions/sourceAdapterLinks";
import {
  isViewConnected,
  getActiveFilePath,
  expandHomePath,
  validateLocalPath,
  getToastAnchorRect,
  pasteAsText,
} from "./smartPasteUtils";

/**
 * Insert image markdown after user confirmation.
 * Takes captured positions to handle async timing.
 */
async function insertImageMarkdown(
  view: EditorView,
  detection: ImagePathResult,
  capturedFrom: number,
  capturedTo: number,
  altText: string
): Promise<void> {
  // Verify view is still connected
  if (!isViewConnected(view)) {
    smartPasteWarn("View disconnected, aborting image insert");
    return;
  }

  const filePath = getActiveFilePath();

  let imagePath = detection.path;

  if (detection.needsCopy) {
    if (!filePath) {
      await message(
        i18n.t("dialog:unsavedDocument.messageInsertImagesLocal"),
        { title: i18n.t("dialog:unsavedDocument.title"), kind: "warning" }
      );
      return;
    }

    try {
      let sourcePath = detection.path;
      if (detection.type === "homePath") {
        const expanded = await expandHomePath(detection.path);
        if (!expanded) {
          await message(i18n.t("dialog:toast.failedToResolveHomePath"), { kind: "error" });
          return;
        }
        sourcePath = expanded;
      }

      imagePath = await copyImageToAssets(sourcePath, filePath);
    } catch (error) {
      smartPasteError("Failed to copy image to assets:", error);
      await message(i18n.t("dialog:toast.failedToCopyToAssets"), { kind: "error" });
      return;
    }
  }

  // Re-verify view is still connected after async operations
  if (!isViewConnected(view)) {
    smartPasteWarn("View disconnected after async, aborting image insert");
    return;
  }

  // Use captured positions if selection hasn't changed significantly
  const { from: currentFrom, to: currentTo } = view.state.selection.main;
  const selectionChanged = currentFrom !== capturedFrom || currentTo !== capturedTo;

  // Clamp positions to document length to prevent out-of-bounds
  const docLength = view.state.doc.length;
  const insertFrom = selectionChanged ? Math.min(currentFrom, docLength) : Math.min(capturedFrom, docLength);
  const insertTo = selectionChanged ? Math.min(currentTo, docLength) : Math.min(capturedTo, docLength);

  if (selectionChanged) {
    smartPasteWarn("Selection changed during async, using current position");
  }

  // Insert image markdown (encode URL for spaces)
  const markdown = `![${altText}](${encodeMarkdownUrl(imagePath)})`;
  view.dispatch({
    changes: { from: insertFrom, to: insertTo, insert: markdown },
    selection: { anchor: insertFrom + markdown.length },
  });
  view.focus();
}

/**
 * Show image paste confirmation toast for source mode.
 */
function showImagePasteToast(
  view: EditorView,
  detection: ImagePathResult,
  originalText: string,
  capturedFrom: number,
  capturedTo: number,
  altText: string
): void {
  const anchorRect = getToastAnchorRect(view, capturedFrom);
  const imageType = detection.type === "url" || detection.type === "dataUrl" ? "url" : "localPath";

  hostPopups.showImagePasteToast({
    imagePath: detection.path,
    imageType,
    anchorRect,
    editorDom: view.dom,
    onConfirm: () => {
      if (!isViewConnected(view)) {
        smartPasteWarn("View disconnected, cannot insert image");
        return;
      }
      insertImageMarkdown(view, detection, capturedFrom, capturedTo, altText).catch((error) => {
        smartPasteError("Failed to insert image:", error);
      });
    },
    onDismiss: () => {
      if (!isViewConnected(view)) {
        return;
      }
      pasteAsText(view, originalText, capturedFrom, capturedTo);
    },
  });
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
  altText: string
): Promise<void> {
  let pathToCheck = detection.path;

  // Expand home path for validation
  if (detection.type === "homePath") {
    const expanded = await expandHomePath(detection.path);
    if (!expanded) {
      // Home expansion failed - paste as text
      if (isViewConnected(view)) {
        pasteAsText(view, originalText, capturedFrom, capturedTo);
      }
      return;
    }
    pathToCheck = expanded;
  }

  // For absolute paths, validate existence
  if (detection.type === "absolutePath" || detection.type === "homePath") {
    const pathExists = await validateLocalPath(pathToCheck);
    if (!pathExists) {
      // File doesn't exist - paste as text
      /* v8 ignore next -- @preserve Race-condition guard: view can be destroyed between async path validation and the paste call; not testable without complex mocking */
      if (isViewConnected(view)) {
        pasteAsText(view, originalText, capturedFrom, capturedTo);
      }
      return;
    }
  }

  // Verify view is still connected before showing toast
  if (!isViewConnected(view)) {
    return;
  }

  // Valid path - show toast
  showImagePasteToast(view, detection, originalText, capturedFrom, capturedTo, altText);
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
      const pathExists = await validateLocalPath(pathToCheck);
      return { result, valid: pathExists };
    }

    // Relative paths can't be validated without doc path, assume valid
    return { result, valid: true };
  });

  const validations = await Promise.all(validationPromises);

  // If any path is invalid, paste as text
  if (validations.some((v) => !v.valid)) {
    if (isViewConnected(view)) {
      pasteAsText(view, originalText, capturedFrom, capturedTo);
    }
    return;
  }

  // Verify view is still connected
  /* v8 ignore next -- @preserve Race-condition guard: view can be destroyed during async parallel path validation; not testable without complex mocking */
  if (!isViewConnected(view)) {
    return;
  }

  // All paths valid - show multi-image toast
  showMultiImagePasteToast(view, results, originalText, capturedFrom, capturedTo);
}

/**
 * Show the multi-image paste confirmation toast for source mode.
 */
function showMultiImagePasteToast(
  view: EditorView,
  results: ImagePathResult[],
  originalText: string,
  capturedFrom: number,
  capturedTo: number
): void {
  const anchorRect = getToastAnchorRect(view, capturedFrom);

  hostPopups.showImagePasteToast({
    imageResults: results,
    anchorRect,
    editorDom: view.dom,
    onConfirm: () => {
      if (!isViewConnected(view)) {
        smartPasteWarn("View disconnected, cannot insert images");
        return;
      }
      insertMultipleImageMarkdown(view, results, capturedFrom, capturedTo).catch((error) => {
        smartPasteError("Failed to insert images:", error);
      });
    },
    onDismiss: () => {
      if (!isViewConnected(view)) {
        return;
      }
      pasteAsText(view, originalText, capturedFrom, capturedTo);
    },
  });
}

/**
 * Insert multiple images as markdown.
 * Each image becomes `![](path)` on its own line.
 */
async function insertMultipleImageMarkdown(
  view: EditorView,
  results: ImagePathResult[],
  capturedFrom: number,
  capturedTo: number
): Promise<void> {
  // Verify view is still connected
  if (!isViewConnected(view)) {
    smartPasteWarn("View disconnected, aborting multi-image insert");
    return;
  }

  const filePath = getActiveFilePath();
  const imagePaths: string[] = [];

  // Process each image
  for (const detection of results) {
    let imagePath = detection.path;

    if (detection.needsCopy) {
      if (!filePath) {
        await message(
          i18n.t("dialog:unsavedDocument.messageInsertImagesLocal"),
          { title: i18n.t("dialog:unsavedDocument.title"), kind: "warning" }
        );
        return;
      }

      try {
        let sourcePath = detection.path;
        if (detection.type === "homePath") {
          const expanded = await expandHomePath(detection.path);
          if (!expanded) {
            await message(i18n.t("dialog:toast.failedToResolveHomePath"), { kind: "error" });
            return;
          }
          sourcePath = expanded;
        }

        imagePath = await copyImageToAssets(sourcePath, filePath);
      } catch (error) {
        smartPasteError("Failed to copy image to assets:", error);
        await message(i18n.t("dialog:toast.failedToCopyToAssets"), { kind: "error" });
        return;
      }
    }

    imagePaths.push(imagePath);
  }

  // Re-verify view is still connected after async operations
  if (!isViewConnected(view)) {
    smartPasteWarn("View disconnected after async, aborting image insert");
    return;
  }

  // Use captured positions if selection hasn't changed significantly
  const { from: currentFrom, to: currentTo } = view.state.selection.main;
  const selectionChanged = currentFrom !== capturedFrom || currentTo !== capturedTo;

  // Clamp positions to document length to prevent out-of-bounds
  const docLength = view.state.doc.length;
  const insertFrom = selectionChanged ? Math.min(currentFrom, docLength) : Math.min(capturedFrom, docLength);
  const insertTo = selectionChanged ? Math.min(currentTo, docLength) : Math.min(capturedTo, docLength);

  if (selectionChanged) {
    smartPasteWarn("Selection changed during async, using current position");
  }

  // Insert all images as markdown, each on its own line (encode URLs for spaces)
  const markdown = imagePaths.map((p) => `![](${encodeMarkdownUrl(p)})`).join("\n");
  view.dispatch({
    changes: { from: insertFrom, to: insertTo, insert: markdown },
    selection: { anchor: insertFrom + markdown.length },
  });
  view.focus();
}

/**
 * Check if pasted text is an image path and handle accordingly.
 * Returns true if handled (showing toast or async validation started).
 * Supports both single and multiple image paths.
 * @param originalText - The original pasted text (untrimmed) for fallback paste
 */
export function tryImagePaste(view: EditorView, originalText: string): boolean {
  if (!originalText) return false;

  // Parse potential paths from clipboard text
  const { paths } = parseMultiplePaths(originalText);
  if (paths.length === 0) return false;

  // Check if ALL parsed items are valid images
  const detection = detectMultipleImagePaths(paths);
  if (!detection.allImages) return false;

  // Capture selection state at paste time
  const { from, to } = view.state.selection.main;

  // Determine alt text and insertion range for single image
  let altText = "";
  let insertFrom = from;
  let insertTo = to;

  if (from !== to) {
    // Has selection: use as alt text
    altText = view.state.doc.sliceString(from, to);
    insertFrom = from;
    insertTo = to;
  } else {
    // No selection: try word expansion for alt text
    const wordRange = findWordAtCursorSource(view, from);
    if (wordRange) {
      altText = view.state.doc.sliceString(wordRange.from, wordRange.to);
      insertFrom = wordRange.from;
      insertTo = wordRange.to;
    }
  }

  if (detection.imageCount === 1) {
    // Single image: use existing behavior
    const result = detection.results[0];

    // For URLs, show toast immediately
    if (result.type === "url" || result.type === "dataUrl") {
      showImagePasteToast(view, result, originalText, insertFrom, insertTo, altText);
      return true;
    }

    // For local paths, validate async then show toast
    validateAndShowToast(view, result, originalText, insertFrom, insertTo, altText).catch((error) => {
      smartPasteError("Failed to validate path:", error);
      /* v8 ignore next -- @preserve Race-condition guard in error handler: view destroyed between async rejection and fallback paste; not testable */
      if (isViewConnected(view)) {
        pasteAsText(view, originalText, insertFrom, insertTo);
      }
    });
    return true;
  }

  // Multiple images: new behavior (no alt text for multi-image)
  validateAndShowMultiToast(view, detection.results, originalText, insertFrom, insertTo).catch((error) => {
    smartPasteError("Failed to validate multi-image paths:", error);
    /* v8 ignore next -- @preserve Race-condition guard in error handler: view destroyed between async rejection and fallback paste; not testable */
    if (isViewConnected(view)) {
      pasteAsText(view, originalText, insertFrom, insertTo);
    }
  });
  return true;
}
