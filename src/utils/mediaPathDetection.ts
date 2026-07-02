/**
 * Media Path Detection Utility
 *
 * Purpose: Detects media type (video, audio, image) from file paths and URLs
 * based on file extension. Used by the markdown pipeline to auto-promote
 * image-syntax references (`![](file.mp4)`) to the appropriate block node.
 *
 * @coordinates-with markdownPipeline/mdastMediaConverters.ts — paragraph promotion logic
 * @coordinates-with mediaHandler/tiptap.ts — drop/paste file type detection
 * @module utils/mediaPathDetection
 */

// Dotted media-extension lists — single source of truth (WI-0.6, D3).
// Re-exported (VIDEO/AUDIO) to preserve this module's public surface.
import {
  IMAGE_EXTENSIONS_DOTTED as IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS_DOTTED as VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS_DOTTED as AUDIO_EXTENSIONS,
  fileExtension,
} from "./mediaExtensions";

export { VIDEO_EXTENSIONS, AUDIO_EXTENSIONS };

export type MediaType = "video" | "audio" | "image";

/**
 * Extract the file extension from a path or URL, ignoring query params.
 * Returns lowercase extension including the dot, or empty string.
 * Delegates to the canonical mediaExtensions.fileExtension parser so
 * basename handling (hidden files like "/dir/.mp4") stays consistent.
 */
function extractExtension(path: string): string {
  const ext = fileExtension(path);
  return ext ? `.${ext}` : "";
}

/** Ordered detection table — first matching extension list wins. */
const MEDIA_TYPE_TABLE: ReadonlyArray<readonly [MediaType, readonly string[]]> = [
  ["video", VIDEO_EXTENSIONS],
  ["audio", AUDIO_EXTENSIONS],
  ["image", IMAGE_EXTENSIONS],
];

/** Check if a path/URL's extension is in the given dotted-extension list. */
function hasMediaExtension(path: string, extensions: readonly string[]): boolean {
  return extensions.includes(extractExtension(path));
}

/**
 * Check if a path/URL points to a video file based on its extension.
 */
export function hasVideoExtension(path: string): boolean {
  return hasMediaExtension(path, VIDEO_EXTENSIONS);
}

/**
 * Check if a path/URL points to an audio file based on its extension.
 */
export function hasAudioExtension(path: string): boolean {
  return hasMediaExtension(path, AUDIO_EXTENSIONS);
}

/**
 * Detect the media type of a file path or URL.
 * Returns "video", "audio", "image", or null if unrecognized.
 */
export function getMediaType(path: string): MediaType | null {
  const ext = extractExtension(path);
  if (!ext) return null;
  for (const [type, extensions] of MEDIA_TYPE_TABLE) {
    if (extensions.includes(ext)) return type;
  }
  return null;
}
