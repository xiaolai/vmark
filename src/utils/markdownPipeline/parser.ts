/**
 * Markdown parser using remark
 *
 * Parses markdown text into MDAST (Markdown Abstract Syntax Tree).
 * Uses unified with remark-parse, remark-gfm, remark-math, and remark-frontmatter.
 *
 * @module utils/markdownPipeline/parser
 */

import { unified, type Plugin } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkBreaks from "remark-breaks";
import type { Root, Parent } from "mdast";
import type { InlineMath } from "mdast-util-math";
import { remarkCustomInline, remarkDetailsBlock, remarkWikiLinks } from "./plugins";
import type { MarkdownPipelineOptions } from "./types";

/**
 * Plugin to validate inline math and convert invalid ones back to text.
 * Invalid inline math: content with leading or trailing whitespace.
 * This prevents `$100 and $200` from being parsed as math.
 */
const remarkValidateMath: Plugin<[], Root> = function () {
  return (tree: Root) => {
    visitAndFixMath(tree);
  };
};

function visitAndFixMath(node: Root | Parent): void {
  if (!("children" in node) || !Array.isArray(node.children)) return;

  // Type-safe children array using unknown to avoid strict type conflicts
  const newChildren: unknown[] = [];
  let modified = false;

  for (const child of node.children) {
    if (child.type === "inlineMath") {
      const mathNode = child as InlineMath;
      const value = mathNode.value || "";
      // Reject math with leading/trailing whitespace
      if (/^\s/.test(value) || /\s$/.test(value)) {
        // Convert back to text with dollar delimiters
        newChildren.push({
          type: "text",
          value: `$${value}$`,
        });
        modified = true;
        continue;
      }
    }

    // Recurse into children
    if ("children" in child && Array.isArray((child as Parent).children)) {
      visitAndFixMath(child as Parent);
    }
    newChildren.push(child);
  }

  if (modified) {
    // Use type assertion to assign the modified children array
    (node as { children: unknown[] }).children = newChildren;
  }
}

/**
 * Unified processor configured for VMark markdown parsing.
 *
 * Plugins:
 * - remark-parse: Base CommonMark parser
 * - remark-gfm: GitHub Flavored Markdown (tables, task lists, strikethrough, autolinks)
 * - remark-math: Inline ($...$) and block ($$...$$) math
 * - remark-frontmatter: YAML frontmatter (---)
 *
 * Custom inline syntax (==highlight==, ~sub~, ^sup^, ++underline++)
 * is handled via remarkCustomInline plugin.
 */
function createProcessor(options: MarkdownPipelineOptions = {}) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm, {
      // Disable single tilde strikethrough to avoid conflict with subscript
      // GFM strikethrough uses ~~double tilde~~
      singleTilde: false,
    })
    .use(remarkMath)
    .use(remarkValidateMath) // Reject invalid inline math (with leading/trailing spaces)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkWikiLinks)
    .use(remarkDetailsBlock)
    .use(remarkCustomInline);

  if (options.preserveLineBreaks) {
    processor.use(remarkBreaks);
  }

  return processor;
}

/**
 * Parse markdown text into MDAST.
 *
 * @param markdown - The markdown text to parse
 * @returns The root MDAST node
 *
 * @example
 * const mdast = parseMarkdownToMdast("# Hello\n\nWorld");
 * // mdast.type === "root"
 * // mdast.children[0].type === "heading"
 * // mdast.children[1].type === "paragraph"
 */
export function parseMarkdownToMdast(
  markdown: string,
  options: MarkdownPipelineOptions = {}
): Root {
  const processor = createProcessor(options);
  const result = processor.parse(markdown);
  // Run transforms (plugins that modify the tree)
  const transformed = processor.runSync(result);
  return transformed as Root;
}
