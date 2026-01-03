/**
 * Remark Plugin for Highlight
 *
 * Parses ==highlight== syntax in markdown.
 * Also handles HTML <mark> tags.
 */

import { $remark } from "@milkdown/kit/utils";
import { findAndReplace, type Find, type Replace } from "mdast-util-find-and-replace";
import { visit } from "unist-util-visit";
import type { Root, Parent, PhrasingContent } from "mdast";

// Regex pattern for markdown syntax
// Highlight: ==text== (requires at least one non-space character)
const HIGHLIGHT_REGEX = /(?<![=\\])==([^=\s][^=]*[^=\s]|[^=\s])==(?!=)/g;

/**
 * Custom mdast node type for highlight
 */
interface HighlightNode {
  type: "highlight";
  data: { hName: "mark" };
  children: Array<{ type: "text"; value: string }>;
}

/**
 * Creates a highlight node from matched text
 */
function createHighlightNode(_: string, text: string): HighlightNode {
  return {
    type: "highlight",
    data: { hName: "mark" },
    children: [{ type: "text", value: text }],
  };
}

/**
 * Check if a node is an HTML node with specific tag
 */
function isHtmlTag(node: PhrasingContent | undefined, tag: string): boolean {
  if (!node || node.type !== "html") return false;
  const value = (node as { value: string }).value.toLowerCase().trim();
  return value === tag;
}

/**
 * Check if a node is a text node and get its value
 */
function getTextValue(node: PhrasingContent | undefined): string | null {
  if (!node || node.type !== "text") return null;
  return (node as { value: string }).value;
}

/**
 * Process inline HTML tags like <mark>text</mark>
 * These appear as separate sibling nodes: html("<mark>") + text + html("</mark>")
 */
function processInlineHtmlTags(tree: Root) {
  visit(tree, "paragraph", (node: Parent) => {
    const children = node.children as PhrasingContent[];
    const newChildren: PhrasingContent[] = [];
    let i = 0;

    while (i < children.length) {
      const current = children[i];
      const next = children[i + 1];
      const afterNext = children[i + 2];

      // Check for <mark>text</mark> pattern
      if (isHtmlTag(current, "<mark>") && next && isHtmlTag(afterNext, "</mark>")) {
        const text = getTextValue(next);
        if (text !== null) {
          newChildren.push(createHighlightNode("", text) as unknown as PhrasingContent);
          i += 3;
          continue;
        }
      }

      // Keep the node as-is
      newChildren.push(current);
      i++;
    }

    // Replace children if we made changes
    if (newChildren.length !== children.length) {
      node.children = newChildren;
    }
  });
}

/**
 * Remark plugin that transforms ==text== to highlight
 * Also handles HTML <mark> tags
 */
function remarkHighlight() {
  return (tree: Root) => {
    // Handle markdown syntax (==text==) via text replacement
    findAndReplace(tree, [
      [HIGHLIGHT_REGEX as unknown as Find, createHighlightNode as unknown as Replace],
    ]);

    // Handle HTML tags (<mark>) by finding sibling patterns
    processInlineHtmlTags(tree);
  };
}

/**
 * Milkdown remark plugin wrapper
 */
export const remarkHighlightPlugin = $remark(
  "remarkHighlight",
  () => remarkHighlight
);
