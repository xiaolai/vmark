/**
 * Details Block Node Definitions
 *
 * ProseMirror node schemas for GitHub-style collapsible blocks.
 * Two nodes: detailsBlock (container) and detailsSummary (header)
 */

import { $nodeSchema } from "@milkdown/kit/utils";

/**
 * Details summary node schema (the clickable header)
 */
export const detailsSummarySchema = $nodeSchema("detailsSummary", () => ({
  content: "inline*",
  defining: true,
  selectable: false,

  parseDOM: [
    {
      tag: "summary",
    },
  ],

  toDOM: () => ["summary", { class: "details-summary" }, 0],

  parseMarkdown: {
    match: () => false, // Handled by parent detailsBlock
    runner: () => {
      // Not called directly
    },
  },

  toMarkdown: {
    match: (node) => node.type.name === "detailsSummary",
    runner: (state, node) => {
      // Serialize inline content
      state.next(node.content);
    },
  },
}));

/**
 * Details block node schema (the container)
 */
export const detailsBlockSchema = $nodeSchema("detailsBlock", (ctx) => ({
  group: "block",
  content: "detailsSummary block+",
  defining: true,
  attrs: {
    open: { default: false },
  },

  parseDOM: [
    {
      tag: "details",
      getAttrs: (dom) => {
        const el = dom as HTMLElement;
        return { open: el.hasAttribute("open") };
      },
    },
  ],

  toDOM: (node) => {
    const attrs: Record<string, string> = { class: "details-block" };
    if (node.attrs.open) {
      attrs.open = "open";
    }
    return ["details", attrs, 0];
  },

  parseMarkdown: {
    match: (node) => node.type === "detailsBlock",
    runner: (state, node, type) => {
      const detailsNode = node as unknown as {
        detailsOpen: boolean;
        detailsSummary: string;
        detailsContent: string;
      };

      // Open detailsBlock
      state.openNode(type, { open: detailsNode.detailsOpen });

      // Add summary node using schema's node type
      const summaryType = detailsSummarySchema.type(ctx);
      const summaryText = detailsNode.detailsSummary || "Details";
      const textNode = state.schema.text(summaryText);
      state.addNode(summaryType, undefined, [textNode]);

      // Add content as paragraph (always required by schema: detailsSummary block+)
      const paragraphType = state.schema.nodes.paragraph;
      if (paragraphType) {
        const content = detailsNode.detailsContent?.trim() || "";
        if (content) {
          const contentText = state.schema.text(content);
          state.addNode(paragraphType, undefined, [contentText]);
        } else {
          // Empty paragraph
          state.addNode(paragraphType);
        }
      }

      state.closeNode();
    },
  },

  toMarkdown: {
    match: (node) => node.type.name === "detailsBlock",
    runner: (state, node) => {
      const isOpen = node.attrs.open as boolean;

      // Get summary text
      let summaryText = "Details";
      const summaryNode = node.firstChild;
      if (summaryNode?.type.name === "detailsSummary") {
        summaryText = summaryNode.textContent || "Details";
      }

      // Collect content text from all non-summary children
      const contentParts: string[] = [];
      let first = true;
      node.forEach((child) => {
        if (first) {
          first = false;
          return; // Skip summary
        }
        const text = child.textContent.trim();
        if (text) {
          contentParts.push(text);
        }
      });

      // Build HTML - keep on single lines to avoid remark splitting
      const openAttr = isOpen ? " open" : "";
      const contentText = contentParts.join(" ");
      const contentLine = contentText ? `\n${contentText}` : "";
      const html = `<details${openAttr}><summary>${summaryText}</summary>${contentLine}</details>`;

      state.addNode("html", undefined, html);
    },
  },
}));
