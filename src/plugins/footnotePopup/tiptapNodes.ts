/**
 * Footnote Node Definitions
 *
 * Purpose: Defines the footnote_reference (inline [^n]) and footnote_definition (block)
 * ProseMirror node types for WYSIWYG mode.
 *
 * Key decisions:
 *   - footnote_reference is inline + atom (no editable content, just a label)
 *   - footnote_definition is a block node containing a paragraph of content
 *   - Both nodes carry a `label` attribute for bidirectional linking
 *
 * @coordinates-with tiptap.ts — uses these nodes for popup interactions
 * @coordinates-with tiptapCleanup.ts — renumbers labels on these nodes
 * @module plugins/footnotePopup/tiptapNodes
 */

import { mergeAttributes, Node } from "@tiptap/core";
import { sourceLineAttr } from "../shared/sourceLineAttr";

export const footnoteReferenceExtension = Node.create({
  name: "footnote_reference",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      ...sourceLineAttr,
      label: {
        default: "1",
        parseHTML: (element) => (element as HTMLElement).getAttribute("data-label") ?? "1",
        renderHTML: (attributes) => ({ "data-label": String(attributes.label ?? "") }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-type="footnote_reference"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = String(node.attrs.label ?? "");
    return [
      "sup",
      mergeAttributes(HTMLAttributes, {
        "data-type": "footnote_reference",
        "data-label": label,
        id: `fnref-${label}`,
        contenteditable: "false",
      }),
      ["a", { href: `#fndef-${label}` }, label],
    ];
  },
});

export const footnoteDefinitionExtension = Node.create({
  name: "footnote_definition",
  group: "block",
  content: "paragraph",
  defining: true,

  addAttributes() {
    return {
      ...sourceLineAttr,
      label: {
        default: "1",
        parseHTML: (element) => (element as HTMLElement).getAttribute("data-label") ?? "1",
        renderHTML: (attributes) => ({ "data-label": String(attributes.label ?? "") }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'dl[data-type="footnote_definition"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = String(node.attrs.label ?? "");
    return [
      "dl",
      mergeAttributes(HTMLAttributes, {
        "data-type": "footnote_definition",
        "data-label": label,
        id: `fndef-${label}`,
      }),
      ["dt", { "data-label": label, contenteditable: "false" }, label],
      ["dd", { "data-label": label }, 0],
    ];
  },
});

