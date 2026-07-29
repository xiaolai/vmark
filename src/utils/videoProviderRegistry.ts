/**
 * Video Provider Registry
 *
 * Purpose: Centralized registry of video embed providers (YouTube, Vimeo, Bilibili).
 * Each provider defines URL parsing, embed URL generation, and default sizing.
 *
 * Key decisions:
 *   - YouTube parser delegates to youtubeUrlParser.ts, Vimeo to
 *     vimeoUrlParser.ts (shared, hostname-anchored)
 *   - Iframe detection reuses the SAME hostname-anchored parsers — substring
 *     regexes let lookalike domains and query-string echoes masquerade as
 *     providers
 *   - The registry object is the single source of truth: the provider list is
 *     derived from its keys, configs are frozen, and provider-specific embed
 *     metadata (the Vimeo privacy hash) flows through each config's
 *     `parseUrlFull` — no per-provider special cases at the call sites
 *   - Embed URLs are built only from IDs the provider's `isValidId` accepts
 *     (imported/programmatic node attrs are untrusted input)
 *
 * @coordinates-with youtubeUrlParser.ts — YouTube URL parsing
 * @coordinates-with vimeoUrlParser.ts — Vimeo URL parsing + privacy hashes
 * @coordinates-with plugins/videoEmbed/tiptap.ts — uses registry for paste + parseHTML
 * @coordinates-with utils/sanitize.ts — domain whitelist mirrors registry providers
 * @coordinates-with server/mcp/src/tools/media.ts — duplicates provider IDs/URLs (separate process, can't import)
 * @module utils/videoProviderRegistry
 */

import { parseYoutubeUrl } from "./youtubeUrlParser";
import {
  parseHttpUrl,
  parseVimeoUrl,
  parseVimeoUrlFull,
  isVimeoVideoId,
  isVimeoPrivacyHash,
} from "./vimeoUrlParser";

/** Supported video embed provider identifiers. */
export type VideoProvider = "youtube" | "vimeo" | "bilibili";

/** Result of parsing a video URL: the matched provider and extracted video ID. */
export interface VideoParseResult {
  provider: VideoProvider;
  videoId: string;
  /**
   * Vimeo unlisted-video privacy hash (`vimeo.com/{id}/{hash}` or `?h=`).
   * Unlisted embeds do not play without it. Absent for other providers.
   */
  privacyHash?: string;
}

/** Video ID plus provider-specific embed metadata. */
export interface VideoIdInfo {
  videoId: string;
  privacyHash?: string;
}

/** Full configuration for a video provider: URL parsing, embed generation, and defaults. */
export interface ProviderConfig {
  /** Parse a URL and return a video ID, or null if not matched */
  parseUrl: (url: string) => string | null;
  /**
   * Parse a URL to the ID plus provider-specific embed metadata. Providers
   * without extra metadata derive this from `parseUrl`.
   */
  parseUrlFull: (url: string) => VideoIdInfo | null;
  /** Build the embed iframe src URL from a video ID */
  buildEmbedUrl: (videoId: string) => string;
  /**
   * Whether a video ID has the provider's exact format (checked before an ID
   * may be embedded). A closure over a module-private pattern rather than an
   * exposed RegExp: `Object.freeze` cannot protect a regex's matching
   * behavior (legacy `.compile()` swaps the pattern before throwing), so the
   * regex simply never leaves this module.
   */
  isValidId: (videoId: string) => boolean;
  /** Default embed width */
  defaultWidth: number;
  /** Default embed height */
  defaultHeight: number;
  /** CSS padding-bottom for responsive sizing */
  aspectRatio: string;
}

/** Wrap an ID-only parser as a parseUrlFull. */
function fullFromIdParser(parse: (url: string) => string | null) {
  return (url: string): VideoIdInfo | null => {
    const videoId = parse(url);
    return videoId ? { videoId } : null;
  };
}

// -- Bilibili URL parser --

/** BV ID format: starts with BV, followed by 10 alphanumeric characters. Module-private — see ProviderConfig.isValidId. */
const BILIBILI_BV_RE = /^BV[a-zA-Z0-9]{10}$/;

function parseBilibiliUrl(url: string): string | null {
  const res = parseHttpUrl(url);
  if (!res) return null;
  const { parsed, host } = res;

  // player.bilibili.com/player.html?bvid=BVxxxxxx — the embed player lives at
  // exactly /player.html; a valid bvid on any other path is not an embed URL.
  if (host === "player.bilibili.com") {
    if (parsed.pathname !== "/player.html") return null;
    const bvid = parsed.searchParams.get("bvid");
    return bvid && BILIBILI_BV_RE.test(bvid) ? bvid : null;
  }

  // bilibili.com/video/BVxxxxxx — anchored so trailing garbage after the ID
  // is rejected rather than silently truncated.
  if (host === "bilibili.com") {
    const match = parsed.pathname.match(/^\/video\/(BV[a-zA-Z0-9]{10})\/?$/);
    return match?.[1] ?? null;
  }

  // b23.tv short URLs are not supported — they require HTTP redirect resolution
  // to obtain the real BV ID, which we can't do synchronously.

  return null;
}

// -- Provider configs --

/**
 * YouTube video IDs are exactly 11 characters of this charset — the same
 * shape youtubeUrlParser emits, so parse output and embed validation agree.
 * Module-private — see ProviderConfig.isValidId.
 */
const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

const PROVIDERS: Record<VideoProvider, ProviderConfig> = {
  youtube: Object.freeze<ProviderConfig>({
    parseUrl: parseYoutubeUrl,
    parseUrlFull: fullFromIdParser(parseYoutubeUrl),
    buildEmbedUrl: (videoId) =>
      `https://www.youtube-nocookie.com/embed/${videoId}`,
    isValidId: (videoId) => YOUTUBE_ID_RE.test(videoId),
    defaultWidth: 560,
    defaultHeight: 315,
    aspectRatio: "56.25%",
  }),
  vimeo: Object.freeze<ProviderConfig>({
    parseUrl: parseVimeoUrl,
    parseUrlFull: parseVimeoUrlFull,
    buildEmbedUrl: (videoId) =>
      `https://player.vimeo.com/video/${videoId}`,
    isValidId: isVimeoVideoId,
    defaultWidth: 560,
    defaultHeight: 315,
    aspectRatio: "56.25%",
  }),
  bilibili: Object.freeze<ProviderConfig>({
    parseUrl: parseBilibiliUrl,
    parseUrlFull: fullFromIdParser(parseBilibiliUrl),
    buildEmbedUrl: (videoId) =>
      `https://player.bilibili.com/player.html?bvid=${videoId}`,
    isValidId: (videoId) => BILIBILI_BV_RE.test(videoId),
    defaultWidth: 560,
    defaultHeight: 350,
    aspectRatio: "62.5%",
  }),
};
Object.freeze(PROVIDERS);

/** Derived from the registry keys — the one place providers are declared. */
const PROVIDER_LIST = Object.freeze(
  Object.keys(PROVIDERS) as VideoProvider[]
);

/**
 * Parse a URL and detect which video provider it belongs to.
 * Returns the provider name and video ID, or null if no provider matches.
 */
export function parseVideoUrl(url: string): VideoParseResult | null {
  if (!url) return null;
  const trimmed = url.trim();
  for (const provider of PROVIDER_LIST) {
    const info = PROVIDERS[provider].parseUrlFull(trimmed);
    if (info) return { provider, ...info };
  }
  return null;
}

/**
 * Build the embed iframe src URL for a given provider and video ID.
 * Returns "about:blank" for unknown providers and for IDs that do not match
 * the provider's format (node attrs can be imported or set programmatically,
 * so they are validated before being interpolated into a URL).
 */
export function buildEmbedUrl(
  provider: VideoProvider,
  videoId: string,
  opts?: { privacyHash?: string | null }
): string {
  const config = PROVIDERS[provider];
  if (!config) return "about:blank";
  if (!config.isValidId(videoId)) return "about:blank";
  const base = config.buildEmbedUrl(videoId);
  // The `h` param is Vimeo's unlisted-video privacy hash — required for the
  // embed to play at all. Validated charset, vimeo-only.
  if (provider === "vimeo" && opts?.privacyHash && isVimeoPrivacyHash(opts.privacyHash)) {
    return `${base}?h=${opts.privacyHash}`;
  }
  return base;
}

/**
 * Detect which video provider an iframe src belongs to.
 * Reuses the hostname-anchored URL parsers, so lookalike domains and provider
 * substrings inside another URL's query string cannot match.
 */
export function detectProviderFromIframeSrc(src: string): VideoProvider | null {
  return parseVideoUrl(src)?.provider ?? null;
}

/**
 * Get the full (frozen) config for a provider.
 */
export function getProviderConfig(provider: VideoProvider): ProviderConfig | undefined {
  return PROVIDERS[provider];
}

/**
 * Extract video ID from an iframe src for a specific provider.
 * Uses the provider's URL parser on the full src URL.
 */
export function extractVideoIdFromSrc(provider: VideoProvider, src: string): string | null {
  const config = PROVIDERS[provider];
  if (!config) return null;
  return config.parseUrl(src);
}

/**
 * Extract video ID plus provider-specific embed metadata (the Vimeo privacy
 * hash) from an iframe src. Consumers that persist node attrs use this so
 * unlisted Vimeo embeds survive a round trip.
 */
export function extractVideoInfoFromSrc(
  provider: VideoProvider,
  src: string
): VideoIdInfo | null {
  const config = PROVIDERS[provider];
  if (!config) return null;
  return config.parseUrlFull(src.trim());
}
