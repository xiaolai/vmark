/**
 * HTML Inline Node Extension
 *
 * Purpose: Represents inline raw HTML (e.g., `<abbr>`, `<kbd>`) as atom nodes in WYSIWYG mode.
 * Same rendering modes as htmlBlock but displayed inline. Shares the BaseHtmlNodeView renderer.
 *
 * @coordinates-with HtmlNodeView.ts — shared rendering logic for both block and inline HTML
 * @module plugins/markdownArtifacts/htmlInline
 */
import { Node, mergeAttributes } from "@tiptap/core";
import type { NodeView } from "@tiptap/pm/view";
import { createHtmlInlineNodeView } from "./HtmlNodeView";
import { sourceLineAttr } from "../shared/sourceLineAttr";

export const htmlInlineExtension = Node.create({
  name: "html_inline",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      ...sourceLineAttr,
      value: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="html"]',
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
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "html",
        "data-value": value,
        contenteditable: "false",
      }),
      value,
    ];
  },

  addNodeView() {
    return ({ node }) => createHtmlInlineNodeView(node) as NodeView;
  },
});
