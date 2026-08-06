import { Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { MathInlineNodeView } from "./MathInlineNodeView";
import {
  createInlineMathEditingRegistry,
  type InlineMathEditingRegistry,
} from "./inlineMathEditingRegistry";
import "./latex.css";

export interface MathInlineOptions {
  /**
   * Which node is open for editing.
   *
   * Defaults to the plugin's own registry, which is fully functional — the
   * host passes its own only so the popup layer sees the same state.
   */
  editingRegistry: InlineMathEditingRegistry;
}

/**
 * Inline math extension for Tiptap.
 *
 * Uses an atom approach: math content is stored as an attribute,
 * and the node displays rendered KaTeX output.
 * Supports inline editing with floating preview.
 */
export const mathInlineExtension = Node.create<MathInlineOptions>({
  name: "math_inline",

  addOptions() {
    return { editingRegistry: createInlineMathEditingRegistry() };
  },

  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      content: {
        default: "",
        parseHTML: (element) => element.textContent || "",
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="math_inline"]' }];
  },

  renderHTML({ node }) {
    return ["span", { "data-type": "math_inline", class: "math-inline" }, node.attrs.content];
  },

  addNodeView() {
    /* v8 ignore start -- @preserve reason: addNodeView factory callback only runs in live Tiptap editor; not exercised in unit tests */
    const { editingRegistry } = this.options;
    return ({ node, view, getPos }) =>
      new MathInlineNodeView(node as PMNode, view, getPos, editingRegistry);
    /* v8 ignore stop */
  },
});
