/**
 * VMark-specific remark plugins: math validation and setext-heading disable.
 *
 * @module utils/markdownPipeline/parser/remarkPlugins
 */

import type { Plugin } from "unified";
import type { Root, Parent } from "mdast";
import type { InlineMath } from "mdast-util-math";

/**
 * Plugin to validate inline math and convert invalid ones back to text.
 * Invalid inline math: content with leading or trailing whitespace.
 * This prevents `$100 and $200` from being parsed as math.
 */
export const remarkValidateMath: Plugin<[], Root> = function () {
  return (tree: Root) => {
    visitAndFixMath(tree);
  };
};

function visitAndFixMath(node: Root | Parent): void {
  /* v8 ignore next -- @preserve defensive guard: always called with Root or Parent nodes; protects against leaf nodes passed in future refactors */
  if (!("children" in node) || !Array.isArray(node.children)) return;

  // Type-safe children array using unknown to avoid strict type conflicts
  const newChildren: unknown[] = [];
  let modified = false;

  for (const child of node.children) {
    if (child.type === "inlineMath") {
      const mathNode = child as InlineMath;
      /* v8 ignore next -- @preserve remark-math always sets value to a string; the || "" fallback guards against hypothetical undefined from future parser versions */
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
 * Disable setext heading parsing (underline-style headings with `---` or `===`).
 *
 * VMark always serializes headings as ATX (`#`), never setext. Disabling setext
 * parsing prevents a common misparse: an empty nested list item (`  -`) being
 * interpreted as a setext heading underline for the preceding paragraph.
 *
 * This is an intentional compatibility trade-off for VMark:
 * - VMark's serializer never produces setext headings (always ATX `#`)
 * - Setext input (`Heading\n---`) is rare in practice and can always be
 *   written as `## Heading` instead
 * - The misparse of `  -` as heading underline causes data corruption
 */
export const remarkDisableSetextHeadings: Plugin<[], Root> = function () {
  const data = this.data();
  const micromarkExtensions =
    (data.micromarkExtensions as unknown[]) || ((data as Record<string, unknown>).micromarkExtensions = []);
  micromarkExtensions.push({
    disable: { null: ["setextUnderline"] },
  });
};

/** Flags indicating which optional remark plugins are needed. */
export interface ContentAnalysis {
  hasMath: boolean;
  hasFrontmatter: boolean;
  hasWikiLinks: boolean;
  hasDetails: boolean;
}

/**
 * Analyze markdown content to determine which plugins are needed.
 * This enables lazy loading of plugins for better performance.
 */
export function analyzeContent(markdown: string): ContentAnalysis {
  return {
    // Math: look for $ or $$ (quick heuristic)
    hasMath: markdown.includes("$"),
    // Frontmatter: must start with ---
    hasFrontmatter: markdown.startsWith("---"),
    // Wiki links: look for [[
    hasWikiLinks: markdown.includes("[["),
    // Details block: look for <details pattern
    hasDetails: markdown.includes("<details"),
  };
}
