/**
 * YouTube URL Parser — re-exports from shared utility
 *
 * The actual implementation lives in utils/youtubeUrlParser.ts so it can be
 * used by both plugins and the markdown pipeline without violating dependency rules.
 *
 * @module plugins/youtubeEmbed/urlParser
 */

export { parseYoutubeUrl, isYoutubeUrl } from "@/utils/youtubeUrlParser";
