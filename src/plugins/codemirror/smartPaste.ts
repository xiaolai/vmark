/**
 * Smart Paste Plugin for CodeMirror
 *
 * Features:
 * - When text is selected and user pastes a URL, creates a markdown link
 * - When pasting an image URL/path, prompts user to insert as image
 */

import { EditorView } from "@codemirror/view";
import { exists } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";
import { message } from "@tauri-apps/plugin-dialog";
import { copyImageToAssets } from "@/hooks/useImageOperations";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { useDocumentStore } from "@/stores/documentStore";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { useTabStore } from "@/stores/tabStore";
import { detectMultipleImagePaths, type ImagePathResult } from "@/utils/imagePathDetection";
import { encodeMarkdownUrl } from "@/utils/markdownUrl";
import { parseMultiplePaths } from "@/utils/multiImageParsing";
import { findWordAtCursorSource } from "@/plugins/toolbarActions/sourceAdapterLinks";

/**
 * Check if a CodeMirror view is still connected and valid.
 */
function isViewConnected(view: EditorView): boolean {
  try {
    return view.dom?.isConnected ?? false;
  } catch {
    return false;
  }
}

/**
 * Check if a string looks like a valid URL.
 */
function isValidUrl(str: string): boolean {
  const trimmed = str.trim();
  // Must start with http:// or https://
  return /^https?:\/\/\S+/.test(trimmed);
}

/**
 * Get the active document file path for the current window.
 */
function getActiveFilePath(): string | null {
  try {
    const windowLabel = getWindowLabel();
    const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
    if (!tabId) return null;
    return useDocumentStore.getState().getDocument(tabId)?.filePath ?? null;
  } catch {
    return null;
  }
}

/**
 * Expand home path (~/) to absolute path.
 */
async function expandHomePath(path: string): Promise<string | null> {
  if (!path.startsWith("~/")) return path;

  try {
    const home = await homeDir();
    return join(home, path.slice(2));
  } catch {
    return null;
  }
}

/**
 * Validate a local image path exists.
 */
async function validateLocalPath(path: string): Promise<boolean> {
  try {
    return await exists(path);
  } catch {
    return false;
  }
}

/**
 * Get anchor rect for toast positioning based on cursor position.
 */
function getToastAnchorRect(view: EditorView, pos: number): { top: number; left: number; bottom: number; right: number } {
  try {
    const coords = view.coordsAtPos(pos);
    if (coords) {
      return {
        top: coords.top,
        left: coords.left,
        bottom: coords.bottom,
        right: coords.right,
      };
    }
  } catch {
    // Fallback
  }
  return {
    top: window.innerHeight / 2 - 20,
    left: window.innerWidth / 2,
    bottom: window.innerHeight / 2,
    right: window.innerWidth / 2,
  };
}

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
    console.warn("[smartPaste] View disconnected, aborting image insert");
    return;
  }

  const filePath = getActiveFilePath();

  let imagePath = detection.path;

  if (detection.needsCopy) {
    if (!filePath) {
      await message(
        "Please save the document first before inserting images from local paths. " +
          "Images are stored relative to the document location.",
        { title: "Unsaved Document", kind: "warning" }
      );
      return;
    }

    try {
      let sourcePath = detection.path;
      if (detection.type === "homePath") {
        const expanded = await expandHomePath(detection.path);
        if (!expanded) {
          await message("Failed to resolve home directory path.", { kind: "error" });
          return;
        }
        sourcePath = expanded;
      }

      imagePath = await copyImageToAssets(sourcePath, filePath);
    } catch (error) {
      console.error("[smartPaste] Failed to copy image to assets:", error);
      await message("Failed to copy image to assets folder.", { kind: "error" });
      return;
    }
  }

  // Re-verify view is still connected after async operations
  if (!isViewConnected(view)) {
    console.warn("[smartPaste] View disconnected after async, aborting image insert");
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
    console.warn("[smartPaste] Selection changed during async, using current position");
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
 * Paste text as plain text.
 * Uses captured positions to handle async timing.
 */
function pasteAsText(view: EditorView, text: string, capturedFrom: number, capturedTo: number): void {
  if (!isViewConnected(view)) {
    return;
  }

  // Use captured positions if selection hasn't changed, otherwise use current
  const { from: currentFrom, to: currentTo } = view.state.selection.main;
  const docLength = view.state.doc.length;
  const from = currentFrom === capturedFrom && currentTo === capturedTo
    ? Math.min(capturedFrom, docLength)
    : Math.min(currentFrom, docLength);
  const to = currentFrom === capturedFrom && currentTo === capturedTo
    ? Math.min(capturedTo, docLength)
    : Math.min(currentTo, docLength);

  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
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

  useImagePasteToastStore.getState().showToast({
    imagePath: detection.path,
    imageType,
    anchorRect,
    editorDom: view.dom,
    onConfirm: () => {
      if (!isViewConnected(view)) {
        console.warn("[smartPaste] View disconnected, cannot insert image");
        return;
      }
      insertImageMarkdown(view, detection, capturedFrom, capturedTo, altText).catch((error) => {
        console.error("[smartPaste] Failed to insert image:", error);
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
 * Check if pasted text is an image path and handle accordingly.
 * Returns true if handled (showing toast or async validation started).
 * Supports both single and multiple image paths.
 * @param originalText - The original pasted text (untrimmed) for fallback paste
 */
function tryImagePaste(view: EditorView, originalText: string): boolean {
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
      console.error("[smartPaste] Failed to validate path:", error);
      if (isViewConnected(view)) {
        pasteAsText(view, originalText, insertFrom, insertTo);
      }
    });
    return true;
  }

  // Multiple images: new behavior (no alt text for multi-image)
  validateAndShowMultiToast(view, detection.results, originalText, insertFrom, insertTo).catch((error) => {
    console.error("[smartPaste] Failed to validate multi-image paths:", error);
    if (isViewConnected(view)) {
      pasteAsText(view, originalText, insertFrom, insertTo);
    }
  });
  return true;
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

  useImagePasteToastStore.getState().showMultiToast({
    imageResults: results,
    anchorRect,
    editorDom: view.dom,
    onConfirm: () => {
      if (!isViewConnected(view)) {
        console.warn("[smartPaste] View disconnected, cannot insert images");
        return;
      }
      insertMultipleImageMarkdown(view, results, capturedFrom, capturedTo).catch((error) => {
        console.error("[smartPaste] Failed to insert images:", error);
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
    console.warn("[smartPaste] View disconnected, aborting multi-image insert");
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
          "Please save the document first before inserting images from local paths. " +
            "Images are stored relative to the document location.",
          { title: "Unsaved Document", kind: "warning" }
        );
        return;
      }

      try {
        let sourcePath = detection.path;
        if (detection.type === "homePath") {
          const expanded = await expandHomePath(detection.path);
          if (!expanded) {
            await message("Failed to resolve home directory path.", { kind: "error" });
            return;
          }
          sourcePath = expanded;
        }

        imagePath = await copyImageToAssets(sourcePath, filePath);
      } catch (error) {
        console.error("[smartPaste] Failed to copy image to assets:", error);
        await message("Failed to copy image to assets folder.", { kind: "error" });
        return;
      }
    }

    imagePaths.push(imagePath);
  }

  // Re-verify view is still connected after async operations
  if (!isViewConnected(view)) {
    console.warn("[smartPaste] View disconnected after async, aborting image insert");
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
    console.warn("[smartPaste] Selection changed during async, using current position");
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
 * Creates an extension that intercepts paste events
 * and converts URL paste on selection to markdown links,
 * and prompts for image URL/path pasting.
 */
export function createSmartPastePlugin() {
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      const pastedText = event.clipboardData?.getData("text/plain");
      if (!pastedText) return false;

      const { from, to } = view.state.selection.main;
      const trimmedText = pastedText.trim();

      // First, check for image path/URL (works with or without selection)
      // Pass the original text for fallback paste (preserves whitespace)
      if (tryImagePaste(view, pastedText)) {
        event.preventDefault();
        return true;
      }

      // No selection - let default paste handle it
      if (from === to) return false;

      // Not a URL - let default paste handle it
      if (!isValidUrl(trimmedText)) return false;

      // Get selected text
      const selectedText = view.state.doc.sliceString(from, to);

      // Don't wrap if selected text already looks like a markdown link
      if (/^\[.*\]\(.*\)$/.test(selectedText)) return false;

      // Create markdown link
      const linkMarkdown = `[${selectedText}](${trimmedText})`;

      // Prevent default paste and insert link
      event.preventDefault();
      view.dispatch({
        changes: { from, to, insert: linkMarkdown },
        selection: { anchor: from + linkMarkdown.length },
      });

      return true;
    },
  });
}
