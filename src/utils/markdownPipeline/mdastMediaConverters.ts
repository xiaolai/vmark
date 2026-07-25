/**
 * MDAST Media Converters
 *
 * Purpose: Converts paragraph and HTML MDAST nodes to ProseMirror nodes, including
 * promotion of media content to native block nodes. Split from mdastBlockConverters.ts
 * for size.
 *
 * Paragraph ownership is decided by the claim protocol (ADR-015 D2b), not by
 * `if`-order: see mdastParagraphClaims.ts. Strengths encode why each claim is
 * made, so reordering recognizers cannot change which converter wins.
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
import { resolveClaim } from "@/lib/extensions/claim";
import { mdPipelineWarn } from "@/utils/debug";
import {
  PARAGRAPH_RECOGNIZERS,
  type ParagraphClaimInput,
} from "./mdastParagraphClaims";

export function convertParagraph(
  context: MdastToPmContext,
  node: Paragraph,
  marks: Mark[]
): PMNode | null {
  const type = context.schema.nodes.paragraph;
  if (!type) return null;
  const sourceLine = getSourceLine(node);

  const onlyChild =
    node.children.length === 1
      ? (node.children[0] as import("mdast").Image | import("mdast").Html | undefined) ?? null
      : null;

  const input: ParagraphClaimInput = {
    node,
    onlyChild: onlyChild?.type === "image" || onlyChild?.type === "html" ? onlyChild : null,
    promoteMedia: () => {
      const img = onlyChild as import("mdast").Image;
      return promoteImageToMediaNode(
        context,
        img.url ?? "",
        img.alt ?? "",
        img.title ?? "",
        sourceLine,
      );
    },
    promoteHtml: () =>
      tryPromoteMediaHtml(context, (onlyChild as import("mdast").Html).value ?? "", sourceLine),
    buildBlockImage: () => {
      const blockImageType = context.schema.nodes.block_image;
      if (!blockImageType) return null;
      const imageNode = inlineConverters.convertImage(
        context.schema,
        onlyChild as import("mdast").Image,
      );
      if (!imageNode) return null;
      return blockImageType.create({
        /* v8 ignore next -- @preserve reason: convertImage always returns a node with a string src (isSafeUrl returns a string); the ?? "" fallback is unreachable */
        src: imageNode.attrs.src ?? "",
        alt: imageNode.attrs.alt ?? "",
        title: imageNode.attrs.title ?? "",
        sourceLine,
      });
    },
    buildParagraph: () =>
      type.create(
        { sourceLine },
        context.convertChildren(node.children as Content[], marks, "inline"),
      ),
  };

  const resolution = resolveClaim(PARAGRAPH_RECOGNIZERS, input, "paragraph");
  if (resolution.error !== null) {
    mdPipelineWarn(`[MdastToPM] ${resolution.error.message}`);
    return input.buildParagraph();
  }
  const built = resolution.winner?.claim.value();
  // A winning claim may still decline to build (schema lacks the node type);
  // preserving the paragraph is always safe.
  return built ?? input.buildParagraph();
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
  alt: string,
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
  return type.create({ src, alt, title, controls: true, preload: "metadata", sourceLine });
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
