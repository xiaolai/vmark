import { TableCell, TableHeader } from "@tiptap/extension-table";

export const AlignedTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
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
