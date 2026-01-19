import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { message } from "@tauri-apps/plugin-dialog";
import { copyImageToAssets, saveImageToAssets, insertBlockImageNode } from "@/hooks/useImageOperations";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { useDocumentStore } from "@/stores/documentStore";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { useTabStore } from "@/stores/tabStore";
import { detectImagePath, type ImagePathResult } from "@/utils/imagePathDetection";
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
 */
async function insertImageFromPath(
  view: EditorView,
  detection: ImagePathResult,
  capturedFrom: number,
  capturedTo: number
): Promise<void> {
  // Verify view is still connected
  if (!isViewConnected(view)) {
    console.warn("[imageHandler] View disconnected, aborting image insert");
    return;
  }

  const filePath = getActiveFilePathForCurrentWindow();

  let imagePath = detection.path;

  if (detection.needsCopy) {
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
  }

  // Re-verify view is still connected after async operations
  if (!isViewConnected(view)) {
    console.warn("[imageHandler] View disconnected after async, aborting image insert");
    return;
  }

  // Use captured positions if selection hasn't changed significantly
  const { from: currentFrom, to: currentTo } = view.state.selection;
  const selectionChanged = currentFrom !== capturedFrom || currentTo !== capturedTo;

  if (selectionChanged) {
    // Selection changed - insert at current position instead
    console.warn("[imageHandler] Selection changed during async, using current position");
  }

  // Insert the image node
  insertBlockImageNode(view as unknown as Parameters<typeof insertBlockImageNode>[0], imagePath);
}

/**
 * Check if pasted text is an image path and show toast.
 * Returns true if we're handling it (showing toast), false otherwise.
 */
function tryTextImagePaste(view: EditorView, text: string): boolean {
  // Only consider single-line text
  if (!text || text.includes("\n")) return false;

  const detection = detectImagePath(text.trim());
  if (!detection.isImage) return false;

  // Capture selection state at paste time
  const { from, to } = view.state.selection;

  // For local paths, we need to validate async - show toast immediately for URLs
  if (detection.type === "url" || detection.type === "dataUrl") {
    showImagePasteToast(view, detection, text, from, to);
    return true;
  }

  // For local paths, validate first then show toast
  validateAndShowToast(view, detection, text, from, to).catch((error) => {
    console.error("[imageHandler] Failed to validate path:", error);
    // On error, paste as text as fallback
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
  capturedTo: number
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
  showImagePasteToast(view, detection, originalText, capturedFrom, capturedTo);
}

/**
 * Show the image paste confirmation toast.
 */
function showImagePasteToast(
  view: EditorView,
  detection: ImagePathResult,
  originalText: string,
  capturedFrom: number,
  capturedTo: number
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
      insertImageFromPath(view, detection, capturedFrom, capturedTo).catch((error) => {
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
        },
      }),
    ];
  },
});
