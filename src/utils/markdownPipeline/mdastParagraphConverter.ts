/**
 * MDAST Paragraph Converter
 *
 * Purpose: Converts paragraph MDAST nodes to ProseMirror nodes. Paragraph
 * ownership is decided by the claim protocol (ADR-015 D2b), not by
 * `if`-order: see mdastParagraphClaims.ts. Strengths encode why each claim
 * is made, so reordering recognizers cannot change which converter wins.
 * Split from mdastMediaConverters.ts for size; the media promoters live
 * there.
 *
 * @coordinates-with mdastMediaConverters.ts — media promotion primitives
 * @coordinates-with mdastParagraphClaims.ts — the claim recognizers
 * @coordinates-with mdastBlockConverters.ts — re-export hub for all block converters
 * @module utils/markdownPipeline/mdastParagraphConverter
 */

import type { Node as PMNode, Mark } from "@tiptap/pm/model";
import type { Content, Image, Html, Paragraph } from "mdast";
import * as inlineConverters from "./mdastInlineConverters";
import { getSourceLine, type MdastToPmContext } from "./mdastConverterHelpers";
import { resolveClaim } from "@/lib/extensions/claim";
import { mdPipelineWarn } from "@/utils/debug";
import {
  PARAGRAPH_RECOGNIZERS,
  type ParagraphClaimInput,
} from "./mdastParagraphClaims";
import { promoteImageToMediaNode, tryPromoteMediaHtml } from "./mdastMediaConverters";

/** The paragraph's only child when it is an image or html node, else null. */
function soleMediaChild(node: Paragraph): Image | Html | null {
  if (node.children.length !== 1) return null;
  const child = node.children[0] as Image | Html | undefined;
  return child?.type === "image" || child?.type === "html" ? child : null;
}

/** block_image built from the (sanitizing) inline image converter. */
function buildBlockImage(
  context: MdastToPmContext,
  image: Image,
  sourceLine: number | null
): PMNode | null {
  const blockImageType = context.schema.nodes.block_image;
  if (!blockImageType) return null;
  const imageNode = inlineConverters.convertImage(context.schema, image);
  if (!imageNode) return null;
  return blockImageType.create({
    /* v8 ignore next -- @preserve reason: convertImage always returns a node with a string src (isSafeUrl returns a string); the ?? "" fallback is unreachable */
    src: imageNode.attrs.src ?? "",
    alt: imageNode.attrs.alt ?? "",
    title: imageNode.attrs.title ?? "",
    sourceLine,
  });
}

export function convertParagraph(
  context: MdastToPmContext,
  node: Paragraph,
  marks: Mark[]
): PMNode | null {
  const type = context.schema.nodes.paragraph;
  if (!type) return null;
  const sourceLine = getSourceLine(node);
  const onlyChild = soleMediaChild(node);

  const input: ParagraphClaimInput = {
    node,
    onlyChild,
    promoteMedia: () => {
      const img = onlyChild as Image;
      return promoteImageToMediaNode(
        context,
        img.url ?? "",
        img.alt ?? "",
        img.title ?? "",
        sourceLine
      );
    },
    promoteHtml: () => tryPromoteMediaHtml(context, (onlyChild as Html).value ?? "", sourceLine),
    buildBlockImage: () => buildBlockImage(context, onlyChild as Image, sourceLine),
    buildParagraph: () =>
      type.create(
        { sourceLine },
        context.convertChildren(node.children as Content[], marks, "inline")
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
