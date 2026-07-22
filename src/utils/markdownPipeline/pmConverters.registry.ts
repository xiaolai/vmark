/**
 * Tier-1 PM → mdast converters, expressed as registry entries — Phase 2 WI-2.1.
 *
 * Purpose: the first slice of the serialization inversion. These 10 node types
 * are pure attribute↔field mappings with no cross-node state, so they can move
 * to a contributed table with no behaviour change at all.
 *
 * Method (Codex MAJOR — differential, not big-bang): the registry is built
 * ALONGSIDE the existing `switch` in `proseMirrorToMdast.ts`, and
 * `pmConverters.registry.test.ts` asserts the registry dispatches to the exact
 * same function the switch would, for every node type listed here. The switch
 * stays authoritative until every tier has moved; it is deleted last.
 *
 * `extensionId`s are the ids these converters will carry once the owning plugin
 * declares them (ADR-015 D1). Naming them now keeps the eventual move a
 * relocation rather than a redesign.
 *
 * Not yet here, and deliberately:
 *   - Tier 2 marks — `groupInlineItems` factors mark runs across ALL marks at
 *     once and cannot decompose per mark.
 *   - Tier 3+ — heading (document-scoped slug state), lists (parent/child spread
 *     heuristics), tables (whole-table alignment), and the four families that
 *     need the claim protocol.
 *   - `codeBlock` — it is Tier 1 in shape but ambiguous in practice: the math
 *     sentinel `MATH_BLOCK_LANGUAGE` means the math extension must claim it by
 *     attribute. It moves with the claim wiring, not here.
 *
 * @coordinates-with lib/extensions/pmConverterRegistry.ts — the dispatch table
 * @coordinates-with proseMirrorToMdast.ts — the switch this mirrors
 * @module utils/markdownPipeline/pmConverters.registry
 */
import type { Node as PMNode } from "@tiptap/pm/model";
import { PmConverterRegistry } from "@/lib/extensions/pmConverterRegistry";
import * as inlineConverters from "./pmInlineConverters";
import {
  convertDefinition,
  convertFrontmatter,
  convertHorizontalRule,
  convertHtmlBlock,
  convertToc,
  type PmToMdastContext,
  type PmToMdastNode,
} from "./pmBlockConverters";

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
  ]);

  return registry;
}
