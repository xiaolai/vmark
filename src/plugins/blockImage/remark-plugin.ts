/**
 * Remark Plugin for Block Images
 *
 * Transforms standalone images (image alone in a paragraph) into block images.
 * Images mixed with other content remain as inline images.
 */

import { $remark } from "@milkdown/kit/utils";
import { visit } from "unist-util-visit";
import type { Root, Paragraph, Image } from "mdast";

/**
 * Check if a paragraph contains only a single image.
 * This is the heuristic for determining block vs inline images.
 */
function isStandaloneImage(node: Paragraph): Image | null {
  // Must have exactly one child
  if (node.children.length !== 1) {
    return null;
  }

  const child = node.children[0];

  // Child must be an image
  if (child.type !== "image") {
    return null;
  }

  return child as Image;
}

/**
 * Custom MDAST node type for block images.
 * This will be matched by the blockImageSchema.parseMarkdown.
 */
interface BlockImageNode {
  type: "blockImage";
  url: string;
  alt: string;
  title: string | null;
}

/**
 * Remark plugin to transform standalone images into block images.
 */
function remarkBlockImages() {
  return (tree: Root) => {
    visit(tree, "paragraph", (node: Paragraph, index, parent) => {
      if (index === undefined || !parent) return;

      const image = isStandaloneImage(node);
      if (!image) return;

      // Replace the paragraph with a blockImage node
      const blockImage: BlockImageNode = {
        type: "blockImage",
        url: image.url,
        alt: image.alt ?? "",
        title: image.title ?? null,
      };

      // Replace in place
      (parent.children as unknown[])[index] = blockImage;
    });
  };
}

/**
 * Milkdown remark plugin wrapper.
 * Must be registered BEFORE commonmark to intercept image parsing.
 */
export const remarkBlockImagePlugin = $remark("blockImage", () => remarkBlockImages);
