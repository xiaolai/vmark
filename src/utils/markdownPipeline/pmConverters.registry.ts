/**
 * Tier-1 PM → mdast converters, expressed as registry entries — Phase 2 WI-2.1.
 *
 * Purpose: registry 2 for the PM → mdast direction. Owns dispatch for all 23
 * migrated node types; the switch that used to do this is deleted.
 *
 * Method (Codex MAJOR — differential, not big-bang): the registry was built
 * ALONGSIDE the switch and proven byte-identical per node in
 * `pmConverters.registry.test.ts`, with the 22-fixture corpus as the
 * whole-document check. Only once both were green were the arms removed.
 *
 * `extensionId`s are the ids these converters will carry once the owning plugin
 * declares them (ADR-015 D1). Naming them now keeps the eventual move a
 * relocation rather than a redesign.
 *
 * Not here, and deliberately:
 *   - Marks — `groupInlineItems` factors mark runs across ALL marks at once and
 *     cannot decompose per mark; that stays central by design (WI-1.6).
 *   - The mdast → PM direction — 31 arms, and the one that genuinely needs the
 *     claim protocol, since several extensions compete for one mdast type there.
 *
 * @coordinates-with lib/extensions/pmConverterRegistry.ts — the dispatch table
 * @coordinates-with proseMirrorToMdast.ts — the switch this mirrors
 * @module utils/markdownPipeline/pmConverters.registry
 */
import type { Node as PMNode } from "@tiptap/pm/model";
import { mdPipelineWarn } from "@/utils/debug";
import { PmConverterRegistry } from "@/lib/extensions/pmConverterRegistry";
import * as inlineConverters from "./pmInlineConverters";
import {
  convertAlertBlock,
  convertBlockAudio,
  convertBlockImage,
  convertBlockVideo,
  convertBlockquote,
  convertCodeBlock,
  convertDefinition,
  convertDetailsBlock,
  convertFrontmatter,
  convertHeading,
  convertHorizontalRule,
  convertHtmlBlock,
  convertList,
  convertListItem,
  convertParagraph,
  convertTable,
  convertToc,
  convertVideoEmbed,
  type PmToMdastContext,
  type PmToMdastNode,
} from "./pmBlockConverters";
import { convertFootnoteDefinition } from "./pmFootnoteConverters";

export type PmToMdastResult = PmToMdastNode | PmToMdastNode[] | null;

/** The Tier-1 registry type, fixed to the pipeline's node/context/result types. */
export type PmTier1Registry = PmConverterRegistry<
  PMNode,
  PmToMdastContext,
  PmToMdastResult
>;

/**
 * Node types migrated in Tier 1.
 *
 * Exported so the differential test can iterate exactly this set, and so a node
 * added here without a differential case fails loudly.
 */
export const TIER_1_NODE_NAMES = [
  "horizontalRule",
  "frontmatter",
  "link_definition",
  "html_block",
  "toc",
  "hardBreak",
  "image",
  "math_inline",
  "footnote_reference",
] as const;

/**
 * Structural node types, migrated alongside Tier 1.
 *
 * These take the shared conversion context (for child/inline recursion) but are
 * otherwise self-contained in this direction. Crucially, **PM → mdast has no
 * ambiguity**: the ProseMirror node type is definitive, so none of these needs
 * the claim protocol. The claiming problem the plan describes — media, alerts,
 * embeds competing for one mdast type — exists only in the mdast → PM
 * direction, which registry 1 owns.
 *
 * `codeBlock` is included: it decodes the `MATH_BLOCK_LANGUAGE` sentinel inside
 * `convertCodeBlock` (pmBlockConverters.ts:82), so in this direction it is
 * self-contained too.
 */
export const STRUCTURAL_NODE_NAMES = [
  "paragraph",
  "heading",
  "codeBlock",
  "blockquote",
  "alertBlock",
  "detailsBlock",
  "bulletList",
  "orderedList",
  "listItem",
  "table",
  "block_image",
  "block_video",
  "block_audio",
  "video_embed",
  "footnote_definition",
] as const;

/** Build the Tier-1 registry. Fresh instance per call; no module-level state. */
export function createTier1Registry(): PmTier1Registry {
  const registry: PmTier1Registry = new PmConverterRegistry();

  registry.registerAll([
    {
      extensionId: "vmark.horizontalRule",
      nodeName: "horizontalRule",
      convert: () => convertHorizontalRule(),
    },
    {
      extensionId: "vmark.markdownArtifacts.frontmatter",
      nodeName: "frontmatter",
      convert: (node) => convertFrontmatter(node),
    },
    {
      extensionId: "vmark.markdownArtifacts.linkDefinition",
      nodeName: "link_definition",
      convert: (node) => convertDefinition(node),
    },
    {
      extensionId: "vmark.markdownArtifacts.htmlBlock",
      nodeName: "html_block",
      convert: (node) => convertHtmlBlock(node),
    },
    {
      extensionId: "vmark.tableOfContents",
      nodeName: "toc",
      convert: () => convertToc(),
    },
    {
      extensionId: "vmark.hardBreak",
      nodeName: "hardBreak",
      convert: () => inlineConverters.convertHardBreak(),
    },
    {
      extensionId: "vmark.imageView",
      nodeName: "image",
      convert: (node) => inlineConverters.convertImage(node),
    },
    {
      extensionId: "vmark.latex.mathInline",
      nodeName: "math_inline",
      convert: (node) => inlineConverters.convertMathInline(node),
    },
    {
      extensionId: "vmark.footnotePopup.reference",
      nodeName: "footnote_reference",
      convert: (node) => inlineConverters.convertFootnoteReference(node),
    },

    // ---- structural ----
    {
      extensionId: "vmark.paragraph",
      nodeName: "paragraph",
      convert: (node, ctx) => convertParagraph(ctx, node),
    },
    {
      extensionId: "vmark.heading",
      nodeName: "heading",
      convert: (node, ctx) => convertHeading(ctx, node),
    },
    {
      extensionId: "vmark.codeBlock",
      nodeName: "codeBlock",
      convert: (node) => convertCodeBlock(node),
    },
    {
      extensionId: "vmark.blockquote",
      nodeName: "blockquote",
      convert: (node, ctx) => convertBlockquote(ctx, node),
    },
    {
      extensionId: "vmark.alertBlock",
      nodeName: "alertBlock",
      convert: (node, ctx) => convertAlertBlock(ctx, node),
    },
    {
      extensionId: "vmark.detailsBlock",
      nodeName: "detailsBlock",
      convert: (node, ctx) => convertDetailsBlock(ctx, node),
    },
    {
      extensionId: "vmark.bulletList",
      nodeName: "bulletList",
      convert: (node, ctx) => convertList(ctx, node, false),
    },
    {
      extensionId: "vmark.orderedList",
      nodeName: "orderedList",
      convert: (node, ctx) => convertList(ctx, node, true),
    },
    {
      extensionId: "vmark.listItem",
      nodeName: "listItem",
      convert: (node, ctx) => convertListItem(ctx, node),
    },
    {
      extensionId: "vmark.tableUI",
      nodeName: "table",
      convert: (node, ctx) => convertTable(ctx, node),
    },
    {
      extensionId: "vmark.blockImage",
      nodeName: "block_image",
      convert: (node) => convertBlockImage(node),
    },
    {
      extensionId: "vmark.blockVideo",
      nodeName: "block_video",
      convert: (node) => convertBlockVideo(node),
    },
    {
      extensionId: "vmark.blockAudio",
      nodeName: "block_audio",
      convert: (node) => convertBlockAudio(node),
    },
    {
      extensionId: "vmark.videoEmbed",
      nodeName: "video_embed",
      convert: (node) => convertVideoEmbed(node),
    },
    {
      extensionId: "vmark.footnotePopup.definition",
      nodeName: "footnote_definition",
      convert: (node, ctx) => convertFootnoteDefinition(ctx, node),
    },
  ]);

  return registry;
}

/**
 * Consult registry 2 for one node.
 *
 * Returns `{ handled: false }` when the type has not been migrated yet, so the
 * caller falls through to its remaining switch. An ambiguous match is reported
 * and treated as handled-with-nothing: ordering must not break the tie.
 */
export function tryRegistry(
  registry: PmTier1Registry,
  typeName: string,
  node: PMNode,
  context: PmToMdastContext,
): { handled: true; result: PmToMdastResult } | { handled: false } {
  const lookup = registry.resolve(typeName, node);
  if (lookup.ok) {
    return { handled: true, result: lookup.converter.convert(node, context) };
  }
  if (lookup.failure.code === "ambiguous-match") {
    mdPipelineWarn(`[PMToMdast] ${lookup.failure.message}`);
    return { handled: true, result: null };
  }
  return { handled: false };
}
