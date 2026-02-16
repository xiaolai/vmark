/**
 * Video Provider Registry
 *
 * Purpose: Centralized registry of video embed providers (YouTube, Vimeo, Bilibili).
 * Each provider defines URL parsing, embed URL generation, and iframe detection.
 *
 * Key decisions:
 *   - YouTube parser delegates to youtubeUrlParser.ts (shared, battle-tested)
 *   - Vimeo and Bilibili parsers use the same URL-based approach
 *   - Provider configs include default dimensions and aspect ratios
 *   - Registry is a plain object — no class needed for a static lookup table
 *
 * @coordinates-with youtubeUrlParser.ts — reuses YouTube URL parsing
 * @coordinates-with plugins/videoEmbed/tiptap.ts — uses registry for paste + parseHTML
 * @coordinates-with utils/sanitize.ts — domain whitelist mirrors registry providers
 * @coordinates-with vmark-mcp-server/src/tools/media.ts — duplicates provider IDs/URLs (separate process, can't import)
 * @module utils/videoProviderRegistry
 */

import { parseYoutubeUrl } from "./youtubeUrlParser";

export type VideoProvider = "youtube" | "vimeo" | "bilibili";

export interface VideoParseResult {
  provider: VideoProvider;
  videoId: string;
}

export interface ProviderConfig {
  /** Human-readable provider name */
  name: VideoProvider;
  /** Parse a URL and return a video ID, or null if not matched */
  parseUrl: (url: string) => string | null;
  /** Build the embed iframe src URL from a video ID */
  buildEmbedUrl: (videoId: string) => string;
  /** Regex to detect this provider's iframe src */
  iframeSrcPattern: RegExp;
  /** Default embed width */
  defaultWidth: number;
  /** Default embed height */
  defaultHeight: number;
  /** CSS padding-bottom for responsive sizing */
  aspectRatio: string;
}

// -- Vimeo URL parser --

/** Vimeo video ID: numeric only */
const VIMEO_VIDEO_ID_RE = /^\d+$/;

/** Non-video path prefixes on vimeo.com */
const VIMEO_NON_VIDEO_PREFIXES = /^\/(channels|groups|user\d*|showcase|manage|settings|ondemand|categories)\b/i;

function parseVimeoUrl(url: string): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const host = parsed.hostname.replace(/^www\./, "");

  // player.vimeo.com/video/{id}
  if (host === "player.vimeo.com") {
    const match = parsed.pathname.match(/^\/video\/(\d+)/);
    return match?.[1] ?? null;
  }

  // vimeo.com/{id}
  if (host === "vimeo.com") {
    // Exclude non-video paths
    if (VIMEO_NON_VIDEO_PREFIXES.test(parsed.pathname)) return null;
    const id = parsed.pathname.split("/")[1];
    return id && VIMEO_VIDEO_ID_RE.test(id) ? id : null;
  }

  return null;
}

// -- Bilibili URL parser --

/** BV ID format: starts with BV, followed by 10 alphanumeric characters */
const BILIBILI_BV_RE = /^BV[a-zA-Z0-9]{10}$/;

function parseBilibiliUrl(url: string): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const host = parsed.hostname.replace(/^www\./, "");

  // player.bilibili.com/player.html?bvid=BVxxxxxx
  if (host === "player.bilibili.com") {
    const bvid = parsed.searchParams.get("bvid");
    return bvid && BILIBILI_BV_RE.test(bvid) ? bvid : null;
  }

  // bilibili.com/video/BVxxxxxx
  if (host === "bilibili.com") {
    const match = parsed.pathname.match(/^\/video\/(BV[a-zA-Z0-9]{10})/);
    return match?.[1] ?? null;
  }

  // b23.tv short URLs are not supported — they require HTTP redirect resolution
  // to obtain the real BV ID, which we can't do synchronously.

  return null;
}

// -- Provider configs --

const PROVIDERS: Record<VideoProvider, ProviderConfig> = {
  youtube: {
    name: "youtube",
    parseUrl: parseYoutubeUrl,
    buildEmbedUrl: (videoId) =>
      `https://www.youtube-nocookie.com/embed/${videoId}`,
    iframeSrcPattern: /youtube(?:-nocookie)?\.com\/embed\//i,
    defaultWidth: 560,
    defaultHeight: 315,
    aspectRatio: "56.25%",
  },
  vimeo: {
    name: "vimeo",
    parseUrl: parseVimeoUrl,
    buildEmbedUrl: (videoId) =>
      `https://player.vimeo.com/video/${videoId}`,
    iframeSrcPattern: /player\.vimeo\.com\/video\//i,
    defaultWidth: 560,
    defaultHeight: 315,
    aspectRatio: "56.25%",
  },
  bilibili: {
    name: "bilibili",
    parseUrl: parseBilibiliUrl,
    buildEmbedUrl: (videoId) =>
      `https://player.bilibili.com/player.html?bvid=${videoId}`,
    iframeSrcPattern: /player\.bilibili\.com\//i,
    defaultWidth: 560,
    defaultHeight: 350,
    aspectRatio: "62.5%",
  },
};

const PROVIDER_LIST: VideoProvider[] = ["youtube", "vimeo", "bilibili"];

/**
 * Parse a URL and detect which video provider it belongs to.
 * Returns the provider name and video ID, or null if no provider matches.
 */
export function parseVideoUrl(url: string): VideoParseResult | null {
  if (!url) return null;
  const trimmed = url.trim();
  for (const provider of PROVIDER_LIST) {
    const videoId = PROVIDERS[provider].parseUrl(trimmed);
    if (videoId) return { provider, videoId };
  }
  return null;
}

/**
 * Build the embed iframe src URL for a given provider and video ID.
 * Returns "about:blank" if the provider is unknown.
 */
export function buildEmbedUrl(provider: VideoProvider, videoId: string): string {
  const config = PROVIDERS[provider];
  if (!config) return "about:blank";
  return config.buildEmbedUrl(videoId);
}

/**
 * Detect which video provider an iframe src belongs to.
 * Returns the provider name or null if no match.
 */
export function detectProviderFromIframeSrc(src: string): VideoProvider | null {
  if (!src) return null;
  for (const provider of PROVIDER_LIST) {
    if (PROVIDERS[provider].iframeSrcPattern.test(src)) return provider;
  }
  return null;
}

/**
 * Get the full config for a provider.
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
