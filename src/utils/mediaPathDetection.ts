/**
 * Media Path Detection Utility
 *
 * Purpose: Detects media type (video, audio, image) from file paths and URLs
 * based on file extension. Used by the markdown pipeline to auto-promote
 * image-syntax references (`![](file.mp4)`) to the appropriate block node.
 *
 * @coordinates-with mdastBlockConverters.ts — paragraph promotion logic
 * @coordinates-with mediaHandler/tiptap.ts — drop/paste file type detection
 * @module utils/mediaPathDetection
 */

// Dotted media-extension lists — single source of truth (WI-0.6, D3).
// Re-exported (VIDEO/AUDIO) to preserve this module's public surface.
import {
  IMAGE_EXTENSIONS_DOTTED as IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS_DOTTED as VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS_DOTTED as AUDIO_EXTENSIONS,
} from "./mediaExtensions";

export { VIDEO_EXTENSIONS, AUDIO_EXTENSIONS };

/**
 * Extract the file extension from a path or URL, ignoring query params.
 * Returns lowercase extension including the dot, or empty string.
 */
function extractExtension(path: string): string {
  if (!path) return "";
  // Strip query params, hash, and trailing slashes
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "");
  const lastDot = clean.lastIndexOf(".");
  if (lastDot <= 0) return ""; // -1 = no dot, 0 = hidden file like ".gitignore"
  // Guard against paths ending with just a dot (e.g., "file.")
  const ext = clean.slice(lastDot).toLowerCase();
  return ext.length > 1 ? ext : "";
}

/**
 * Check if a path/URL points to a video file based on its extension.
 */
export function hasVideoExtension(path: string): boolean {
  const ext = extractExtension(path);
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Check if a path/URL points to an audio file based on its extension.
 */
export function hasAudioExtension(path: string): boolean {
  const ext = extractExtension(path);
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Detect the media type of a file path or URL.
 * Returns "video", "audio", "image", or null if unrecognized.
 */
export function getMediaType(path: string): "video" | "audio" | "image" | null {
  const ext = extractExtension(path);
  if (!ext) return null;
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return "video";
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return "audio";
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return "image";
  return null;
}
