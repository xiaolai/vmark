/**
 * MDAST Media Converters
 *
 * Purpose: Converts HTML MDAST nodes to ProseMirror nodes, including
 * promotion of media content to native block nodes (paragraph conversion
 * lives in mdastParagraphConverter.ts). Split from mdastBlockConverters.ts
 * for size.
 *
 * Key decisions:
 *   - Paragraphs with a single image child are promoted to block_image nodes;
 *     video/audio extensions promote to block_video/block_audio instead
 *   - HTML blocks containing <video>, <audio>, or video provider <iframe> tags are
 *     promoted to block_video, block_audio, or video_embed nodes; a missing src
 *     attribute falls back to the first nested <source> tag's src
 *   - Paragraphs with a single inline-html child (<video>/<audio>) are also
 *     promoted as a safety net for CommonMark inline-HTML edge cases
 *
 * @coordinates-with mdastConverterHelpers.ts — shared context type and helpers
 * @coordinates-with mdastParagraphConverter.ts — paragraph claims consume the promoters
 * @coordinates-with mdastBlockConverters.ts — re-export hub for all block converters
 * @module utils/markdownPipeline/mdastMediaConverters
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Html } from "mdast";
import { hasVideoExtension, hasAudioExtension } from "@/utils/mediaPathDetection";
import { detectProviderFromIframeSrc, extractVideoInfoFromSrc, getProviderConfig } from "@/utils/videoProviderRegistry";
import { isSafeUrl } from "./urlValidation";
import { getSourceLine, type MdastToPmContext } from "./mdastConverterHelpers";

export function convertHtml(
  context: MdastToPmContext,
  node: Html,
  inline: boolean
): PMNode | null {
  const value = node.value ?? "";
  const sourceLine = getSourceLine(node);

  // In block context, try to promote <video> and <audio> HTML to native nodes
  if (!inline) {
    const promoted = tryPromoteMediaHtml(context, value, sourceLine);
    if (promoted) return promoted;
  }

  const type = inline ? context.schema.nodes.html_inline : context.schema.nodes.html_block;
  if (!type) return null;
  return type.create({ value, sourceLine });
}

/**
 * Promote an image-syntax src with a video/audio extension to the matching
 * block node. Returns null when the extension is not media or the schema
 * lacks the node type (callers then fall back to block_image / paragraph).
 */
export function promoteImageToMediaNode(
  context: MdastToPmContext,
  src: string,
  alt: string,
  title: string,
  sourceLine: number | null,
  /** Reference identity from the source `![alt][id]`, if it was one. */
  reference: { referenceId?: string; referenceType?: string } = {}
): PMNode | null {
  // Same gate as the HTML-tag path: `javascript:x.mp4` has a video extension
  // but must never cross into a block_video src. Declining promotion routes
  // the image through convertImage, which sanitizes.
  if (!src || !isSafeUrl(src)) return null;
  const nodeName = hasVideoExtension(src)
    ? "block_video"
    : hasAudioExtension(src)
      ? "block_audio"
      : null;
  if (!nodeName) return null;
  const type = context.schema.nodes[nodeName];
  if (!type) return null;
  return type.create({
    src,
    alt,
    title,
    controls: true,
    preload: "metadata",
    sourceLine,
    referenceId: reference.referenceId ?? null,
    referenceType: reference.referenceType ?? null,
  });
}

/**
 * Try to promote HTML containing <video>, <audio>, or a video provider
 * <iframe> to native block nodes. Returns null if the HTML doesn't match
 * or the schema lacks the node type.
 */
export function tryPromoteMediaHtml(
  context: MdastToPmContext,
  html: string,
  sourceLine: number | null
): PMNode | null {
  const trimmed = html.trim();
  return (
    promoteMediaTagHtml(context, trimmed, sourceLine) ??
    promoteIframeHtml(context, trimmed, sourceLine)
  );
}

/** Media tag configs — video carries a poster attribute, audio doesn't. */
const MEDIA_TAG_SPECS = [
  { tag: "video", nodeName: "block_video", withPoster: true },
  { tag: "audio", nodeName: "block_audio", withPoster: false },
] as const;

/** Count closing tags of `tag` in the HTML (case-insensitive). */
function countTagCloses(html: string, tag: string): number {
  return (html.match(new RegExp(`</${tag}>`, "gi")) ?? []).length;
}

/**
 * Whether promoting this media markup would LOSE information: multiple
 * <source> children (codec/format alternatives), any <track> (captions), or
 * a src attr PLUS a <source> fallback cannot be represented on a single-src
 * block node. Lossy markup stays an html_block so a round trip preserves it
 * byte-for-byte.
 */
function mediaPromotionWouldBeLossy(innerHtml: string, hasSrcAttr: boolean): boolean {
  const sourceCount = (innerHtml.match(/<source\b/gi) ?? []).length;
  if (/<track\b/i.test(innerHtml)) return true;
  if (sourceCount > 1) return true;
  return hasSrcAttr && sourceCount >= 1;
}

/** Detect `<video ...>...</video>` / `<audio ...>...</audio>` and promote. */
function promoteMediaTagHtml(
  context: MdastToPmContext,
  trimmed: string,
  sourceLine: number | null
): PMNode | null {
  for (const spec of MEDIA_TAG_SPECS) {
    const re = new RegExp(`^<${spec.tag}\\b([^>]*)>([\\s\\S]*)</${spec.tag}>$`, "i");
    const match = trimmed.match(re);
    if (!match) continue;
    // Sibling tags swallowed by the greedy match, or markup a single-src
    // node cannot express — keep the html_block rather than promote lossily.
    if (countTagCloses(trimmed, spec.tag) !== 1) return null;

    const type = context.schema.nodes[spec.nodeName];
    if (!type) return null;
    const attrs = parseHtmlAttributes(match[1]);
    if (mediaPromotionWouldBeLossy(match[2], "src" in attrs)) return null;
    // Common markup puts the src on a nested <source> tag instead of the
    // media element itself — fall back to the first one so it isn't lost.
    const src = attrs.src ?? extractNestedSourceSrc(match[2]) ?? "";
    // Promotion must not smuggle unsafe schemes (javascript:, data:) into
    // media nodes — same gate the image path applies. Unsafe → stays html_block.
    if (src && !isSafeUrl(src)) return null;
    const nodeAttrs: Record<string, unknown> = {
      src,
      // data-alt carries the alt metadata <video>/<audio> cannot express —
      // the serializer writes it, this restores it.
      alt: attrs["data-alt"] ?? "",
      title: attrs.title ?? "",
      controls: "controls" in attrs,
      preload: attrs.preload ?? "metadata",
      sourceLine,
    };
    if (spec.withPoster) {
      // Poster is a URL attribute too — same scheme policy as src.
      const poster = attrs.poster ?? "";
      nodeAttrs.poster = poster && isSafeUrl(poster) ? poster : "";
    }
    return type.create(nodeAttrs);
  }
  return null;
}

/**
 * Strict positive-integer dimension: rejects negatives, units ("50%"), and
 * non-decimal forms parseInt would truncate-accept. Falls back to the
 * provider default.
 */
function parseDimension(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return n > 0 ? n : fallback;
}

/** Detect video provider `<iframe ...>...</iframe>` (YouTube, Vimeo, Bilibili) and promote. */
function promoteIframeHtml(
  context: MdastToPmContext,
  trimmed: string,
  sourceLine: number | null
): PMNode | null {
  const iframeMatch = trimmed.match(/^<iframe\b([^>]*)>[\s\S]*<\/iframe>$/i);
  if (!iframeMatch) return null;
  // The greedy regex would swallow SIBLING iframes into one match, silently
  // discarding all but the first — exactly one closing tag or no promotion.
  if (countTagCloses(trimmed, "iframe") !== 1) return null;

  const videoEmbedType = context.schema.nodes.video_embed;
  if (!videoEmbedType) return null;
  const attrs = parseHtmlAttributes(iframeMatch[1]);
  const src = attrs.src ?? "";
  const provider = detectProviderFromIframeSrc(src);
  if (!provider) return null; // Not a recognized video iframe, let it be html_block
  const info = extractVideoInfoFromSrc(provider, src);
  if (!info) return null;
  const config = getProviderConfig(provider);
  /* v8 ignore next -- @preserve defensive: config is always defined when provider is recognized */
  if (!config) return null;
  return videoEmbedType.create({
    provider,
    videoId: info.videoId,
    privacyHash: info.privacyHash ?? null,
    width: parseDimension(attrs.width, config.defaultWidth),
    height: parseDimension(attrs.height, config.defaultHeight),
    sourceLine,
  });
}

/** Extract the src of the first nested `<source ...>` tag, or null. */
function extractNestedSourceSrc(innerHtml: string): string | null {
  const match = innerHtml.match(/<source\b([^>]*)>/i);
  if (!match) return null;
  return parseHtmlAttributes(match[1]).src ?? null;
}

/**
 * Parse HTML attributes from an attribute string.
 * Handles quoted (`key="value"`), unquoted (`key=value`), and boolean
 * (`controls`) attributes.
 */
function parseHtmlAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Match key="value", key='value', key=value, or standalone boolean attributes
  const re = /([a-zA-Z_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match;
  while ((match = re.exec(attrString)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? key; // Boolean attr gets key as value
    attrs[key] = value;
  }
  return attrs;
}
