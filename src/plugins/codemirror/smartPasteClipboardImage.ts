/**
 * Clipboard Image Paste for Source Mode
 *
 * Purpose: Handles pasting binary image data (e.g., screenshots) in Source mode.
 * Detects image items in the clipboard, saves them to the assets folder, and
 * inserts ![](relative-path) markdown at the cursor.
 *
 * @coordinates-with smartPaste.ts — called from the paste event handler
 * @coordinates-with hooks/useImageOperations.ts — copyImageToAssets for asset management
 * @module plugins/codemirror/smartPasteClipboardImage
 */

import type { EditorView } from "@codemirror/view";
import { message } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { saveImageToAssets } from "@/hooks/useImageOperations";
import { generateClipboardImageFilename } from "@/plugins/imageHandler/imageHandlerUtils";
import { encodeMarkdownUrl } from "@/utils/markdownUrl";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { smartPasteWarn } from "@/utils/debug";
import { isViewConnected } from "./smartPasteUtils";

/**
 * Check if the clipboard event contains binary image data and handle it.
 *
 * @returns true if handled (caller should preventDefault), false to pass through
 */
export function handleClipboardImagePaste(view: EditorView, event: Event): boolean {
  const clipboardEvent = event as ClipboardEvent;
  const items = clipboardEvent.clipboardData?.items;
  if (!items) return false;

  // Find image items in clipboard
  const imageFiles: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }

  if (imageFiles.length === 0) return false;

  // Capture cursor position synchronously before async I/O
  const { from, to } = view.state.selection.main;

  // Handle async save/insert
  void saveAndInsertImages(view, imageFiles, from, to);
  return true;
}

async function saveAndInsertImages(view: EditorView, files: File[], capturedFrom: number, capturedTo: number): Promise<void> {
  const windowLabel = getWindowLabel();
  const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  const doc = tabId ? useDocumentStore.getState().getDocument(tabId) : undefined;
  const filePath = doc?.filePath;

  if (!filePath) {
    await message(
      i18n.t("dialog:unsavedDocument.messageInsertImagesLocal"),
      { title: i18n.t("dialog:unsavedDocument.title"), kind: "warning" },
    );
    return;
  }

  const insertParts: string[] = [];

  for (const file of files) {
    try {
      const buffer = await file.arrayBuffer();
      const imageData = new Uint8Array(buffer);
      const filename = generateClipboardImageFilename(file.name || "image.png");
      const relativePath = await saveImageToAssets(imageData, filename, filePath);
      insertParts.push(`![](${encodeMarkdownUrl(relativePath)})`);
    } catch (error) {
      smartPasteWarn("Failed to save clipboard image:", error instanceof Error ? error.message : String(error));
    }
  }

  if (insertParts.length === 0) return;

  if (!isViewConnected(view)) {
    smartPasteWarn("View disconnected after async save, aborting clipboard image insert");
    return;
  }

  const markdown = insertParts.join("\n") + "\n";

  const { from: currentFrom, to: currentTo } = view.state.selection.main;
  const docLength = view.state.doc.length;
  const selectionChanged = currentFrom !== capturedFrom || currentTo !== capturedTo;
  const insertFrom = selectionChanged ? Math.min(currentFrom, docLength) : Math.min(capturedFrom, docLength);
  const insertTo = selectionChanged ? Math.min(currentTo, docLength) : Math.min(capturedTo, docLength);

  if (selectionChanged) {
    smartPasteWarn("Selection changed during async, using current position");
  }

  view.dispatch({
    changes: { from: insertFrom, to: insertTo, insert: markdown },
    selection: { anchor: insertFrom + markdown.length },
  });
  view.focus();
}
