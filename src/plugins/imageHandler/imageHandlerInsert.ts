/**
 * Image Handler Insert Operations
 *
 * Purpose: Functions for inserting images into the editor —
 * single image insertion, multiple image insertion, and plain text fallback.
 *
 * @coordinates-with plugins/imageHandler/tiptap.ts — extension entry point
 * @coordinates-with plugins/imageHandler/imageHandlerUtils.ts — shared utilities
 * @coordinates-with plugins/imageHandler/imageHandlerToast.ts — toast UI
 * @coordinates-with hooks/useImageOperations.ts — copyImageToAssets, insertBlockImageNode
 * @module plugins/imageHandler/imageHandlerInsert
 */

import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { message } from "@tauri-apps/plugin-dialog";
import { imeToast as toast } from "@/utils/imeToast";
import i18n from "@/i18n";
import { copyImageToAssets, insertBlockImageNode } from "@/hooks/useImageOperations";
import { useSettingsStore } from "@/stores/settingsStore";
import type { ImagePathResult } from "@/utils/imagePathDetection";
import { imageHandlerWarn, imageHandlerError } from "@/utils/debug";
import {
  isViewConnected,
  getActiveFilePathForCurrentWindow,
  showUnsavedDocWarning,
  expandHomePath,
} from "./imageHandlerUtils";

/**
 * Resolve a single image detection to its final path.
 * Handles home path expansion and optional copy-to-assets.
 * Returns null if resolution fails (caller should abort).
 */
async function resolveImagePath(
  detection: ImagePathResult,
  filePath: string | null,
  copyToAssets: boolean
): Promise<string | null> {
  if (detection.needsCopy && copyToAssets) {
    if (!filePath) {
      await showUnsavedDocWarning();
      return null;
    }
    try {
      let sourcePath = detection.path;
      if (detection.type === "homePath") {
        const expanded = await expandHomePath(detection.path);
        if (!expanded) {
          await message(i18n.t("dialog:toast.failedToResolveHomePath"), { kind: "error" });
          return null;
        }
        sourcePath = expanded;
      }
      return await copyImageToAssets(sourcePath, filePath);
    } catch (error) {
      imageHandlerError("Failed to copy image to assets:", error);
      await message(i18n.t("dialog:toast.failedToCopyToAssets"), { kind: "error" });
      return null;
    }
  }

  if (detection.needsCopy && !copyToAssets) {
    if (detection.type === "homePath") {
      const expanded = await expandHomePath(detection.path);
      if (!expanded) {
        await message(i18n.t("dialog:toast.failedToResolveHomePath"), { kind: "error" });
        return null;
      }
      return expanded;
    }
  }

  return detection.path;
}

/**
 * Insert image from text path (after user confirmation).
 * Takes captured selection to handle async timing.
 * Uses captured selection text as alt text if available.
 */
export async function insertImageFromPath(
  view: EditorView,
  detection: ImagePathResult,
  capturedFrom: number,
  capturedTo: number,
  capturedAltText: string
): Promise<void> {
  // Verify view is still connected
  if (!isViewConnected(view)) {
    imageHandlerWarn("View disconnected, aborting image insert");
    return;
  }

  const filePath = getActiveFilePathForCurrentWindow();
  const copyToAssets = useSettingsStore.getState().image.copyToAssets;

  const imagePath = await resolveImagePath(detection, filePath, copyToAssets);
  if (imagePath === null) return;

  // Re-verify view is still connected after async operations
  if (!isViewConnected(view)) {
    imageHandlerWarn("View disconnected after async, aborting image insert");
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
  insertBlockImageNode(view, imagePath, capturedAltText);
}

/**
 * Insert multiple images as block nodes.
 */
export async function insertMultipleImages(
  view: EditorView,
  results: ImagePathResult[],
  _capturedFrom: number,
  _capturedTo: number
): Promise<void> {
  // Verify view is still connected
  if (!isViewConnected(view)) {
    imageHandlerWarn("View disconnected, aborting multi-image insert");
    return;
  }

  const filePath = getActiveFilePathForCurrentWindow();
  const copyToAssets = useSettingsStore.getState().image.copyToAssets;

  // Process all images and collect final paths
  const imagePaths: string[] = [];
  for (const detection of results) {
    const resolved = await resolveImagePath(detection, filePath, copyToAssets);
    if (resolved === null) return;
    imagePaths.push(resolved);
  }

  // Re-verify view is still connected after async operations
  if (!isViewConnected(view)) {
    imageHandlerWarn("View disconnected after async, aborting image insert");
    return;
  }

  if (imagePaths.length === 0) return;

  // Insert all images in a single transaction with correct position tracking
  const { state } = view;
  const blockImageType = state.schema.nodes.block_image;
  if (!blockImageType) {
    imageHandlerWarn("block_image node type not found");
    toast.error(i18n.t("dialog:toast.imageSchemaUnavailable"));
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
export function pasteAsText(view: EditorView, text: string, capturedFrom: number, capturedTo: number): void {
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
