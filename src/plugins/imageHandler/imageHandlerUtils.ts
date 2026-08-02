/**
 * Image Handler Utilities
 *
 * Purpose: Shared utility functions for image handler operations —
 * path conversion, validation, view checking, toast positioning,
 * image file detection, and filename generation.
 *
 * @coordinates-with plugins/imageHandler/tiptap.ts — extension entry point
 * @coordinates-with plugins/imageHandler/imageHandlerInsert.ts — image insertion
 * @coordinates-with plugins/imageHandler/imageHandlerToast.ts — toast UI
 * @module plugins/imageHandler/imageHandlerUtils
 */

import type { EditorView } from "@tiptap/pm/view";
import { message } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { getWindowLabel } from "@/services/navigation/windowFocus";
import { hostDocument } from "@/plugins/shared/hostDocument";
import { hasImageExtension } from "@/utils/imagePathDetection";
import { imageHandlerWarn } from "@/utils/debug";

/**
 * Convert a file:// URL to a filesystem path.
 * Handles both Unix and Windows file URL formats:
 * - Unix: file:///Users/name/file.png -> /Users/name/file.png
 * - Windows: file:///C:/Users/name/file.png -> C:/Users/name/file.png
 */
export function fileUrlToPath(url: string): string {
  // Remove file:// prefix
  let path = url.replace(/^file:\/\//, "");
  // URL decode (guard against malformed percent-encoding)
  try {
    path = decodeURIComponent(path);
  } catch {
    // Fall through with undecoded path
  }
  // On Windows, file URLs have format file:///C:/path, resulting in /C:/path
  // Remove the leading slash if followed by a drive letter
  if (/^\/[A-Za-z]:/.test(path)) {
    path = path.slice(1);
  }
  return path;
}

/**
 * Show warning that document must be saved first.
 */
export async function showUnsavedDocWarning(): Promise<void> {
  await message(
    i18n.t("dialog:unsavedDocument.messageInsertImages"),
    { title: i18n.t("dialog:unsavedDocument.title"), kind: "warning" }
  );
}

/**
 * Check if editor view is still valid and connected.
 */
export function isViewConnected(view: EditorView): boolean {
  try {
    return view.dom?.isConnected ?? false;
  } catch {
    return false;
  }
}

/** Returns the file path of the active document in the current window, or null. */
export function getActiveFilePathForCurrentWindow(): string | null {
  try {
    return hostDocument.activeFilePath(getWindowLabel());
  } catch (error) {
    imageHandlerWarn("Failed to get active file path:", error);
    return null;
  }
}

/**
 * Validate a local image path exists (async file check).
 */
export async function validateLocalPath(path: string): Promise<boolean> {
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
export async function expandHomePath(path: string): Promise<string | null> {
  if (!path.startsWith("~/")) return path;

  try {
    const { homeDir, join } = await import("@tauri-apps/api/path");
    const home = await homeDir();
    return await join(home, path.slice(2));
  } catch {
    return null;
  }
}

/**
 * Get anchor rect for toast positioning based on current selection.
 */
export function getToastAnchorRect(view: EditorView): { top: number; left: number; bottom: number; right: number } {
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
 * Check if a file is an image based on MIME type or extension.
 */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) {
    return true;
  }
  return hasImageExtension(file.name);
}

/**
 * Generate unique filename for clipboard images.
 */
export function generateClipboardImageFilename(originalName: string): string {
  const ext = originalName.includes(".") ? originalName.split(".").pop() : "png";
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  return `clipboard-${timestamp}-${random}.${ext}`;
}

/**
 * Generate unique filename for dropped images.
 */
export function generateDroppedImageFilename(originalName: string): string {
  const ext = originalName.includes(".") ? originalName.split(".").pop() : "png";
  const baseName = originalName.includes(".")
    ? originalName.slice(0, originalName.lastIndexOf("."))
    : originalName;
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  return `${baseName}-${timestamp}-${random}.${ext}`;
}
