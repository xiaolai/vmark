/**
 * Remark Plugin for GitHub-style Collapsible Blocks
 *
 * Transforms <details>/<summary> HTML blocks into detailsBlock nodes.
 */

import { $remark } from "@milkdown/kit/utils";
import { visit } from "unist-util-visit";
import type { Root, Html } from "mdast";

// Regex patterns for parsing details HTML
const DETAILS_OPEN = /<details(\s+open)?>/i;
const DETAILS_CLOSE = /<\/details>/i;
const SUMMARY_PATTERN = /<summary>([\s\S]*?)<\/summary>/i;

interface DetailsNode {
  type: "detailsBlock";
  open: boolean;
  summary: string;
  content: string;
}

/**
 * Parse a details HTML block into structured data
 */
function parseDetailsHtml(html: string): DetailsNode | null {
  // Check if this is a details block
  if (!DETAILS_OPEN.test(html) || !DETAILS_CLOSE.test(html)) {
    return null;
  }

  // Check if open attribute is present
  const openMatch = html.match(DETAILS_OPEN);
  const isOpen = openMatch?.[1] !== undefined;

  // Extract summary
  const summaryMatch = html.match(SUMMARY_PATTERN);
  const summary = summaryMatch?.[1]?.trim() || "Details";

  // Extract content (everything after </summary> and before </details>)
  let content = html;

  // Remove <details> tag
  content = content.replace(DETAILS_OPEN, "");
  content = content.replace(DETAILS_CLOSE, "");

  // Remove <summary>...</summary>
  content = content.replace(SUMMARY_PATTERN, "");

  // Clean up whitespace
  content = content.trim();

  return {
    type: "detailsBlock",
    open: isOpen,
    summary,
    content,
  };
}

/**
 * Remark plugin to transform <details> HTML blocks
 */
function remarkDetailsBlocks() {
  return (tree: Root) => {
    // Collect replacements to apply after visiting
    const replacements: Array<{
      grandparent: { children: unknown[] };
      parentIndex: number;
      node: unknown;
    }> = [];

    visit(tree, "html", (node: Html, index, parent, ancestors) => {
      if (index === undefined || !parent) return;

      const parsed = parseDetailsHtml(node.value);
      if (!parsed) return;

      const detailsNode = {
        type: "detailsBlock",
        detailsOpen: parsed.open,
        detailsSummary: parsed.summary,
        detailsContent: parsed.content || " ",
      };

      const parentNode = parent as { type: string; children: unknown[] };

      if (parentNode.type === "root") {
        // Direct child of root - replace in place
        parentNode.children[index] = detailsNode;
      } else if (parentNode.type === "paragraph") {
        // HTML is inside a paragraph - need to replace the paragraph itself
        // Find the grandparent (should be root)
        const grandparent = tree as { children: unknown[] };
        const parentIndex = grandparent.children.indexOf(parent);
        if (parentIndex !== -1) {
          replacements.push({ grandparent, parentIndex, node: detailsNode });
        }
      }
    });

    // Apply paragraph replacements (replace paragraph with detailsBlock)
    for (const { grandparent, parentIndex, node } of replacements) {
      grandparent.children[parentIndex] = node;
    }
  };
}

/**
 * Milkdown remark plugin wrapper
 */
export const remarkDetailsPlugin = $remark("detailsBlock", () => remarkDetailsBlocks);
