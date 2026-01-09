/**
 * MDAST to ProseMirror conversion
 *
 * Converts MDAST (Markdown Abstract Syntax Tree) nodes to ProseMirror nodes.
 * The ProseMirror schema is passed in to ensure framework-free utils layer.
 *
 * @module utils/markdownPipeline/mdastToProseMirror
 */

import type { Schema, Node as PMNode, Mark } from "@tiptap/pm/model";
import type {
  Root,
  Content,
  Paragraph,
  Heading,
  Code,
  Blockquote,
  List,
  ListItem,
  Text,
  Strong,
  Emphasis,
  Delete,
  InlineCode,
  Link,
  Image,
  FootnoteReference,
  FootnoteDefinition,
} from "mdast";
import type { InlineMath } from "mdast-util-math";
import type { Subscript, Superscript, Highlight, Underline } from "./types";
import * as inlineConverters from "./mdastInlineConverters";

/**
 * Convert MDAST root to ProseMirror document.
 *
 * @param schema - The ProseMirror schema to use for creating nodes
 * @param mdast - The MDAST root node
 * @returns A ProseMirror document node
 *
 * @example
 * const mdast = parseMarkdownToMdast("# Hello");
 * const doc = mdastToProseMirror(schema, mdast);
 */
export function mdastToProseMirror(schema: Schema, mdast: Root): PMNode {
  const converter = new MdastToPMConverter(schema);
  return converter.convertRoot(mdast);
}

/**
 * Internal converter class that maintains schema context.
 */
class MdastToPMConverter {
  constructor(private schema: Schema) {}

  /**
   * Convert root node to ProseMirror doc.
   */
  convertRoot(root: Root): PMNode {
    const children = this.convertChildren(root.children, []);
    return this.schema.topNodeType.create(null, children);
  }

  /**
   * Convert array of MDAST children to ProseMirror nodes.
   * Accepts Content[] or PhrasingContent[] (inline content).
   */
  convertChildren(children: readonly Content[], marks: Mark[]): PMNode[] {
    const result: PMNode[] = [];
    for (const child of children) {
      const converted = this.convertNode(child, marks);
      if (converted) {
        if (Array.isArray(converted)) {
          result.push(...converted);
        } else {
          result.push(converted);
        }
      }
    }
    return result;
  }

  /**
   * Convert a single MDAST node to ProseMirror node(s).
   */
  private convertNode(node: Content, marks: Mark[]): PMNode | PMNode[] | null {
    // Use type assertion for node.type to handle custom types not in base Content union
    const nodeType = node.type as string;
    const convertChildrenBound = this.convertChildren.bind(this);

    switch (nodeType) {
      // Block nodes
      case "paragraph":
        return this.convertParagraph(node as Paragraph, marks);
      case "heading":
        return this.convertHeading(node as Heading, marks);
      case "code":
        return this.convertCode(node as Code);
      case "blockquote":
        return this.convertBlockquote(node as Blockquote, marks);
      case "list":
        return this.convertList(node as List, marks);
      case "listItem":
        return this.convertListItem(node as ListItem, marks);
      case "thematicBreak":
        return this.convertThematicBreak();

      // Inline nodes - delegated to inline converters
      case "text":
        return inlineConverters.convertText(this.schema, node as Text, marks);
      case "strong":
        return inlineConverters.convertStrong(this.schema, node as Strong, marks, convertChildrenBound);
      case "emphasis":
        return inlineConverters.convertEmphasis(this.schema, node as Emphasis, marks, convertChildrenBound);
      case "delete":
        return inlineConverters.convertDelete(this.schema, node as Delete, marks, convertChildrenBound);
      case "inlineCode":
        return inlineConverters.convertInlineCode(this.schema, node as InlineCode, marks);
      case "link":
        return inlineConverters.convertLink(this.schema, node as Link, marks, convertChildrenBound);
      case "image":
        return inlineConverters.convertImage(this.schema, node as Image);
      case "break":
        return inlineConverters.convertBreak(this.schema);

      // Custom inline marks
      case "subscript":
        return inlineConverters.convertSubscript(this.schema, node as unknown as Subscript, marks, convertChildrenBound);
      case "superscript":
        return inlineConverters.convertSuperscript(this.schema, node as unknown as Superscript, marks, convertChildrenBound);
      case "highlight":
        return inlineConverters.convertHighlight(this.schema, node as unknown as Highlight, marks, convertChildrenBound);
      case "underline":
        return inlineConverters.convertUnderline(this.schema, node as unknown as Underline, marks, convertChildrenBound);

      // Custom nodes
      case "inlineMath":
        return inlineConverters.convertInlineMath(this.schema, node as unknown as InlineMath);
      case "footnoteReference":
        return inlineConverters.convertFootnoteReference(this.schema, node as unknown as FootnoteReference);
      case "footnoteDefinition":
        return this.convertFootnoteDefinition(node as unknown as FootnoteDefinition, marks);

      // Skip frontmatter and other non-content nodes
      case "yaml":
        return null;

      default:
        // Unknown node type - skip with warning in dev
        if (import.meta.env.DEV) {
          console.warn(`[MdastToPM] Unknown node type: ${nodeType}`);
        }
        return null;
    }
  }

  // Block converters

  private convertParagraph(node: Paragraph, marks: Mark[]): PMNode | null {
    const type = this.schema.nodes.paragraph;
    if (!type) return null;

    const children = this.convertChildren(node.children as Content[], marks);
    return type.create(null, children);
  }

  private convertHeading(node: Heading, marks: Mark[]): PMNode | null {
    const type = this.schema.nodes.heading;
    if (!type) return null;

    const children = this.convertChildren(node.children as Content[], marks);
    return type.create({ level: node.depth }, children);
  }

  private convertCode(node: Code): PMNode | null {
    const type = this.schema.nodes.codeBlock;
    if (!type) return null;

    const text = node.value ? this.schema.text(node.value) : null;
    return type.create({ language: node.lang || null }, text ? [text] : []);
  }

  private convertBlockquote(node: Blockquote, marks: Mark[]): PMNode | null {
    const type = this.schema.nodes.blockquote;
    if (!type) return null;

    const children = this.convertChildren(node.children, marks);
    return type.create(null, children);
  }

  private convertList(node: List, marks: Mark[]): PMNode | null {
    const isOrdered = node.ordered ?? false;
    const typeName = isOrdered ? "orderedList" : "bulletList";
    const type = this.schema.nodes[typeName];
    if (!type) return null;

    const children = this.convertChildren(node.children, marks);
    const attrs = isOrdered ? { start: node.start ?? 1 } : null;
    return type.create(attrs, children);
  }

  private convertListItem(node: ListItem, marks: Mark[]): PMNode | null {
    const type = this.schema.nodes.listItem;
    if (!type) return null;

    // Handle task list items
    const checked = node.checked;
    const attrs = checked !== null && checked !== undefined ? { checked } : null;

    // ListItem children are typically block-level (paragraphs, nested lists)
    const children = this.convertChildren(node.children, marks);
    return type.create(attrs, children);
  }

  private convertThematicBreak(): PMNode | null {
    const type = this.schema.nodes.horizontalRule;
    if (!type) return null;
    return type.create();
  }

  private convertFootnoteDefinition(
    node: FootnoteDefinition,
    marks: Mark[]
  ): PMNode | null {
    const type = this.schema.nodes.footnote_definition;
    if (!type) return null;

    const children = this.convertChildren(node.children, marks);
    return type.create({ label: node.identifier }, children);
  }
}
