/**
 * Image Handler Tiptap Extension
 *
 * Purpose: Handles all image-related paste, drop, and file events in WYSIWYG mode —
 * clipboard images, file drops, file:// URLs, and multi-image paste from Finder.
 *
 * Pipeline: paste/drop event -> detect image content -> delegate to utils/insert/toast modules
 *
 * Key decisions:
 *   - Highest priority in the paste chain (runs before smartPaste, markdownPaste, etc.)
 *   - Images are always copied to the `.assets/` folder next to the document for portability
 *   - Multiple images (e.g., multi-select from Finder) are handled via parseMultiplePaths
 *   - Uses reentryGuard to prevent double-processing of clipboard events
 *   - Supports both inline images (in paragraph context) and block images (at block boundary)
 *   - Utility functions (isImageFile, filename generation, path conversion) live in imageHandlerUtils.ts
 *
 * @coordinates-with hooks/useImageOperations.ts — copyImageToAssets, saveImageToAssets
 * @coordinates-with utils/imagePathDetection.ts — image format and path detection
 * @coordinates-with stores/imagePasteToastStore.ts — toast UI for paste confirmation
 * @coordinates-with plugins/imageHandler/imageHandlerUtils.ts — shared utilities
 * @coordinates-with plugins/imageHandler/imageHandlerInsert.ts — image insertion
 * @coordinates-with plugins/imageHandler/imageHandlerToast.ts — toast UI
 * @module plugins/imageHandler/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { message } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { saveImageToAssets, insertBlockImageNode } from "@/hooks/useImageOperations";
import { getWindowLabel } from "@/services/navigation/windowFocus";
import { useSettingsStore } from "@/stores/settingsStore";
import { detectMultipleImagePaths } from "@/utils/imagePathDetection";
import { parseMultiplePaths } from "@/utils/multiImageParsing";
import { withReentryGuard } from "@/utils/reentryGuard";
import { imageHandlerWarn, imageHandlerError } from "@/utils/debug";
import { insertMultipleImages } from "./imageHandlerInsert";
import { tryTextImagePaste } from "./imageHandlerToast";
import {
  fileUrlToPath,
  isViewConnected,
  isImageFile,
  generateClipboardImageFilename,
  generateDroppedImageFilename,
  getActiveFilePathForCurrentWindow,
  showUnsavedDocWarning,
} from "./imageHandlerUtils";

const imageHandlerPluginKey = new PluginKey("imageHandler");
const CLIPBOARD_IMAGE_GUARD = "clipboard-image";

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
      imageHandlerWarn("View disconnected after saving image");
      return;
    }

    insertBlockImageNode(view, relativePath);
  });
}

const DROP_IMAGE_GUARD = "drop-image";

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
      imageHandlerWarn("View disconnected after saving dropped images");
      return;
    }

    if (imagePaths.length === 0) return;

    // Insert all images in a single transaction with correct position tracking
    const { state } = view;
    const blockImageType = state.schema.nodes.block_image;
    if (!blockImageType) {
      imageHandlerWarn("block_image node type not found");
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
          .map(fileUrlToPath);

        if (filePaths.length > 0) {
          const detection = detectMultipleImagePaths(filePaths);
          if (detection.allImages) {
            event.preventDefault();

            const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const insertPos = dropPos ? dropPos.pos : view.state.selection.from;

            const { state, dispatch } = view;
            // Selection for drop position — don't create separate undo step
            const tr = state.tr
              .setSelection(Selection.near(state.doc.resolve(insertPos)))
              .setMeta("addToHistory", false);
            dispatch(tr);

            insertMultipleImages(view, detection.results, insertPos, insertPos).catch((error) => {
              imageHandlerError("Failed to insert dropped images:", error);
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
      imageHandlerError("Failed to process dropped images:", error);
      message(i18n.t("dialog:toast.failedToSaveDroppedImages"), { kind: "error" }).catch(imageHandlerError);
    });

    return true;
  }

  // Check for dropped text that might be image paths
  const text = dataTransfer.getData("text/plain");
  if (text) {
    const { paths } = parseMultiplePaths(text);
    /* v8 ignore next -- @preserve empty paths list is an unlikely edge case when text is non-empty */
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
          imageHandlerError("Failed to insert dropped images:", error);
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
        imageHandlerError("Failed to process clipboard image:", error);
        message(i18n.t("dialog:toast.failedToSaveClipboardImage"), { kind: "error" }).catch(imageHandlerError);
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

/** Tiptap extension that handles image paste, drop, and file dialog insertion. */
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
