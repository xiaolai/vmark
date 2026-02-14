/**
 * Wiki Link Node Extension
 *
 * Purpose: Inline node for wiki-style links ([[target]] or [[target|alias]]).
 * Unlike atom nodes, the display text is a content hole that users can edit
 * directly in the editor. The target path is stored in the `value` attribute
 * and edited via the wiki link popup.
 *
 * @coordinates-with wikiLinkPopup/tiptap.ts — popup for editing the target path
 * @coordinates-with sourceWikiLinkPopup — equivalent popup for Source mode
 * @module plugins/markdownArtifacts/wikiLink
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { sourceLineAttr } from "../shared/sourceLineAttr";
export const wikiLinkExtension = Node.create({
  name: "wikiLink",
  inline: true,
  group: "inline",
  content: "text*",
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
        tag: 'span[data-type="wiki-link"]',
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const dataValue = el.getAttribute("data-value");
          if (dataValue) {
            return { value: dataValue };
          }
          // Fallback: use textContent as value if data-value missing
          const text = el.textContent?.trim() ?? "";
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
        "data-type": "wiki-link",
        "data-value": value,
        class: "wiki-link",
      }),
      0, // Content hole - text content goes here
    ];
  },
});
