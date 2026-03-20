/**
 * ProseMirror Block Node Converters (PM → MDAST)
 *
 * Purpose: Converts block-level ProseMirror nodes (including media and embeds)
 * to MDAST nodes for serialization. Split from proseMirrorToMdast.ts for size.
 *
 * Key decisions:
 *   - Alert blocks are serialized as blockquotes with `[!TYPE]` markers
 *     (GitHub-flavored markdown alert syntax)
 *   - Math blocks use the MATH_BLOCK_LANGUAGE sentinel to distinguish
 *     from regular code blocks (must match mdastBlockConverters.ts)
 *   - Table cell alignment is extracted from header row attrs
 *   - Block images are wrapped in a paragraph (markdown has no standalone image block)
 *   - Block video/audio nodes serialize to image syntax (![](url)) for clean
 *     round-trips, falling back to multi-line HTML when attributes can't be
 *     expressed in image syntax (poster, controls=false, non-default preload)
 *   - Video embed nodes serialize to provider-specific <iframe> HTML
 *
 * @coordinates-with mdastBlockConverters.ts — reverse direction (MDAST → PM)
 * @coordinates-with pmInlineConverters.ts — handles inline content within blocks
 * @coordinates-with proseMirrorToMdast.ts — orchestrates the conversion
 * @module utils/markdownPipeline/pmBlockConverters
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type {
  Content,
  BlockContent,
  Blockquote,
  Code,
  Definition,
  Heading,
  Html,
  Image,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Table,
  TableCell,
  TableRow,
  ThematicBreak,
} from "mdast";
import type { Math } from "mdast-util-math";
import type { Details, Yaml } from "./types";
import * as inlineConverters from "./pmInlineConverters";
import { buildEmbedUrl, type VideoProvider } from "@/utils/videoProviderRegistry";

/** Escape a string for safe use in an HTML attribute value. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type PmToMdastNode = Content | ListItem;

export interface PmToMdastContext {
  convertNode: (node: PMNode) => PmToMdastNode | PmToMdastNode[] | null;
  convertInlineContent: (node: PMNode) => PhrasingContent[];
}

export function convertParagraph(context: PmToMdastContext, node: PMNode): Paragraph {
  const children = context.convertInlineContent(node);
  return { type: "paragraph", children };
}

export function convertHeading(context: PmToMdastContext, node: PMNode): Heading {
  const level = (node.attrs.level ?? 1) as 1 | 2 | 3 | 4 | 5 | 6;
  const children = context.convertInlineContent(node);
  return { type: "heading", depth: level, children };
}

/**
 * Internal sentinel value for math blocks stored as codeBlock.
 * Must match the value in mdastBlockConverters.ts.
 */
const MATH_BLOCK_LANGUAGE = "$$math$$";

export function convertCodeBlock(node: PMNode): Code | Math {
  const lang = (node.attrs.language as string | null) ?? null;
  // Check for sentinel value that identifies math blocks
  if (lang === MATH_BLOCK_LANGUAGE) {
    return {
      type: "math",
      value: node.textContent,
    };
  }

  return {
    type: "code",
    lang: lang || undefined,
    value: node.textContent,
  };
}

export function convertBlockquote(context: PmToMdastContext, node: PMNode): Blockquote {
  const children: BlockContent[] = [];
  node.forEach((child) => {
    const converted = context.convertNode(child);
    if (converted) {
      if (Array.isArray(converted)) {
        children.push(...(converted as BlockContent[]));
      } else {
        children.push(converted as BlockContent);
      }
    }
  });
  return { type: "blockquote", children };
}

export function convertAlertBlock(context: PmToMdastContext, node: PMNode): Blockquote {
  const alertType = String(node.attrs.alertType ?? "NOTE").toUpperCase();
  const children: BlockContent[] = [
    { type: "paragraph", children: [{ type: "text", value: `[!${alertType}]` }] },
  ];

  node.forEach((child) => {
    const converted = context.convertNode(child);
    if (converted) {
      if (Array.isArray(converted)) {
        children.push(...(converted as BlockContent[]));
      } else {
        children.push(converted as BlockContent);
      }
    }
  });

  return { type: "blockquote", children };
}

export function convertDetailsBlock(context: PmToMdastContext, node: PMNode): Details {
  const firstChild = node.firstChild;
  const hasSummaryNode = firstChild?.type.name === "detailsSummary";
  const summary = hasSummaryNode ? firstChild.textContent : "Details";
  // Start from index 1 only if first child is summary; otherwise start from 0
  const startIndex = hasSummaryNode ? 1 : 0;

  const children: BlockContent[] = [];
  for (let i = startIndex; i < node.childCount; i += 1) {
    const child = node.child(i);
    const converted = context.convertNode(child);
    if (converted) {
      if (Array.isArray(converted)) {
        children.push(...(converted as BlockContent[]));
      } else {
        children.push(converted as BlockContent);
      }
    }
  }

  return {
    type: "details",
    open: Boolean(node.attrs.open),
    summary,
    children,
  };
}

export function convertList(context: PmToMdastContext, node: PMNode, ordered: boolean): List {
  const children: ListItem[] = [];
  node.forEach((child) => {
    const converted = context.convertNode(child);
    if (converted && !Array.isArray(converted) && converted.type === "listItem") {
      children.push(converted as ListItem);
    }
  });

  // Derive list spread from children: loose only if any child item is spread
  const spread = children.some((item) => item.spread === true);
  const list: List = {
    type: "list",
    ordered,
    spread,
    children,
  };

  if (ordered) {
    list.start = (node.attrs.start as number) ?? 1;
  }

  return list;
}

export function convertListItem(context: PmToMdastContext, node: PMNode): ListItem {
  const children: BlockContent[] = [];
  node.forEach((child) => {
    const converted = context.convertNode(child);
    if (converted) {
      if (Array.isArray(converted)) {
        children.push(...(converted as BlockContent[]));
      } else {
        children.push(converted as BlockContent);
      }
    }
  });

  // Guard: remark-stringify corrupts output (e.g., produces "##") when a
  // listItem has zero children. Fall back to an empty paragraph.
  const safeChildren: BlockContent[] =
    children.length > 0 ? children : [{ type: "paragraph", children: [] }];

  // Spread: true only if the item has multiple non-list block children
  // (e.g., multi-paragraph items). Single paragraph + nested list = tight.
  const nonListChildren = safeChildren.filter((c) => c.type !== "list");
  const listItem: ListItem = {
    type: "listItem",
    spread: nonListChildren.length > 1,
    children: safeChildren,
  };
  const checked = node.attrs.checked;
  if (checked === true || checked === false) {
    listItem.checked = checked;
  }

  return listItem;
}

export function convertHorizontalRule(): ThematicBreak {
  return { type: "thematicBreak" };
}

export function convertTable(context: PmToMdastContext, node: PMNode): Table {
  const rows: TableRow[] = [];
  let align: Array<"left" | "center" | "right" | null> = [];

  node.forEach((row, rowIndex) => {
    if (row.type.name !== "tableRow") return;
    const cells: TableCell[] = [];

    row.forEach((cell, cellIndex) => {
      const children = convertTableCellContent(context, cell);
      cells.push({ type: "tableCell", children });

      if (rowIndex === 0) {
        const alignment = normalizeAlignment(cell.attrs.alignment);
        /* v8 ignore start -- align grows monotonically with cellIndex; else branch structurally unreachable */
        if (align.length <= cellIndex) {
          align = [...align, alignment];
        } else {
          align[cellIndex] = alignment;
        }
        /* v8 ignore stop */
      }
    });

    rows.push({ type: "tableRow", children: cells });
  });

  return { type: "table", align, children: rows };
}

function convertTableCellContent(context: PmToMdastContext, node: PMNode): PhrasingContent[] {
  const children: PhrasingContent[] = [];

  node.forEach((child) => {
    if (child.type.name === "paragraph") {
      if (children.length > 0) {
        children.push({ type: "break" });
      }
      children.push(...context.convertInlineContent(child));
    }
  });

  return children;
}

export function convertBlockImage(node: PMNode): Paragraph {
  const image = inlineConverters.convertImage(node);
  return { type: "paragraph", children: [image] };
}

/**
 * Build an image-syntax MDAST node for media, or null if attributes
 * require HTML fallback.  Shared by convertBlockVideo / convertBlockAudio.
 */
function tryMediaImageSyntax(
  src: string,
  title: string,
  controls: boolean,
  preload: string,
  extraCheck: boolean,
): Paragraph | null {
  if (!extraCheck || !controls || preload !== "metadata") return null;
  const image: Image = {
    type: "image",
    url: src,
    alt: "",
    title: title || undefined,
  };
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

  // Use image syntax when all attrs are expressible (clean round-trip)
  const imageResult = tryMediaImageSyntax(src, title, controls, preload, !poster);
  if (imageResult) return imageResult;

  // Fallback: multi-line HTML (remark treats multi-line as block HTML type 7)
  const attrs: string[] = [];
  attrs.push(`src="${escapeAttr(src)}"`);
  if (title) attrs.push(`title="${escapeAttr(title)}"`);
  if (poster) attrs.push(`poster="${escapeAttr(poster)}"`);
  if (controls) attrs.push("controls");
  if (preload && preload !== "metadata") attrs.push(`preload="${escapeAttr(preload)}"`);

  return buildMediaHtmlFallback("video", attrs);
}

export function convertVideoEmbed(node: PMNode): Html {
  const provider = String(node.attrs.provider ?? "youtube") as VideoProvider;
  const videoId = String(node.attrs.videoId ?? "");
  const width = Number(node.attrs.width ?? 560);
  const height = Number(node.attrs.height ?? 315);

  // Validate videoId per provider to prevent attribute injection
  const VIDEO_ID_PATTERNS: Record<VideoProvider, RegExp> = {
    youtube: /^[a-zA-Z0-9_-]{11}$/,
    vimeo: /^\d+$/,
    bilibili: /^BV[a-zA-Z0-9]{10}$/,
  };
  const pattern = VIDEO_ID_PATTERNS[provider];
  const safeVideoId = pattern && pattern.test(videoId) ? videoId : "";
  const embedUrl = buildEmbedUrl(provider, safeVideoId);

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

  // Use image syntax when all attrs are expressible (clean round-trip)
  const imageResult = tryMediaImageSyntax(src, title, controls, preload, true);
  if (imageResult) return imageResult;

  // Fallback: multi-line HTML
  const attrs: string[] = [];
  attrs.push(`src="${escapeAttr(src)}"`);
  if (title) attrs.push(`title="${escapeAttr(title)}"`);
  if (controls) attrs.push("controls");
  if (preload && preload !== "metadata") attrs.push(`preload="${escapeAttr(preload)}"`);

  return buildMediaHtmlFallback("audio", attrs);
}

export function convertFrontmatter(node: PMNode): Yaml {
  return { type: "yaml", value: String(node.attrs.value ?? "") };
}

export function convertDefinition(node: PMNode): Definition {
  return {
    type: "definition",
    identifier: String(node.attrs.identifier ?? ""),
    label: node.attrs.label ? String(node.attrs.label) : undefined,
    url: String(node.attrs.url ?? ""),
    title: node.attrs.title ? String(node.attrs.title) : undefined,
  };
}

export function convertHtmlBlock(node: PMNode): Html {
  return { type: "html", value: String(node.attrs.value ?? "") };
}

function normalizeAlignment(value: unknown): "left" | "center" | "right" | null {
  if (value === "left" || value === "center" || value === "right") return value;
  return null;
}
