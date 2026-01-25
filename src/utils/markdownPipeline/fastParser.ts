/**
 * Fast markdown parser using markdown-it.
 *
 * markdown-it is ~34x faster than remark for parsing.
 * This module converts markdown-it tokens to MDAST format
 * so existing converters can be reused.
 *
 * @module utils/markdownPipeline/fastParser
 */

import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type {
  Root,
  RootContent,
  PhrasingContent,
  Paragraph,
  Heading,
  Text,
  Strong,
  Emphasis,
  InlineCode,
  Code,
  Blockquote,
  List,
  ListItem,
  Link,
  Image,
  ThematicBreak,
  Break,
  Html,
  Table,
  TableRow,
  TableCell,
  BlockContent,
} from "mdast";

/**
 * Create markdown-it instance with GFM-like features.
 */
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
});

// Enable tables (built into markdown-it)
md.enable("table");

/**
 * Convert markdown-it tokens to MDAST.
 */
function tokensToMdast(tokens: Token[]): Root {
  const root: Root = {
    type: "root",
    children: [],
  };

  let i = 0;
  while (i < tokens.length) {
    const result = convertBlock(tokens, i);
    if (result.node) {
      root.children.push(result.node);
    }
    i = result.nextIndex;
  }

  return root;
}

interface ConvertResult {
  node: RootContent | null;
  nextIndex: number;
}

/**
 * Convert a block-level token to MDAST node.
 */
function convertBlock(tokens: Token[], index: number): ConvertResult {
  const token = tokens[index];

  switch (token.type) {
    case "heading_open": {
      const level = parseInt(token.tag.slice(1), 10) as 1 | 2 | 3 | 4 | 5 | 6;
      const contentToken = tokens[index + 1];
      const children = contentToken?.children
        ? convertInline(contentToken.children)
        : [];
      const heading: Heading = {
        type: "heading",
        depth: level,
        children: children as PhrasingContent[],
      };
      return { node: heading, nextIndex: index + 3 }; // open, inline, close
    }

    case "paragraph_open": {
      const contentToken = tokens[index + 1];
      const children = contentToken?.children
        ? convertInline(contentToken.children)
        : [];
      const paragraph: Paragraph = {
        type: "paragraph",
        children: children as PhrasingContent[],
      };
      return { node: paragraph, nextIndex: index + 3 };
    }

    case "blockquote_open": {
      const blockquote: Blockquote = {
        type: "blockquote",
        children: [],
      };
      let j = index + 1;
      while (j < tokens.length && tokens[j].type !== "blockquote_close") {
        const result = convertBlock(tokens, j);
        if (result.node) {
          blockquote.children.push(result.node as BlockContent);
        }
        j = result.nextIndex;
      }
      return { node: blockquote, nextIndex: j + 1 };
    }

    case "bullet_list_open":
    case "ordered_list_open": {
      const ordered = token.type === "ordered_list_open";
      const list: List = {
        type: "list",
        ordered,
        spread: false,
        children: [],
      };
      if (ordered && token.attrGet("start")) {
        list.start = parseInt(token.attrGet("start") || "1", 10);
      }
      let j = index + 1;
      const closeType = ordered ? "ordered_list_close" : "bullet_list_close";
      while (j < tokens.length && tokens[j].type !== closeType) {
        const result = convertBlock(tokens, j);
        if (result.node && result.node.type === "listItem") {
          list.children.push(result.node);
        }
        j = result.nextIndex;
      }
      return { node: list, nextIndex: j + 1 };
    }

    case "list_item_open": {
      const listItem: ListItem = {
        type: "listItem",
        spread: false,
        children: [],
      };
      let j = index + 1;
      while (j < tokens.length && tokens[j].type !== "list_item_close") {
        const result = convertBlock(tokens, j);
        if (result.node) {
          listItem.children.push(result.node as BlockContent);
        }
        j = result.nextIndex;
      }
      return { node: listItem, nextIndex: j + 1 };
    }

    case "fence":
    case "code_block": {
      const code: Code = {
        type: "code",
        lang: token.info || null,
        meta: null,
        value: token.content.replace(/\n$/, ""), // Remove trailing newline
      };
      return { node: code, nextIndex: index + 1 };
    }

    case "hr": {
      const hr: ThematicBreak = {
        type: "thematicBreak",
      };
      return { node: hr, nextIndex: index + 1 };
    }

    case "html_block": {
      const html: Html = {
        type: "html",
        value: token.content,
      };
      return { node: html, nextIndex: index + 1 };
    }

    case "table_open": {
      const table: Table = {
        type: "table",
        align: [],
        children: [],
      };
      let j = index + 1;
      while (j < tokens.length && tokens[j].type !== "table_close") {
        if (
          tokens[j].type === "thead_open" ||
          tokens[j].type === "tbody_open"
        ) {
          j++;
          continue;
        }
        if (
          tokens[j].type === "thead_close" ||
          tokens[j].type === "tbody_close"
        ) {
          j++;
          continue;
        }
        if (tokens[j].type === "tr_open") {
          const row: TableRow = {
            type: "tableRow",
            children: [],
          };
          j++;
          while (j < tokens.length && tokens[j].type !== "tr_close") {
            if (tokens[j].type === "th_open" || tokens[j].type === "td_open") {
              const cellToken = tokens[j];
              const align = cellToken.attrGet("style");
              let cellAlign: "left" | "center" | "right" | null = null;
              if (align?.includes("left")) cellAlign = "left";
              else if (align?.includes("center")) cellAlign = "center";
              else if (align?.includes("right")) cellAlign = "right";

              // Collect alignment for table
              if (table.children.length === 0) {
                table.align = table.align || [];
                table.align.push(cellAlign);
              }

              j++;
              const inlineToken = tokens[j];
              const children = inlineToken?.children
                ? convertInline(inlineToken.children)
                : [];
              const cell: TableCell = {
                type: "tableCell",
                children: children as PhrasingContent[],
              };
              row.children.push(cell);
              j++; // skip inline
              j++; // skip close
            } else {
              j++;
            }
          }
          table.children.push(row);
          j++; // skip tr_close
        } else {
          j++;
        }
      }
      return { node: table, nextIndex: j + 1 };
    }

    default:
      // Skip unknown tokens
      return { node: null, nextIndex: index + 1 };
  }
}

/**
 * Convert inline tokens to MDAST nodes.
 */
function convertInline(tokens: Token[]): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    switch (token.type) {
      case "text": {
        const text: Text = {
          type: "text",
          value: token.content,
        };
        result.push(text);
        i++;
        break;
      }

      case "code_inline": {
        const code: InlineCode = {
          type: "inlineCode",
          value: token.content,
        };
        result.push(code);
        i++;
        break;
      }

      case "strong_open": {
        const children: PhrasingContent[] = [];
        i++;
        while (i < tokens.length && tokens[i].type !== "strong_close") {
          const innerResult = convertInlineSingle(tokens[i]);
          if (innerResult) children.push(innerResult);
          i++;
        }
        const strong: Strong = {
          type: "strong",
          children,
        };
        result.push(strong);
        i++; // skip close
        break;
      }

      case "em_open": {
        const children: PhrasingContent[] = [];
        i++;
        while (i < tokens.length && tokens[i].type !== "em_close") {
          const innerResult = convertInlineSingle(tokens[i]);
          if (innerResult) children.push(innerResult);
          i++;
        }
        const emphasis: Emphasis = {
          type: "emphasis",
          children,
        };
        result.push(emphasis);
        i++; // skip close
        break;
      }

      case "link_open": {
        const href = token.attrGet("href") || "";
        const title = token.attrGet("title") || undefined;
        const children: PhrasingContent[] = [];
        i++;
        while (i < tokens.length && tokens[i].type !== "link_close") {
          const innerResult = convertInlineSingle(tokens[i]);
          if (innerResult) children.push(innerResult);
          i++;
        }
        const link: Link = {
          type: "link",
          url: href,
          title: title || null,
          children,
        };
        result.push(link);
        i++; // skip close
        break;
      }

      case "image": {
        const src = token.attrGet("src") || "";
        const alt = token.content || "";
        const title = token.attrGet("title") || undefined;
        const image: Image = {
          type: "image",
          url: src,
          alt,
          title: title || null,
        };
        result.push(image);
        i++;
        break;
      }

      case "softbreak": {
        const text: Text = {
          type: "text",
          value: "\n",
        };
        result.push(text);
        i++;
        break;
      }

      case "hardbreak": {
        const br: Break = {
          type: "break",
        };
        result.push(br);
        i++;
        break;
      }

      case "html_inline": {
        const html: Html = {
          type: "html",
          value: token.content,
        };
        result.push(html);
        i++;
        break;
      }

      default:
        i++;
        break;
    }
  }

  return result;
}

/**
 * Convert a single inline token (used inside strong/em/link).
 */
function convertInlineSingle(token: Token): PhrasingContent | null {
  switch (token.type) {
    case "text":
      return { type: "text", value: token.content };
    case "code_inline":
      return { type: "inlineCode", value: token.content };
    case "softbreak":
      return { type: "text", value: "\n" };
    case "hardbreak":
      return { type: "break" };
    default:
      return null;
  }
}

/**
 * Parse markdown to MDAST using markdown-it (fast parser).
 *
 * This is ~34x faster than remark but may not support all
 * custom syntax (wiki links, custom inline, etc.).
 *
 * @param markdown - The markdown string to parse
 * @returns The root MDAST node
 */
export function parseMarkdownToMdastFast(markdown: string): Root {
  const tokens = md.parse(markdown, {});
  return tokensToMdast(tokens);
}

/**
 * Check if content can be parsed with fast parser.
 * Returns false if content uses features that markdown-it handles differently
 * from remark, or features not supported by markdown-it.
 *
 * Conservative approach: only use fast parser for simple markdown
 * where we're confident the output is compatible.
 */
export function canUseFastParser(markdown: string): boolean {
  // Features not supported or handled differently by markdown-it
  const unsupportedPatterns = [
    /\$[^$]+\$/, // Inline math
    /\$\$[^$]+\$\$/, // Block math
    /\[\[[^\]]+\]\]/, // Wiki links
    /==.+==/, // Highlight
    /\+\+.+\+\+/, // Underline
    /~[^~]+~/, // Subscript (single tilde)
    /\^[^^]+\^/, // Superscript
    /<details/i, // Details block
    /- \[[ x]\]/i, // Task lists (checkbox) - GFM feature with different handling
    /^\|.+\|$/m, // Tables - markdown-it has different cell content handling
    / {2}\n/, // Hard breaks (two spaces) - different AST representation
    /~~.+~~/s, // Strikethrough - GFM feature
    /^---\s*$/m, // Frontmatter - YAML parsing differences
  ];

  for (const pattern of unsupportedPatterns) {
    if (pattern.test(markdown)) {
      return false;
    }
  }

  return true;
}
