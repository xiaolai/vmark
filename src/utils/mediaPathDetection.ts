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

export const VIDEO_EXTENSIONS = [
  ".mp4",
  ".webm",
  ".mov",
  ".avi",
  ".mkv",
  ".m4v",
  ".ogv",
] as const;

export const AUDIO_EXTENSIONS = [
  ".mp3",
  ".m4a",
  ".ogg",
  ".wav",
  ".flac",
  ".aac",
  ".opus",
] as const;

const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
  ".avif",
] as const;

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
