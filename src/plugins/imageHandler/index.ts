/**
 * Image Handler Plugin
 *
 * ProseMirror plugin for handling image paste.
 * Saves images to ./assets/images/ relative to the document.
 *
 * Note: Drag-drop is handled separately via useImageDrop hook
 * because Tauri intercepts OS file drops.
 */

import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { message } from "@tauri-apps/plugin-dialog";
import { useDocumentStore } from "@/stores/documentStore";
import { getWindowLabel } from "@/utils/windowFocus";
import { saveImageToAssets, insertBlockImageNode } from "@/utils/imageUtils";

export const imageHandlerPluginKey = new PluginKey("imageHandler");

// Re-entry guard for clipboard image processing (prevents duplicate dialogs)
let isProcessingClipboardImage = false;

/**
 * Process clipboard image item.
 */
async function processClipboardImage(
  view: EditorView,
  item: DataTransferItem
): Promise<void> {
  // Guard against rapid pastes causing duplicate dialogs
  if (isProcessingClipboardImage) return;
  isProcessingClipboardImage = true;

  try {
    const windowLabel = getWindowLabel();
    const doc = useDocumentStore.getState().getDocument(windowLabel);
    const filePath = doc?.filePath;

    if (!filePath) {
      await message(
        "Please save the document first before pasting images. " +
          "Images are stored relative to the document location.",
        { title: "Unsaved Document", kind: "warning" }
      );
      return;
    }

    const file = item.getAsFile();
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const imageData = new Uint8Array(buffer);
    const filename = file.name || "clipboard-image.png";

    // Save image and get relative path (portable)
    const relativePath = await saveImageToAssets(imageData, filename, filePath);

    // Insert block image node (default behavior for pasted images)
    insertBlockImageNode(view, relativePath);
  } catch (error) {
    console.error("Failed to process clipboard image:", error);
    await message("Failed to save image from clipboard.", { kind: "error" });
  } finally {
    isProcessingClipboardImage = false;
  }
}

/**
 * Handle paste event - check for images in clipboard.
 */
function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  const items = event.clipboardData?.items;
  if (!items) return false;

  for (const item of items) {
    if (item.type.startsWith("image/")) {
      event.preventDefault();
      processClipboardImage(view, item);
      return true;
    }
  }

  return false;
}

/**
 * Milkdown plugin for image paste handling.
 */
export const imageHandlerPlugin = $prose(() => {
  return new Plugin({
    key: imageHandlerPluginKey,
    props: {
      handlePaste,
    },
  });
});

export default imageHandlerPlugin;

// Re-export input rule
export { imageInputRule } from "./input-rule";
