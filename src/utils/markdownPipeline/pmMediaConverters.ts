/**
 * PM → MDAST media converters — block image/video/audio and provider video
 * embeds. Split from pmBlockConverters.ts (file-size rule).
 *
 * Round-trip rule: image syntax is used ONLY when the src has a recognizable
 * media extension (that is what re-promotes it on parse); everything else
 * takes the multi-line HTML fallback, which carries alt as `data-alt`.
 *
 * @coordinates-with pmBlockConverters.ts — re-export hub
 * @coordinates-with mdastMediaConverters.ts — the reverse direction
 * @module utils/markdownPipeline/pmMediaConverters
 */

import { buildImageOrReference } from "./imageReferenceEmit";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Html, Paragraph } from "mdast";
import * as inlineConverters from "./pmInlineConverters";
import { buildEmbedUrl, getProviderConfig, type VideoProvider } from "@/utils/videoProviderRegistry";
import { hasVideoExtension, hasAudioExtension } from "@/utils/mediaPathDetection";

/** Escape a string for safe use in an HTML attribute value. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function convertBlockImage(node: PMNode): Paragraph {
  const image = inlineConverters.convertImage(node);
  return { type: "paragraph", children: [image] };
}

/**
 * Build an image-syntax MDAST node for media, or null if attributes
 * require HTML fallback.  Shared by convertBlockVideo / convertBlockAudio.
 * `hasMediaExtension` is the ROUND-TRIP gate: image syntax only re-promotes
 * to a media node when the extension is recognized, so an extensionless or
 * signed URL must take the HTML fallback or it deserializes as an image.
 */
function tryMediaImageSyntax(
  src: string,
  alt: string,
  title: string,
  controls: boolean,
  preload: string,
  extraCheck: boolean,
  hasMediaExtension: boolean,
  referenceAttrs: { referenceId?: unknown; referenceType?: unknown } = {},
): Paragraph | null {
  if (!hasMediaExtension || !extraCheck || !controls || preload !== "metadata") return null;
  const image = buildImageOrReference({ src, alt, title, ...referenceAttrs });
  return { type: "paragraph", children: [image] };
}

/**
 * Build a multi-line HTML fallback string for media tags.
 * Multi-line form ensures remark treats it as block HTML (type 7).
 * Trailing newline prevents the closing tag from swallowing following content.
 */
function buildMediaHtmlFallback(
  tag: "video" | "audio",
  htmlAttrs: string[],
): Html {
  return { type: "html", value: `<${tag} ${htmlAttrs.join(" ")}>\n</${tag}>\n` };
}

export function convertBlockVideo(node: PMNode): Paragraph | Html {
  const src = String(node.attrs.src ?? "");
  const title = String(node.attrs.title ?? "");
  const poster = String(node.attrs.poster ?? "");
  const controls = node.attrs.controls !== false;
  const preload = String(node.attrs.preload ?? "metadata");
  const alt = String(node.attrs.alt ?? "");
  // Prefer image syntax when every attribute is expressible (clean round-trip).
  const imageResult = tryMediaImageSyntax(src, alt, title, controls, preload, !poster, hasVideoExtension(src), node.attrs);
  if (imageResult) return imageResult;

  // Fallback: multi-line HTML (remark treats multi-line as block HTML type 7)
  const attrs: string[] = [];
  attrs.push(`src="${escapeAttr(src)}"`);
  if (title) attrs.push(`title="${escapeAttr(title)}"`);
  if (poster) attrs.push(`poster="${escapeAttr(poster)}"`);
  // <video> has no alt attribute — carry it as data-alt so the reverse
  // parser can restore it instead of dropping the metadata.
  if (alt) attrs.push(`data-alt="${escapeAttr(alt)}"`);
  if (controls) attrs.push("controls");
  if (preload && preload !== "metadata") attrs.push(`preload="${escapeAttr(preload)}"`);

  return buildMediaHtmlFallback("video", attrs);
}

/** Finite positive integer, else the provider default (invalid attrs must
 *  never serialize into invalid iframe markup). */
function embedDimension(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function convertVideoEmbed(node: PMNode): Html {
  const provider = String(node.attrs.provider ?? "youtube") as VideoProvider;
  const videoId = String(node.attrs.videoId ?? "");
  const config = getProviderConfig(provider);
  const width = embedDimension(node.attrs.width, config?.defaultWidth ?? 560);
  const height = embedDimension(node.attrs.height, config?.defaultHeight ?? 315);

  // buildEmbedUrl validates the ID per provider (about:blank for malformed
  // ones, preventing attribute injection) and the Vimeo privacy hash charset.
  const embedUrl = buildEmbedUrl(provider, videoId, {
    privacyHash: typeof node.attrs.privacyHash === "string" ? node.attrs.privacyHash : null,
  });

  return {
    type: "html",
    value: `<iframe src="${embedUrl}" width="${width}" height="${height}" frameborder="0" allowfullscreen></iframe>`,
  };
}

export function convertBlockAudio(node: PMNode): Paragraph | Html {
  const src = String(node.attrs.src ?? "");
  const title = String(node.attrs.title ?? "");
  const controls = node.attrs.controls !== false;
  const preload = String(node.attrs.preload ?? "metadata");
  const alt = String(node.attrs.alt ?? "");
  const imageResult = tryMediaImageSyntax(src, alt, title, controls, preload, true, hasAudioExtension(src), node.attrs);
  if (imageResult) return imageResult;

  // Fallback: multi-line HTML
  const attrs: string[] = [];
  attrs.push(`src="${escapeAttr(src)}"`);
  if (title) attrs.push(`title="${escapeAttr(title)}"`);
  if (alt) attrs.push(`data-alt="${escapeAttr(alt)}"`);
  if (controls) attrs.push("controls");
  if (preload && preload !== "metadata") attrs.push(`preload="${escapeAttr(preload)}"`);

  return buildMediaHtmlFallback("audio", attrs);
}

