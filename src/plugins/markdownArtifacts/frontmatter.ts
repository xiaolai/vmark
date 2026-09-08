/**
 * Frontmatter Node Extension
 *
 * Purpose: Represents YAML frontmatter blocks as atoms in WYSIWYG mode. The raw
 * YAML text is stored in the `value` attribute and round-tripped through the
 * markdown pipeline; the frontmatterPanel NodeView this extension registers
 * lets the user expand the block and edit that YAML in place, so frontmatter
 * is editable in WYSIWYG as well as in Source mode.
 *
 * Key decisions:
 *   - Atom + non-selectable: prevents accidental deletion while navigating
 *   - Fallback to textContent in parseHTML: handles sanitization stripping data-value
 *
 * @coordinates-with shared/sourceLineAttr.ts — provides source-line tracking for cursor sync
 * @module plugins/markdownArtifacts/frontmatter
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { sourceLineAttr } from "../shared/sourceLineAttr";
import { createFrontmatterNodeView } from "@/plugins/frontmatterPanel/nodeView";

export const frontmatterExtension = Node.create({
  name: "frontmatter",
  group: "block",
  atom: true,
  selectable: false,
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
        tag: 'div[data-type="frontmatter"]',
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const dataValue = el.getAttribute("data-value");
          if (dataValue !== null) {
            return { value: dataValue };
          }
          const text = el.textContent?.trim() ?? "";
          return text ? { value: text } : false;
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "frontmatter",
        "data-value": String(node.attrs.value ?? ""),
        contenteditable: "false",
      }),
    ];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      return createFrontmatterNodeView(node, editor.view, getPos as () => number | undefined);
    };
  },
});
