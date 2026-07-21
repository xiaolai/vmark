import { Schema } from "@tiptap/pm/model";

// Mirror of the production `blankLinesBefore` attribute (see
// plugins/shared/blankLinesAttr.ts). Declared on every block node so the
// pipeline tests can observe capture; production nodes get it via
// withBlankLinesBefore in the extension assembly.
const bl = { blankLinesBefore: { default: null as number | null } };

export const testSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { attrs: { ...bl }, content: "inline*", group: "block" },
    heading: {
      attrs: { level: { default: 1 }, ...bl },
      content: "inline*",
      group: "block",
    },
    codeBlock: {
      attrs: { language: { default: null }, ...bl },
      content: "text*",
      marks: "",
      group: "block",
      code: true,
    },
    blockquote: { attrs: { ...bl }, content: "block+", group: "block" },
    bulletList: { attrs: { ...bl }, content: "listItem+", group: "block" },
    orderedList: {
      attrs: { start: { default: 1 }, ...bl },
      content: "listItem+",
      group: "block",
    },
    listItem: {
      attrs: { checked: { default: null } },
      content: "block+",
    },
    horizontalRule: { group: "block" },
    hardBreak: { inline: true, group: "inline" },
    text: { group: "inline" },
    image: {
      attrs: { src: {}, alt: { default: null }, title: { default: null } },
      inline: true,
      group: "inline",
    },
    block_image: {
      attrs: { src: { default: "" }, alt: { default: "" }, title: { default: "" } },
      group: "block",
      atom: true,
    },
    table: { content: "tableRow+", group: "block" },
    tableRow: { content: "(tableCell|tableHeader)+" },
    tableCell: {
      content: "paragraph+",
      attrs: { alignment: { default: null } },
      tableRole: "cell",
    },
    tableHeader: {
      content: "paragraph+",
      attrs: { alignment: { default: null } },
      tableRole: "header",
    },
    math_inline: {
      attrs: { content: { default: "" } },
      inline: true,
      group: "inline",
      atom: true,
    },
    footnote_reference: {
      attrs: { label: { default: "1" } },
      inline: true,
      group: "inline",
      atom: true,
    },
    footnote_definition: {
      attrs: { label: { default: "1" } },
      content: "paragraph",
      group: "block",
    },
    alertBlock: {
      attrs: { alertType: { default: "NOTE" } },
      content: "block+",
      group: "block",
    },
    detailsBlock: {
      attrs: { open: { default: false } },
      content: "detailsSummary block+",
      group: "block",
    },
    detailsSummary: {
      content: "inline*",
    },
    wikiLink: {
      attrs: { value: { default: "" } },
      content: "text*",
      inline: true,
      group: "inline",
    },
    link_definition: {
      attrs: {
        identifier: { default: "" },
        label: { default: null },
        url: { default: "" },
        title: { default: null },
      },
      group: "block",
      atom: true,
    },
    frontmatter: {
      attrs: { value: { default: "" } },
      group: "block",
      atom: true,
    },
    html_inline: {
      attrs: { value: { default: "" } },
      inline: true,
      group: "inline",
      atom: true,
    },
    html_block: {
      attrs: { value: { default: "" } },
      group: "block",
      atom: true,
    },
  },
  marks: {
    bold: {},
    italic: {},
    strike: {},
    code: {},
    link: { attrs: { href: {} } },
    subscript: {},
    superscript: {},
    highlight: {},
    underline: {},
  },
});
