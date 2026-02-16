/**
 * YouTube URL Parser
 *
 * Purpose: Extracts video IDs from various YouTube URL formats.
 * Supports watch, short (youtu.be), embed, and v/ URLs.
 *
 * @coordinates-with plugins/youtubeEmbed/tiptap.ts — uses parseYoutubeUrl for node creation
 * @coordinates-with utils/markdownPipeline/mdastBlockConverters.ts — uses parseYoutubeUrl for iframe promotion
 * @module utils/youtubeUrlParser
 */

/** Validates an 11-character YouTube video ID (alphanumeric, hyphen, underscore). */
export const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/** Allowed YouTube hostnames (exact match after stripping www.). */
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);

/**
 * Parse a YouTube URL and extract the video ID.
 * Returns the 11-character video ID or null if not a valid YouTube URL.
 *
 * Uses URL parsing for hostname validation to prevent matching
 * look-alike domains (e.g. notyoutube.com).
 */
export function parseYoutubeUrl(url: string): string | null {
  if (!url) return null;

  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  // Validate scheme
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  // Validate hostname (strip leading www.)
  const host = parsed.hostname.replace(/^www\./, "");
  if (!YOUTUBE_HOSTS.has(host)) return null;

  // youtu.be/VIDEO_ID
  if (host === "youtu.be") {
    const id = parsed.pathname.split("/")[1];
    return id && YOUTUBE_VIDEO_ID_RE.test(id) ? id : null;
  }

  // youtube.com/watch?v=VIDEO_ID
  if (parsed.pathname === "/watch") {
    const id = parsed.searchParams.get("v");
    return id && YOUTUBE_VIDEO_ID_RE.test(id) ? id : null;
  }

  // youtube.com/embed/VIDEO_ID or youtube.com/v/VIDEO_ID
  const pathMatch = parsed.pathname.match(/^\/(?:embed|v)\/([a-zA-Z0-9_-]{11})(?:\/|$)/);
  if (pathMatch?.[1]) return pathMatch[1];

  return null;
}

/**
 * Check if a URL is a YouTube URL (any format).
 */
export function isYoutubeUrl(url: string): boolean {
  return parseYoutubeUrl(url) !== null;
}
