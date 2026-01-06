import MarkdownIt from "markdown-it";
import { MarkdownParser, MarkdownSerializer } from "prosemirror-markdown";
import type { Schema, Node as PMNode } from "@tiptap/pm/model";

const markdownIt = new MarkdownIt("commonmark", { html: false }).enable("strikethrough");

const parserCache = new WeakMap<Schema, MarkdownParser>();

export function parseMarkdownToTiptapDoc(schema: Schema, markdown: string): PMNode {
  const cached = parserCache.get(schema);
  if (cached) return cached.parse(markdown);

  const parser = new MarkdownParser(schema, markdownIt, {
    blockquote: { block: "blockquote" },
    paragraph: { block: "paragraph" },
    heading: {
      block: "heading",
      getAttrs: (tok) => ({ level: +tok.tag.slice(1) }),
    },
    bullet_list: { block: "bulletList" },
    ordered_list: {
      block: "orderedList",
      getAttrs: (tok) => ({
        start: +(tok.attrGet("start") || 1),
        type: tok.attrGet("type") || null,
      }),
    },
    list_item: { block: "listItem" },
    code_block: { block: "codeBlock", noCloseToken: true },
    fence: {
      block: "codeBlock",
      getAttrs: (tok) => ({ language: tok.info?.trim() || null }),
      noCloseToken: true,
    },
    hr: { node: "horizontalRule" },
    image: {
      node: "image",
      getAttrs: (tok) => ({
        src: tok.attrGet("src"),
        title: tok.attrGet("title") || null,
        alt: (tok.children?.[0]?.content || tok.attrGet("alt") || null) ?? null,
      }),
    },
    hardbreak: { node: "hardBreak" },
    em: { mark: "italic" },
    strong: { mark: "bold" },
    s: { mark: "strike" },
    link: {
      mark: "link",
      getAttrs: (tok) => ({
        href: tok.attrGet("href"),
        target: null,
        rel: null,
        class: null,
      }),
    },
    code_inline: { mark: "code", noCloseToken: true },
  });

  parserCache.set(schema, parser);
  return parser.parse(markdown);
}

function backticksFor(node: PMNode, side: number) {
  const ticks = /`+/g;
  let match: RegExpExecArray | null;
  let len = 0;
  if (node.isText) {
    while ((match = ticks.exec(node.text || ""))) {
      len = Math.max(len, match[0].length);
    }
  }
  let result = len > 0 && side > 0 ? " `" : "`";
  for (let i = 0; i < len; i++) result += "`";
  if (len > 0 && side < 0) result += " ";
  return result;
}

const tiptapMarkdownSerializer = new MarkdownSerializer(
  {
    blockquote: (state, node) => {
      state.wrapBlock("> ", null, node, () => state.renderContent(node));
    },
    codeBlock: (state, node) => {
      const backticks = node.textContent.match(/`{3,}/gm);
      const fence = backticks ? `${backticks.sort().slice(-1)[0]}\`` : "```";
      const language = node.attrs.language ? node.attrs.language : "";
      state.write(`${fence}${language}\n`);
      state.text(node.textContent, false);
      state.write("\n");
      state.write(fence);
      state.closeBlock(node);
    },
    heading: (state, node) => {
      state.write(`${state.repeat("#", node.attrs.level)} `);
      state.renderInline(node, false);
      state.closeBlock(node);
    },
    horizontalRule: (state, node) => {
      state.write("---");
      state.closeBlock(node);
    },
    bulletList: (state, node) => {
      state.renderList(node, "  ", () => "- ");
    },
    orderedList: (state, node) => {
      const start = node.attrs.start || 1;
      const maxW = String(start + node.childCount - 1).length;
      const space = state.repeat(" ", maxW + 2);
      state.renderList(node, space, (i) => {
        const nStr = String(start + i);
        return `${state.repeat(" ", maxW - nStr.length)}${nStr}. `;
      });
    },
    listItem: (state, node) => {
      state.renderContent(node);
    },
    paragraph: (state, node) => {
      state.renderInline(node);
      state.closeBlock(node);
    },
    image: (state, node) => {
      state.write(
        `![${state.esc(node.attrs.alt || "")}](${node.attrs.src.replace(/[()]/g, "\\$&")}${node.attrs.title ? ` "${node.attrs.title.replace(/"/g, '\\"')}"` : ""})`
      );
    },
    hardBreak: (state, node, parent, index) => {
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) {
          state.write("\\\n");
          return;
        }
      }
    },
    text: (state, node) => {
      state.text(node.text || "", true);
    },
  },
  {
    italic: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
    bold: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
    strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
    link: {
      open: () => "[",
      close: (_state, mark) => `](${mark.attrs.href.replace(/[()"]/g, "\\$&")})`,
      mixable: true,
    },
    code: {
      open: (_state, _mark, parent, index) => backticksFor(parent.child(index), -1),
      close: (_state, _mark, parent, index) => backticksFor(parent.child(index - 1), 1),
      escape: false,
    },
  }
);

export function serializeTiptapDocToMarkdown(doc: PMNode): string {
  return tiptapMarkdownSerializer.serialize(doc);
}
