/**
 * AlignedTableNodes
 *
 * Purpose: Extends Tiptap's table cell and header nodes to support text alignment (left/center/right)
 * and source line tracking. Standard Tiptap table nodes lack alignment support — these
 * extended versions parse and render `style="text-align:..."` on `<td>`/`<th>` elements.
 *
 * Key decisions:
 *   - Alignment stored as an HTML attribute rather than a ProseMirror mark, because cell-level
 *     alignment is inherently a node attribute (not inline formatting).
 *   - sourceLineAttr included for bidirectional cursor sync between WYSIWYG and Source modes.
 *
 * @coordinates-with plugins/shared/sourceLineAttr.ts — provides the source-line attribute mixin
 * @module components/Editor/alignedTableNodes
 */
import { TableCell, TableHeader } from "@tiptap/extension-table";
import { sourceLineAttr } from "@/plugins/shared/sourceLineAttr";

export const AlignedTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...sourceLineAttr,
      alignment: {
        default: null,
        parseHTML: (element) => {
          const alignment = (element as HTMLElement).style.textAlign || null;
          if (alignment === "left" || alignment === "center" || alignment === "right") return alignment;
          return null;
        },
        renderHTML: (attributes) => {
          const alignment = attributes.alignment as unknown;
          if (alignment !== "left" && alignment !== "center" && alignment !== "right") return {};
          return { style: `text-align:${alignment}` };
        },
      },
    };
  },
});

export const AlignedTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...sourceLineAttr,
      alignment: {
        default: null,
        parseHTML: (element) => {
          const alignment = (element as HTMLElement).style.textAlign || null;
          if (alignment === "left" || alignment === "center" || alignment === "right") return alignment;
          return null;
        },
        renderHTML: (attributes) => {
          const alignment = attributes.alignment as unknown;
          if (alignment !== "left" && alignment !== "center" && alignment !== "right") return {};
          return { style: `text-align:${alignment}` };
        },
      },
    };
  },
});
