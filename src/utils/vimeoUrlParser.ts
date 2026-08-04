/**
 * Vimeo URL Parser
 *
 * Purpose: Parses every documented Vimeo video URL schema to a video ID plus
 * the unlisted-video privacy hash when present. Hostname-anchored (lookalike
 * domains and query-string echoes never match), mirroring youtubeUrlParser.
 *
 * Supported schemas (Vimeo oembed docs):
 *   - vimeo.com/{id}
 *   - vimeo.com/{id}/{hash}            (unlisted share URL)
 *   - vimeo.com/channels/{name}/{id}
 *   - vimeo.com/groups/{name}/videos/{id}
 *   - vimeo.com/album/{album}/video/{id}
 *   - vimeo.com/showcase/{showcase}/video/{id}
 *   - vimeo.com/ondemand/{name}/{id}
 *   - player.vimeo.com/video/{id}
 * plus `?h={hash}` on any of them.
 *
 * @coordinates-with videoProviderRegistry.ts — registry delegates vimeo parsing here
 * @module utils/vimeoUrlParser
 */

/** Vimeo video ID: numeric only. */
const VIMEO_VIDEO_ID_RE = /^\d+$/;
/** Vimeo privacy hash: alphanumeric token from the unlisted share URL. */
const VIMEO_HASH_RE = /^[a-zA-Z0-9]+$/;

export interface VimeoVideoInfo {
  videoId: string;
  privacyHash?: string;
}

/** Whether a string has the privacy-hash charset (used at embed-build time too). */
export function isVimeoPrivacyHash(value: string): boolean {
  return VIMEO_HASH_RE.test(value);
}

/** Parse an http(s) URL, returning it alongside the `www.`-stripped hostname. */
export function parseHttpUrl(url: string): { parsed: URL; host: string } | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return { parsed, host: parsed.hostname.replace(/^www\./, "") };
}

/**
 * The `h` privacy hash from ?h=… or the /{id}/{hash} path segment.
 * An all-numeric hash is accepted: `vimeo.com/{id}/{segment}` has no other
 * meaning, and dropping the hash makes an unlisted video unplayable.
 */
function vimeoPrivacyHash(parsed: URL, pathSegment?: string): string | undefined {
  const fromQuery = parsed.searchParams.get("h");
  if (fromQuery && VIMEO_HASH_RE.test(fromQuery)) return fromQuery;
  if (pathSegment && VIMEO_HASH_RE.test(pathSegment)) return pathSegment;
  return undefined;
}

/** The video ID for one path shape, or null when the shape doesn't match. */
function idFromSegments(segments: string[]): { id: string; pathHash?: string } | null {
  // vimeo.com/{id} and the unlisted form vimeo.com/{id}/{hash}
  if (segments.length >= 1 && VIMEO_VIDEO_ID_RE.test(segments[0])) {
    if (segments.length === 1) return { id: segments[0] };
    if (segments.length === 2) return { id: segments[0], pathHash: segments[1] };
    return null;
  }
  const [kind, , b, c] = segments;
  // vimeo.com/channels/{name}/{id} and vimeo.com/ondemand/{name}/{id}
  if ((kind === "channels" || kind === "ondemand") && segments.length === 3) {
    return VIMEO_VIDEO_ID_RE.test(b) ? { id: b } : null;
  }
  // vimeo.com/groups/{name}/videos/{id}
  if (kind === "groups" && segments.length === 4 && b === "videos") {
    return VIMEO_VIDEO_ID_RE.test(c) ? { id: c } : null;
  }
  // vimeo.com/album/{album}/video/{id} and vimeo.com/showcase/{showcase}/video/{id}
  if ((kind === "album" || kind === "showcase") && segments.length === 4 && b === "video") {
    return VIMEO_VIDEO_ID_RE.test(c) ? { id: c } : null;
  }
  return null;
}

/** Parse any supported Vimeo video URL to its ID (+ privacy hash), or null. */
export function parseVimeoUrlFull(url: string): VimeoVideoInfo | null {
  const res = parseHttpUrl(url);
  if (!res) return null;
  const { parsed, host } = res;

  // player.vimeo.com/video/{id} — anchored: `/video/123abc` is malformed,
  // not a source of ID "123".
  if (host === "player.vimeo.com") {
    const match = parsed.pathname.match(/^\/video\/(\d+)\/?$/);
    if (!match) return null;
    // `privacyHash` omitted rather than undefined: a public video HAS no hash,
    // and the embed builder tests for the key's presence.
    const hash = vimeoPrivacyHash(parsed);
    return { videoId: match[1], ...(hash ? { privacyHash: hash } : {}) };
  }

  if (host === "vimeo.com") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const found = idFromSegments(segments);
    if (!found) return null;
    const hash = vimeoPrivacyHash(parsed, found.pathHash);
    return { videoId: found.id, ...(hash ? { privacyHash: hash } : {}) };
  }

  return null;
}

/** ID-only convenience form (ProviderConfig.parseUrl). */
export function parseVimeoUrl(url: string): string | null {
  return parseVimeoUrlFull(url)?.videoId ?? null;
}

/** Whether a video ID has Vimeo's exact format. */
export function isVimeoVideoId(videoId: string): boolean {
  return VIMEO_VIDEO_ID_RE.test(videoId);
}
