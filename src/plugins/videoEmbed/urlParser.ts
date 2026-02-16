/**
 * Video URL Parser — re-exports from shared utilities
 *
 * Purpose: Re-exports video URL parsing functions from shared utilities.
 * YouTube-specific parsing from youtubeUrlParser.ts and multi-provider
 * parsing from videoProviderRegistry.ts.
 *
 * @coordinates-with utils/youtubeUrlParser.ts — YouTube-specific parsing
 * @coordinates-with utils/videoProviderRegistry.ts — multi-provider parsing
 * @module plugins/videoEmbed/urlParser
 */

export { parseYoutubeUrl, isYoutubeUrl } from "@/utils/youtubeUrlParser";
export { parseVideoUrl } from "@/utils/videoProviderRegistry";
