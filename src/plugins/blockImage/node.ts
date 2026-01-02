/**
 * Block Image Node Schema
 *
 * A block-level image node that renders as a standalone element.
 * Used for images that appear on their own line (not inline with text).
 */

import { $nodeSchema } from "@milkdown/kit/utils";

export const blockImageId = "block_image";

/**
 * Schema for block image node.
 * Similar to inline image but rendered as a block element.
 */
export const blockImageSchema = $nodeSchema(blockImageId, () => ({
  group: "block",
  atom: true,
  isolating: true,
  selectable: true,
  draggable: true,
  marks: "",
  defining: true,
  attrs: {
    src: { default: "" },
    alt: { default: "" },
    title: { default: "" },
  },
  parseDOM: [
    {
      tag: `figure[data-type="${blockImageId}"]`,
      getAttrs: (dom) => {
        const img = (dom as HTMLElement).querySelector("img");
        return {
          src: img?.getAttribute("src") ?? "",
          alt: img?.getAttribute("alt") ?? "",
          title: img?.getAttribute("title") ?? "",
        };
      },
    },
  ],
  toDOM: (node) => {
    return [
      "figure",
      {
        "data-type": blockImageId,
        class: "block-image",
      },
      [
        "img",
        {
          src: node.attrs.src,
          alt: node.attrs.alt,
          title: node.attrs.title,
        },
      ],
    ] as const;
  },
  parseMarkdown: {
    match: (node) => node.type === "blockImage",
    runner: (state, node, type) => {
      state.addNode(type, {
        src: (node.url as string) ?? "",
        alt: (node.alt as string) ?? "",
        title: (node.title as string) ?? "",
      });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === blockImageId,
    runner: (state, node) => {
      // Output as a standard image node - remark will handle paragraph wrapping
      state.addNode("image", undefined, undefined, {
        url: node.attrs.src,
        alt: node.attrs.alt,
        title: node.attrs.title,
      });
    },
  },
}));
