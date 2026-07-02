/**
 * MDAST Media Converters
 *
 * Purpose: Converts paragraph and HTML MDAST nodes to ProseMirror nodes, including
 * promotion of media content to native block nodes. Split from mdastBlockConverters.ts
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
 * @coordinates-with mdastBlockConverters.ts — re-export hub for all block converters
 * @module utils/markdownPipeline/mdastMediaConverters
 */

import type { Node as PMNode, Mark } from "@tiptap/pm/model";
import type { Content, Html, Paragraph } from "mdast";
import * as inlineConverters from "./mdastInlineConverters";
import { hasVideoExtension, hasAudioExtension } from "@/utils/mediaPathDetection";
import { detectProviderFromIframeSrc, extractVideoIdFromSrc, getProviderConfig } from "@/utils/videoProviderRegistry";
import { getSourceLine, type MdastToPmContext } from "./mdastConverterHelpers";

export function convertParagraph(
  context: MdastToPmContext,
  node: Paragraph,
  marks: Mark[]
): PMNode | null {
  const type = context.schema.nodes.paragraph;
  if (!type) return null;
  const sourceLine = getSourceLine(node);

  // Promote single image child to block_image, block_video, or block_audio based on extension
  if (node.children.length === 1 && node.children[0]?.type === "image") {
    const imgChild = node.children[0] as import("mdast").Image;
    const src = imgChild.url ?? "";

    // Check for video/audio extension first, then fall back to block_image
    const mediaNode = promoteImageToMediaNode(context, src, imgChild.title ?? "", sourceLine);
    if (mediaNode) return mediaNode;

    const blockImageType = context.schema.nodes.block_image;
    if (blockImageType) {
      const imageNode = inlineConverters.convertImage(context.schema, imgChild);
      if (imageNode) {
        return blockImageType.create({
          /* v8 ignore next -- @preserve reason: convertImage always returns a node with a string src (isSafeUrl returns a string); the ?? "" fallback is unreachable */
          src: imageNode.attrs.src ?? "",
          alt: imageNode.attrs.alt ?? "",
          title: imageNode.attrs.title ?? "",
          sourceLine,
        });
      }
    }
  }
  // Safety net: promote single inline-html child containing <video>/<audio>
  if (node.children.length === 1 && node.children[0]?.type === "html") {
    const htmlChild = node.children[0] as import("mdast").Html;
    const promoted = tryPromoteMediaHtml(context, htmlChild.value ?? "", sourceLine);
    if (promoted) return promoted;
  }

  const children = context.convertChildren(node.children as Content[], marks, "inline");
  return type.create({ sourceLine }, children);
}

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
function promoteImageToMediaNode(
  context: MdastToPmContext,
  src: string,
  title: string,
  sourceLine: number | null
): PMNode | null {
  const nodeName = hasVideoExtension(src)
    ? "block_video"
    : hasAudioExtension(src)
      ? "block_audio"
      : null;
  if (!nodeName) return null;
  const type = context.schema.nodes[nodeName];
  if (!type) return null;
  return type.create({ src, title, controls: true, preload: "metadata", sourceLine });
}

/**
 * Try to promote HTML containing <video>, <audio>, or a video provider
 * <iframe> to native block nodes. Returns null if the HTML doesn't match
 * or the schema lacks the node type.
 */
function tryPromoteMediaHtml(
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

    const type = context.schema.nodes[spec.nodeName];
    if (!type) return null;
    const attrs = parseHtmlAttributes(match[1]);
    // Common markup puts the src on a nested <source> tag instead of the
    // media element itself — fall back to the first one so it isn't lost.
    const src = attrs.src ?? extractNestedSourceSrc(match[2]) ?? "";
    const nodeAttrs: Record<string, unknown> = {
      src,
      title: attrs.title ?? "",
      controls: "controls" in attrs,
      preload: attrs.preload ?? "metadata",
      sourceLine,
    };
    if (spec.withPoster) nodeAttrs.poster = attrs.poster ?? "";
    return type.create(nodeAttrs);
  }
  return null;
}

/** Detect video provider `<iframe ...>...</iframe>` (YouTube, Vimeo, Bilibili) and promote. */
function promoteIframeHtml(
  context: MdastToPmContext,
  trimmed: string,
  sourceLine: number | null
): PMNode | null {
  const iframeMatch = trimmed.match(/^<iframe\b([^>]*)>[\s\S]*<\/iframe>$/i);
  if (!iframeMatch) return null;

  const videoEmbedType = context.schema.nodes.video_embed;
  if (!videoEmbedType) return null;
  const attrs = parseHtmlAttributes(iframeMatch[1]);
  const src = attrs.src ?? "";
  const provider = detectProviderFromIframeSrc(src);
  if (!provider) return null; // Not a recognized video iframe, let it be html_block
  const videoId = extractVideoIdFromSrc(provider, src);
  if (!videoId) return null;
  const config = getProviderConfig(provider);
  return videoEmbedType.create({
    provider,
    videoId,
    /* v8 ignore start -- @preserve reason: config is always defined when provider is recognized; the ?? 560/315 fallbacks are unreachable in practice */
    width: parseInt(attrs.width ?? String(config?.defaultWidth ?? 560), 10) || 560,
    height: parseInt(attrs.height ?? String(config?.defaultHeight ?? 315), 10) || 315,
    /* v8 ignore stop */
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
