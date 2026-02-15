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

/**
 * Regex patterns for YouTube URL formats.
 * Each captures the video ID in group 1.
 */
const YOUTUBE_PATTERNS = [
  // youtube.com/watch?v=ID or youtube.com/watch?...&v=ID
  /(?:youtube\.com|youtube-nocookie\.com)\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})/,
  // youtu.be/ID
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  // youtube.com/embed/ID or youtube-nocookie.com/embed/ID
  /(?:youtube\.com|youtube-nocookie\.com)\/embed\/([a-zA-Z0-9_-]{11})/,
  // youtube.com/v/ID
  /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
];

/**
 * Parse a YouTube URL and extract the video ID.
 * Returns the 11-character video ID or null if not a valid YouTube URL.
 */
export function parseYoutubeUrl(url: string): string | null {
  if (!url) return null;

  for (const pattern of YOUTUBE_PATTERNS) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

/**
 * Check if a URL is a YouTube URL (any format).
 */
export function isYoutubeUrl(url: string): boolean {
  return parseYoutubeUrl(url) !== null;
}
