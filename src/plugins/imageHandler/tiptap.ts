import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { message } from "@tauri-apps/plugin-dialog";
import { copyImageToAssets, saveImageToAssets, insertBlockImageNode } from "@/hooks/useImageOperations";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { useDocumentStore } from "@/stores/documentStore";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { detectMultipleImagePaths, hasImageExtension, type ImagePathResult } from "@/utils/imagePathDetection";
import { parseMultiplePaths } from "@/utils/multiImageParsing";
import { withReentryGuard } from "@/utils/reentryGuard";

const imageHandlerPluginKey = new PluginKey("imageHandler");
const CLIPBOARD_IMAGE_GUARD = "clipboard-image";

/**
 * Show warning that document must be saved first.
 */
async function showUnsavedDocWarning(): Promise<void> {
  await message(
    "Please save the document first before inserting images. " +
      "Images are stored relative to the document location.",
    { title: "Unsaved Document", kind: "warning" }
  );
}

/**
 * Check if editor view is still valid and connected.
 */
function isViewConnected(view: EditorView): boolean {
  try {
    return view.dom?.isConnected ?? false;
  } catch {
    return false;
  }
}

function getActiveFilePathForCurrentWindow(): string | null {
  try {
    const windowLabel = getWindowLabel();
    const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
    if (!tabId) return null;
    return useDocumentStore.getState().getDocument(tabId)?.filePath ?? null;
  } catch (error) {
    console.warn("[imageHandler] Failed to get active file path:", error);
    return null;
  }
}

/**
 * Validate a local image path exists (async file check).
 */
async function validateLocalPath(path: string): Promise<boolean> {
  try {
    const { exists } = await import("@tauri-apps/plugin-fs");
    return await exists(path);
  } catch {
    return false;
  }
}

/**
 * Expand home path (~/) to absolute path.
 */
async function expandHomePath(path: string): Promise<string | null> {
  if (!path.startsWith("~/")) return path;

  try {
    const { homeDir, join } = await import("@tauri-apps/api/path");
    const home = await homeDir();
    return join(home, path.slice(2));
  } catch {
    return null;
  }
}

/**
 * Get anchor rect for toast positioning based on current selection.
 */
function getToastAnchorRect(view: EditorView): { top: number; left: number; bottom: number; right: number } {
  const { from } = view.state.selection;
  try {
    const coords = view.coordsAtPos(from);
    return {
      top: coords.top,
      left: coords.left,
      bottom: coords.bottom,
      right: coords.right,
    };
  } catch {
    // Fallback to viewport center if position lookup fails
    return {
      top: window.innerHeight / 2 - 20,
      left: window.innerWidth / 2,
      bottom: window.innerHeight / 2,
      right: window.innerWidth / 2,
    };
  }
}

/**
 * Insert image from text path (after user confirmation).
 * Takes captured selection to handle async timing.
 * Uses captured selection text as alt text if available.
 */
async function insertImageFromPath(
  view: EditorView,
  detection: ImagePathResult,
  capturedFrom: number,
  capturedTo: number,
  capturedAltText: string
): Promise<void> {
  // Verify view is still connected
  if (!isViewConnected(view)) {
    console.warn("[imageHandler] View disconnected, aborting image insert");
    return;
  }

  const filePath = getActiveFilePathForCurrentWindow();
  const copyToAssets = useSettingsStore.getState().image.copyToAssets;

  let imagePath = detection.path;

  if (detection.needsCopy && copyToAssets) {
    // Copy to assets folder (default behavior)
    if (!filePath) {
      await showUnsavedDocWarning();
      return;
    }

    try {
      // For home paths, expand first
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
      console.error("Failed to copy image to assets:", error);
      await message("Failed to copy image to assets folder.", { kind: "error" });
      return;
    }
  } else if (detection.needsCopy && !copyToAssets) {
    // Use original path without copying
    if (detection.type === "homePath") {
      const expanded = await expandHomePath(detection.path);
      if (!expanded) {
        await message("Failed to resolve home directory path.", { kind: "error" });
        return;
      }
      imagePath = expanded;
    }
    // For absolute paths, use as-is
  }

  // Re-verify view is still connected after async operations
  if (!isViewConnected(view)) {
    console.warn("[imageHandler] View disconnected after async, aborting image insert");
    return;
  }

  // Restore selection to captured position if we have alt text to use
  // This ensures the selected text gets replaced
  if (capturedAltText && capturedFrom !== capturedTo) {
    const { state, dispatch } = view;
    const maxPos = state.doc.content.size;
    const safeFrom = Math.min(capturedFrom, maxPos);
    const safeTo = Math.min(capturedTo, maxPos);
    if (safeFrom < safeTo) {
      const tr = state.tr.setSelection(
        TextSelection.create(state.doc, safeFrom, safeTo)
      );
      dispatch(tr);
    }
  }

  // Insert the image node with captured alt text
  insertBlockImageNode(
    view as unknown as Parameters<typeof insertBlockImageNode>[0],
    imagePath,
    capturedAltText
  );
}

/**
 * Check if pasted text is an image path and show toast.
 * Returns true if we're handling it (showing toast), false otherwise.
 * Supports both single and multiple image paths.
 */
function tryTextImagePaste(view: EditorView, text: string): boolean {
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
      console.error("[imageHandler] Failed to validate path:", error);
      if (isViewConnected(view)) {
        pasteAsText(view, text, from, to);
      }
    });
    return true;
  }

  // Multiple images: new behavior (alt text only applies to single image)
  validateAndShowMultiToast(view, detection.results, text, from, to).catch((error) => {
    console.error("[imageHandler] Failed to validate multi-image paths:", error);
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
      // Home expansion failed - just paste as text
      if (isViewConnected(view)) {
        pasteAsText(view, originalText, capturedFrom, capturedTo);
      }
      return;
    }
    pathToCheck = expanded;
  }

  // For absolute paths, validate existence
  if (detection.type === "absolutePath" || detection.type === "homePath") {
    const exists = await validateLocalPath(pathToCheck);
    if (!exists) {
      // File doesn't exist - just paste as text
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
    onConfirm: () => {
      if (!isViewConnected(view)) {
        console.warn("[imageHandler] View disconnected, cannot insert image");
        return;
      }
      insertImageFromPath(view, detection, capturedFrom, capturedTo, capturedAltText).catch((error) => {
        console.error("Failed to insert image:", error);
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
    onConfirm: () => {
      if (!isViewConnected(view)) {
        console.warn("[imageHandler] View disconnected, cannot insert images");
        return;
      }
      insertMultipleImages(view, results, capturedFrom, capturedTo).catch((error) => {
        console.error("Failed to insert images:", error);
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
 * Insert multiple images as block nodes.
 */
async function insertMultipleImages(
  view: EditorView,
  results: ImagePathResult[],
  _capturedFrom: number,
  _capturedTo: number
): Promise<void> {
  // Verify view is still connected
  if (!isViewConnected(view)) {
    console.warn("[imageHandler] View disconnected, aborting multi-image insert");
    return;
  }

  const filePath = getActiveFilePathForCurrentWindow();
  const copyToAssets = useSettingsStore.getState().image.copyToAssets;

  // First, process all images and collect final paths
  const imagePaths: string[] = [];
  for (const detection of results) {
    let imagePath = detection.path;

    if (detection.needsCopy && copyToAssets) {
      // Copy to assets folder (default behavior)
      if (!filePath) {
        await showUnsavedDocWarning();
        return;
      }

      try {
        // For home paths, expand first
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
        console.error("Failed to copy image to assets:", error);
        await message("Failed to copy image to assets folder.", { kind: "error" });
        return;
      }
    } else if (detection.needsCopy && !copyToAssets) {
      // Use original path without copying
      if (detection.type === "homePath") {
        const expanded = await expandHomePath(detection.path);
        if (!expanded) {
          await message("Failed to resolve home directory path.", { kind: "error" });
          return;
        }
        imagePath = expanded;
      }
      // For absolute paths, use as-is
    }

    imagePaths.push(imagePath);
  }

  // Re-verify view is still connected after async operations
  if (!isViewConnected(view)) {
    console.warn("[imageHandler] View disconnected after async, aborting image insert");
    return;
  }

  if (imagePaths.length === 0) return;

  // Insert all images in a single transaction with correct position tracking
  const { state } = view;
  const blockImageType = state.schema.nodes.block_image;
  if (!blockImageType) {
    console.warn("[imageHandler] block_image node type not found");
    return;
  }

  // Find insertion point from current selection
  const { $from } = state.selection;
  let currentInsertPos = $from.end($from.depth) + 1;
  currentInsertPos = Math.min(currentInsertPos, state.doc.content.size);

  let tr = state.tr;
  for (const imagePath of imagePaths) {
    const imageNode = blockImageType.create({
      src: imagePath,
      alt: "",
      title: "",
    });

    tr = tr.insert(currentInsertPos, imageNode);
    // Move insert position forward by size of inserted node
    currentInsertPos += imageNode.nodeSize;
  }

  view.dispatch(tr);
}

/**
 * Paste text as plain text (default paste behavior).
 * Uses captured positions to handle async timing.
 */
function pasteAsText(view: EditorView, text: string, capturedFrom: number, capturedTo: number): void {
  if (!isViewConnected(view)) {
    return;
  }

  const { state, dispatch } = view;

  // Use current selection if it matches captured, otherwise use current
  const { from: currentFrom, to: currentTo } = state.selection;
  const from = currentFrom === capturedFrom && currentTo === capturedTo ? capturedFrom : currentFrom;
  const to = currentFrom === capturedFrom && currentTo === capturedTo ? capturedTo : currentTo;

  const tr = state.tr.insertText(text, from, to);
  dispatch(tr);
  view.focus();
}

/**
 * Generate unique filename for clipboard images.
 */
function generateClipboardImageFilename(originalName: string): string {
  const ext = originalName.includes(".") ? originalName.split(".").pop() : "png";
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  return `clipboard-${timestamp}-${random}.${ext}`;
}

async function processClipboardImage(view: EditorView, item: DataTransferItem): Promise<void> {
  const windowLabel = getWindowLabel();

  await withReentryGuard(windowLabel, CLIPBOARD_IMAGE_GUARD, async () => {
    const filePath = getActiveFilePathForCurrentWindow();

    if (!filePath) {
      await showUnsavedDocWarning();
      return;
    }

    const file = item.getAsFile();
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const imageData = new Uint8Array(buffer);
    // Generate unique filename to avoid collisions
    const filename = generateClipboardImageFilename(file.name || "image.png");

    const relativePath = await saveImageToAssets(imageData, filename, filePath);

    // Verify view is still connected
    if (!isViewConnected(view)) {
      console.warn("[imageHandler] View disconnected after saving image");
      return;
    }

    insertBlockImageNode(view as unknown as Parameters<typeof insertBlockImageNode>[0], relativePath);
  });
}

const DROP_IMAGE_GUARD = "drop-image";

/**
 * Check if a file is an image based on MIME type or extension.
 */
function isImageFile(file: File): boolean {
  // Check MIME type first
  if (file.type.startsWith("image/")) {
    return true;
  }
  // Fall back to extension check
  return hasImageExtension(file.name);
}

/**
 * Generate unique filename for dropped images.
 */
function generateDroppedImageFilename(originalName: string): string {
  const ext = originalName.includes(".") ? originalName.split(".").pop() : "png";
  const baseName = originalName.includes(".")
    ? originalName.slice(0, originalName.lastIndexOf("."))
    : originalName;
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  return `${baseName}-${timestamp}-${random}.${ext}`;
}

/**
 * Process dropped image files.
 */
async function processDroppedFiles(view: EditorView, files: File[], insertPos: number): Promise<void> {
  const windowLabel = getWindowLabel();

  await withReentryGuard(windowLabel, DROP_IMAGE_GUARD, async () => {
    const filePath = getActiveFilePathForCurrentWindow();

    if (!filePath) {
      await showUnsavedDocWarning();
      return;
    }

    // First, process all files and collect relative paths
    const imagePaths: string[] = [];
    for (const file of files) {
      if (!isImageFile(file)) continue;

      const buffer = await file.arrayBuffer();
      const imageData = new Uint8Array(buffer);
      const filename = generateDroppedImageFilename(file.name || "image.png");

      const relativePath = await saveImageToAssets(imageData, filename, filePath);
      imagePaths.push(relativePath);
    }

    // Verify view is still connected
    if (!isViewConnected(view)) {
      console.warn("[imageHandler] View disconnected after saving dropped images");
      return;
    }

    if (imagePaths.length === 0) return;

    // Insert all images in a single transaction with correct position tracking
    const { state } = view;
    const blockImageType = state.schema.nodes.block_image;
    if (!blockImageType) {
      console.warn("[imageHandler] block_image node type not found");
      return;
    }

    // Find insertion point from drop position
    const $pos = state.doc.resolve(Math.min(insertPos, state.doc.content.size));
    let currentInsertPos = $pos.end($pos.depth) + 1;
    currentInsertPos = Math.min(currentInsertPos, state.doc.content.size);

    let tr = state.tr;
    for (const relativePath of imagePaths) {
      const imageNode = blockImageType.create({
        src: relativePath,
        alt: "",
        title: "",
      });

      tr = tr.insert(currentInsertPos, imageNode);
      // Move insert position forward by size of inserted node
      currentInsertPos += imageNode.nodeSize;
    }

    view.dispatch(tr);
  });
}

/**
 * Handle drop events for images.
 */
function handleDrop(view: EditorView, event: DragEvent, _slice: unknown, moved: boolean): boolean {
  // If this is an internal move (dragging within editor), let ProseMirror handle it
  if (moved) return false;

  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return false;

  const copyToAssets = useSettingsStore.getState().image.copyToAssets;

  // Check for dropped files
  const files = Array.from(dataTransfer.files);
  const imageFiles = files.filter(isImageFile);

  if (imageFiles.length > 0) {
    // When copyToAssets is disabled, try to get file paths from URI list
    // (Finder provides file:// URLs when dragging files)
    if (!copyToAssets) {
      const uriList = dataTransfer.getData("text/uri-list");
      if (uriList) {
        const filePaths = uriList
          .split("\n")
          .filter((line) => line.startsWith("file://"))
          .map((uri) => decodeURIComponent(uri.replace("file://", "")));

        if (filePaths.length > 0) {
          const detection = detectMultipleImagePaths(filePaths);
          if (detection.allImages) {
            event.preventDefault();

            const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const insertPos = dropPos ? dropPos.pos : view.state.selection.from;

            const { state, dispatch } = view;
            const tr = state.tr.setSelection(Selection.near(state.doc.resolve(insertPos)));
            dispatch(tr);

            insertMultipleImages(view, detection.results, insertPos, insertPos).catch((error) => {
              console.error("Failed to insert dropped images:", error);
            });

            return true;
          }
        }
      }
    }

    // Default behavior: save files to assets folder
    event.preventDefault();

    // Get drop position in document
    const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY });
    const insertPos = dropPos ? dropPos.pos : view.state.selection.from;

    processDroppedFiles(view, imageFiles, insertPos).catch((error) => {
      console.error("Failed to process dropped images:", error);
      message("Failed to save dropped images.", { kind: "error" }).catch(console.error);
    });

    return true;
  }

  // Check for dropped text that might be image paths
  const text = dataTransfer.getData("text/plain");
  if (text) {
    const { paths } = parseMultiplePaths(text);
    if (paths.length > 0) {
      const detection = detectMultipleImagePaths(paths);
      if (detection.allImages) {
        event.preventDefault();

        // Get drop position
        const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY });
        const insertPos = dropPos ? dropPos.pos : view.state.selection.from;

        // Set selection to drop position
        const { state, dispatch } = view;
        const tr = state.tr.setSelection(Selection.near(state.doc.resolve(insertPos)));
        dispatch(tr);

        // Insert images
        insertMultipleImages(view, detection.results, insertPos, insertPos).catch((error) => {
          console.error("Failed to insert dropped images:", error);
        });

        return true;
      }
    }
  }

  return false;
}

function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  const items = event.clipboardData?.items;
  if (!items) return false;

  // First, check for binary image data (higher priority)
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      event.preventDefault();
      processClipboardImage(view, item).catch((error) => {
        console.error("Failed to process clipboard image:", error);
        message("Failed to save image from clipboard.", { kind: "error" }).catch(console.error);
      });
      return true;
    }
  }

  // Then, check for text that looks like an image path/URL
  const text = event.clipboardData?.getData("text/plain");
  if (text && tryTextImagePaste(view, text)) {
    event.preventDefault();
    return true;
  }

  return false;
}

export const imageHandlerExtension = Extension.create({
  name: "imageHandler",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: imageHandlerPluginKey,
        props: {
          handlePaste,
          handleDrop,
        },
      }),
    ];
  },
});
