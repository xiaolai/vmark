/**
 * Frontmatter Node Extension
 *
 * Purpose: Represents YAML frontmatter blocks as non-editable atoms in WYSIWYG mode.
 * The raw YAML is stored in the `value` attribute and hidden from visual editing —
 * users edit frontmatter in Source mode instead.
 *
 * Key decisions:
 *   - Atom + non-selectable: prevents accidental deletion while navigating
 *   - Fallback to textContent in parseHTML: handles sanitization stripping data-value
 *
 * @coordinates-with shared/sourceLineAttr.ts — provides source-line tracking for cursor sync
 * @module plugins/markdownArtifacts/frontmatter
 */
/**
 * Frontmatter Node Extension
 *
 * Purpose: Represents YAML frontmatter blocks as non-editable atoms in WYSIWYG mode.
 * The raw YAML text is stored in the `value` attribute and round-tripped through
 * the markdown pipeline — editing happens only in Source mode.
 *
 * @coordinates-with shared/sourceLineAttr.ts — source-line tracking for cursor sync
 * @module plugins/markdownArtifacts/frontmatter
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { sourceLineAttr } from "../shared/sourceLineAttr";

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
          // Fallback: use textContent if data-value is missing (e.g., after sanitization)
          // Return false to skip parsing if no value can be recovered
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
});
