/**
 * Table of Contents — Tiptap Extension
 *
 * Purpose: Defines the `toc` node type for ProseMirror/Tiptap. In WYSIWYG mode,
 * a NodeView renders a live clickable heading list that updates as the document
 * changes. The NodeView also runs in export mode (ExportSurface uses a real
 * Tiptap editor with editable:false).
 *
 * The node is an atom (no editable content) — users interact by clicking headings
 * to scroll, or by selecting/deleting the node as a whole. The static renderHTML
 * includes aria-label for accessibility.
 *
 * @coordinates-with TocNodeView.ts — provides the interactive NodeView
 * @coordinates-with headingSlug.ts — extracts headings with stable IDs
 * @module plugins/tableOfContents/tiptap
 */

import { Node, mergeAttributes } from "@tiptap/core";
import type { NodeView } from "@tiptap/pm/view";
import { sourceLineAttr } from "../shared/sourceLineAttr";
import { createTocNodeView } from "./TocNodeView";

import "./toc-block.css";

export const tocExtension = Node.create({
  name: "toc",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      ...sourceLineAttr,
    };
  },

  parseHTML() {
    return [
      { tag: 'nav[data-type="toc"]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // Static fallback for copy/paste and initial render before NodeView mounts.
    // The NodeView overrides this with a live heading list.
    return [
      "nav",
      mergeAttributes(HTMLAttributes, {
        "data-type": "toc",
        "aria-label": "Table of Contents",
        class: "toc-block",
        contenteditable: "false",
      }),
      ["ul", { class: "toc-list" }],
    ];
  },

  addNodeView() {
    /* v8 ignore start -- @preserve reason: addNodeView factory runs only in live Tiptap editor */
    return ({ node, view, getPos }): NodeView =>
      createTocNodeView(node, view, getPos as () => number);
    /* v8 ignore stop */
  },
});
