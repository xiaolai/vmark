/**
 * HTML Block Node Extension
 *
 * Purpose: Represents raw HTML blocks (e.g. `<div>`, `<details>`) as atom nodes in WYSIWYG.
 * The raw HTML is stored in `value` and rendered via a custom NodeView that respects
 * the user's HTML rendering mode setting (hidden / sanitized / sanitized with styles).
 *
 * @coordinates-with HtmlNodeView.ts — provides the NodeView that renders/sanitizes HTML
 * @coordinates-with shared/sourceLineAttr.ts — source-line tracking for cursor sync
 * @module plugins/markdownArtifacts/htmlBlock
 */
/**
 * HTML Block Node Extension
 *
 * Purpose: Represents raw HTML blocks (e.g., `<div>...</div>`) as atom nodes in WYSIWYG mode.
 * Rendered via HtmlNodeView which supports three modes: hidden, sanitized, sanitized-with-styles.
 * Double-clicking switches to Source mode for editing.
 *
 * @coordinates-with HtmlNodeView.ts — provides the visual rendering based on settings
 * @module plugins/markdownArtifacts/htmlBlock
 */
import { Node, mergeAttributes } from "@tiptap/core";
import type { NodeView } from "@tiptap/pm/view";
import { createHtmlBlockNodeView } from "./HtmlNodeView";
import { sourceLineAttr } from "../shared/sourceLineAttr";

export const htmlBlockExtension = Node.create({
  name: "html_block",
  group: "block",
  atom: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      ...sourceLineAttr,
      value: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="html-block"]',
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const dataValue = el.getAttribute("data-value");
          // Fallback: use textContent if data-value is missing (e.g., after sanitization)
          if (dataValue !== null) {
            return { value: dataValue };
          }
          const text = el.textContent ?? "";
          return text ? { value: text } : false;
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const value = String(node.attrs.value ?? "");
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "html-block",
        "data-value": value,
        contenteditable: "false",
      }),
      value,
    ];
  },

  addNodeView() {
    return ({ node }) => createHtmlBlockNodeView(node) as NodeView;
  },
});
