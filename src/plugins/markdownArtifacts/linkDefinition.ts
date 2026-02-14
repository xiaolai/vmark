/**
 * Link Definition Node Extension
 *
 * Purpose: Represents markdown reference-style link definitions (`[id]: url "title"`)
 * as invisible atom nodes. These are preserved in the ProseMirror document so they
 * round-trip correctly through the markdown pipeline, but are not rendered visually.
 *
 * @coordinates-with markdownPipeline/plugins/resolveReferences.ts — resolves link references against these nodes
 * @module plugins/markdownArtifacts/linkDefinition
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { sourceLineAttr } from "../shared/sourceLineAttr";

export const linkDefinitionExtension = Node.create({
  name: "link_definition",
  group: "block",
  atom: true,
  selectable: false,
  isolating: true,

  addAttributes() {
    return {
      ...sourceLineAttr,
      identifier: { default: "" },
      label: { default: null },
      url: { default: "" },
      title: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="link-definition"]',
        getAttrs: (element) => ({
          identifier: (element as HTMLElement).getAttribute("data-identifier") ?? "",
          label: (element as HTMLElement).getAttribute("data-label"),
          url: (element as HTMLElement).getAttribute("data-url") ?? "",
          title: (element as HTMLElement).getAttribute("data-title"),
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "link-definition",
        "data-identifier": String(node.attrs.identifier ?? ""),
        "data-label": node.attrs.label ?? null,
        "data-url": String(node.attrs.url ?? ""),
        "data-title": node.attrs.title ?? null,
        contenteditable: "false",
      }),
    ];
  },
});
