/**
 * Media Handler Tiptap Extension
 *
 * Purpose: Handles media file (video/audio) drop and paste events in WYSIWYG mode.
 * Copies dropped/pasted media files to the .assets/ folder and inserts appropriate nodes.
 *
 * Key decisions:
 *   - Runs AFTER imageHandler (lower priority) so images are handled by existing code
 *   - Detects media files by MIME type and file extension
 *   - Handles both drop events (media files) and paste events (media file paths/URLs)
 *
 * @coordinates-with hooks/useMediaOperations.ts — media file copy and node insertion
 * @coordinates-with utils/mediaPathDetection.ts — media file type detection
 * @module plugins/mediaHandler/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { message } from "@tauri-apps/plugin-dialog";
import { copyMediaToAssets, saveMediaToAssets, insertBlockVideoNode, insertBlockAudioNode } from "@/hooks/useMediaOperations";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { hasVideoExtension, hasAudioExtension } from "@/utils/mediaPathDetection";

const mediaHandlerPluginKey = new PluginKey("mediaHandler");

/** Maximum drop file size (500 MB). Rejects files too large to safely load into memory. */
const MAX_DROP_FILE_SIZE = 500 * 1024 * 1024;

const VIDEO_MIME_PREFIXES = ["video/"];
const AUDIO_MIME_PREFIXES = ["audio/"];

function isMediaFile(file: File): boolean {
  const mime = file.type.toLowerCase();
  if (VIDEO_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  if (AUDIO_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  // Fallback to extension check
  return hasVideoExtension(file.name) || hasAudioExtension(file.name);
}

function getDocumentPath(): string | null {
  try {
    const windowLabel = getWindowLabel();
    const tabId = useTabStore.getState().activeTabId[windowLabel];
    if (!tabId) return null;
    const doc = useDocumentStore.getState().getDocument(tabId);
    return doc?.filePath ?? null;
  } catch {
    return null;
  }
}

function getMediaType(file: File): "video" | "audio" {
  const mime = file.type.toLowerCase();
  if (VIDEO_MIME_PREFIXES.some((p) => mime.startsWith(p))) return "video";
  if (hasVideoExtension(file.name)) return "video";
  return "audio";
}

async function handleDroppedMediaFile(view: EditorView, file: File): Promise<void> {
  const documentPath = getDocumentPath();
  if (!documentPath) {
    await message("Please save the document before adding media files.", {
      title: "Save Required",
      kind: "info",
    });
    return;
  }

  try {
    if (file.size > MAX_DROP_FILE_SIZE) {
      await message(
        `File is too large (${(file.size / (1024 * 1024)).toFixed(0)} MB). Maximum is ${MAX_DROP_FILE_SIZE / (1024 * 1024)} MB.`,
        { title: "File Too Large", kind: "warning" }
      );
      return;
    }

    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    const relativePath = await saveMediaToAssets(data, file.name, documentPath);
    const mediaType = getMediaType(file);

    if (mediaType === "video") {
      insertBlockVideoNode(view, relativePath);
    } else {
      insertBlockAudioNode(view, relativePath);
    }
  } catch (error) {
    console.error("Failed to handle dropped media file:", error);
    await message(
      `Failed to save media file: ${error instanceof Error ? error.message : String(error)}`,
      { title: "Error", kind: "error" }
    );
  }
}

function handleDrop(view: EditorView, event: DragEvent): boolean {
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return false;

  const mediaFiles = Array.from(files).filter(isMediaFile);
  if (mediaFiles.length === 0) return false;

  event.preventDefault();

  // Handle each media file
  for (const file of mediaFiles) {
    handleDroppedMediaFile(view, file);
  }

  return true;
}

function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  // Check for text that looks like a media file path
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return false;

  const trimmed = text.trim();
  if (!trimmed) return false;

  // Only handle single-line paths that look like media files
  if (trimmed.includes("\n")) return false;

  const isVideo = hasVideoExtension(trimmed);
  const isAudio = hasAudioExtension(trimmed);
  if (!isVideo && !isAudio) return false;

  const documentPath = getDocumentPath();
  if (!documentPath) return false;

  event.preventDefault();

  // If it's a local path, try to copy to assets
  if (trimmed.startsWith("/") || trimmed.startsWith("./") || /^[A-Za-z]:/.test(trimmed)) {
    copyMediaToAssets(trimmed, documentPath)
      .then((relativePath) => {
        if (isVideo) {
          insertBlockVideoNode(view, relativePath);
        } else {
          insertBlockAudioNode(view, relativePath);
        }
      })
      .catch((error) => {
        console.error("Failed to copy media from pasted path:", error);
        // Fallback: insert with original path
        if (isVideo) {
          insertBlockVideoNode(view, trimmed);
        } else {
          insertBlockAudioNode(view, trimmed);
        }
      });
  } else {
    // External URL — insert directly
    if (isVideo) {
      insertBlockVideoNode(view, trimmed);
    } else {
      insertBlockAudioNode(view, trimmed);
    }
  }

  return true;
}

export const mediaHandlerExtension = Extension.create({
  name: "mediaHandler",
  // Lower priority than imageHandler (100 is default, lower number = higher priority)
  priority: 90,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: mediaHandlerPluginKey,
        props: {
          handleDrop(view, event) {
            return handleDrop(view, event as DragEvent);
          },
          handlePaste(view, event) {
            return handlePaste(view, event as ClipboardEvent);
          },
        },
      }),
    ];
  },
});
