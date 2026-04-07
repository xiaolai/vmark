/**
 * Table of Contents — Remark Plugin
 *
 * Purpose: Converts `[TOC]` paragraphs in markdown to structured MDAST `toc` nodes
 * and serializes them back to `[TOC]` text.
 *
 * Detection: A paragraph containing only `[TOC]` (case-insensitive, optional whitespace)
 * is converted to a `toc` node. The `[TOC]` must be the sole content of a paragraph —
 * inline `[TOC]` within other text is not converted.
 *
 * @coordinates-with mdastBlockConverters.ts — convertToc creates PM nodes from Toc MDAST
 * @coordinates-with pmBlockConverters.ts — convertToc creates Toc MDAST from PM
 * @module utils/markdownPipeline/plugins/tocBlock
 */

import type { Root, Paragraph, Text } from "mdast";
import type { Plugin } from "unified";
import { visit, SKIP } from "unist-util-visit";
import type { Toc } from "../types";

/** Match a paragraph whose sole text content is `[TOC]` (case-insensitive). */
const TOC_RE = /^\s*\[toc\]\s*$/i;

/**
 * Remark plugin that converts `[TOC]` paragraphs to `toc` MDAST nodes.
 */
export const remarkTocBlock: Plugin<[], Root> = function () {
  // --- fromMarkdown: paragraph → toc node ---
  return (tree: Root) => {
    visit(tree, "paragraph", (node: Paragraph, index, parent) => {
      if (index === undefined || parent === undefined) return;

      // Must be a single text child
      if (node.children.length !== 1) return;
      const child = node.children[0];
      if (child.type !== "text") return;
      if (!TOC_RE.test((child as Text).value)) return;

      // Replace the paragraph with a toc node
      const tocNode: Toc = {
        type: "toc",
        position: node.position,
      };

      parent.children[index] = tocNode as unknown as typeof parent.children[number];
      return SKIP;
    });
  };
};

/**
 * Remark-stringify extension for serializing `toc` nodes back to `[TOC]`.
 */
export const tocToMarkdown = {
  handlers: {
    toc: (): string => "[TOC]",
  },
};
