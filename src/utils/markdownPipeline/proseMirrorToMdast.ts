/**
 * ProseMirror to MDAST conversion
 *
 * Converts ProseMirror document nodes to MDAST (Markdown Abstract Syntax Tree).
 * The ProseMirror schema is passed in to ensure framework-free utils layer.
 *
 * @module utils/markdownPipeline/proseMirrorToMdast
 */

import type { Schema, Node as PMNode } from "@tiptap/pm/model";
import type {
  Root,
  Content,
  Paragraph,
  Heading,
  Code,
  Blockquote,
  List,
  ListItem,
  ThematicBreak,
  PhrasingContent,
  BlockContent,
} from "mdast";
import type { FootnoteDefinition } from "./types";
import * as inlineConverters from "./pmInlineConverters";

/**
 * Convert ProseMirror document to MDAST root.
 *
 * @param schema - The ProseMirror schema (used for type checking)
 * @param doc - The ProseMirror document node
 * @returns An MDAST root node
 *
 * @example
 * const doc = editor.state.doc;
 * const mdast = proseMirrorToMdast(schema, doc);
 * const markdown = serializeMdastToMarkdown(mdast);
 */
export function proseMirrorToMdast(schema: Schema, doc: PMNode): Root {
  const converter = new PMToMdastConverter(schema);
  return converter.convertDoc(doc);
}

/**
 * Internal converter class for PM to MDAST conversion.
 * Schema parameter reserved for future extension (e.g., custom node detection).
 */
class PMToMdastConverter {
  constructor(_schema: Schema) {
    // Schema reserved for future use (custom node type detection)
  }

  /**
   * Convert ProseMirror doc to MDAST root.
   */
  convertDoc(doc: PMNode): Root {
    const children: Content[] = [];

    doc.forEach((child) => {
      const converted = this.convertNode(child);
      if (converted) {
        if (Array.isArray(converted)) {
          children.push(...converted);
        } else {
          children.push(converted);
        }
      }
    });

    return { type: "root", children };
  }

  /**
   * Convert a single ProseMirror node to MDAST node(s).
   */
  private convertNode(node: PMNode): Content | Content[] | null {
    const typeName = node.type.name;

    switch (typeName) {
      // Block nodes
      case "paragraph":
        return this.convertParagraph(node);
      case "heading":
        return this.convertHeading(node);
      case "codeBlock":
        return this.convertCodeBlock(node);
      case "blockquote":
        return this.convertBlockquote(node);
      case "bulletList":
        return this.convertList(node, false);
      case "orderedList":
        return this.convertList(node, true);
      case "listItem":
        return this.convertListItem(node);
      case "horizontalRule":
        return this.convertHorizontalRule();
      case "hardBreak":
        return inlineConverters.convertHardBreak();
      case "image":
        return inlineConverters.convertImage(node);

      // Custom nodes
      case "math_inline":
        return inlineConverters.convertMathInline(node);
      case "footnote_reference":
        return inlineConverters.convertFootnoteReference(node);
      case "footnote_definition":
        return this.convertFootnoteDefinition(node);

      default:
        // Unknown node type - skip with warning in dev
        if (import.meta.env.DEV) {
          console.warn(`[PMToMdast] Unknown node type: ${typeName}`);
        }
        return null;
    }
  }

  // Block converters

  private convertParagraph(node: PMNode): Paragraph {
    const children = this.convertInlineContent(node);
    return { type: "paragraph", children };
  }

  private convertHeading(node: PMNode): Heading {
    const level = (node.attrs.level ?? 1) as 1 | 2 | 3 | 4 | 5 | 6;
    const children = this.convertInlineContent(node);
    return { type: "heading", depth: level, children };
  }

  private convertCodeBlock(node: PMNode): Code {
    const lang = node.attrs.language as string | null;
    return {
      type: "code",
      lang: lang || undefined,
      value: node.textContent,
    };
  }

  private convertBlockquote(node: PMNode): Blockquote {
    const children: BlockContent[] = [];
    node.forEach((child) => {
      const converted = this.convertNode(child);
      if (converted) {
        if (Array.isArray(converted)) {
          children.push(...(converted as BlockContent[]));
        } else {
          children.push(converted as BlockContent);
        }
      }
    });
    return { type: "blockquote", children };
  }

  private convertList(node: PMNode, ordered: boolean): List {
    const children: ListItem[] = [];
    node.forEach((child) => {
      const converted = this.convertNode(child);
      if (converted && !Array.isArray(converted) && converted.type === "listItem") {
        children.push(converted);
      }
    });

    const list: List = {
      type: "list",
      ordered,
      children,
    };

    if (ordered) {
      list.start = (node.attrs.start as number) ?? 1;
    }

    return list;
  }

  private convertListItem(node: PMNode): ListItem {
    const children: BlockContent[] = [];
    node.forEach((child) => {
      const converted = this.convertNode(child);
      if (converted) {
        if (Array.isArray(converted)) {
          children.push(...(converted as BlockContent[]));
        } else {
          children.push(converted as BlockContent);
        }
      }
    });

    const listItem: ListItem = { type: "listItem", children };

    // Handle task list items
    const checked = node.attrs.checked;
    if (checked === true || checked === false) {
      listItem.checked = checked;
    }

    return listItem;
  }

  private convertHorizontalRule(): ThematicBreak {
    return { type: "thematicBreak" };
  }

  // Inline content conversion

  /**
   * Convert inline content of a block node to MDAST phrasing content.
   */
  private convertInlineContent(node: PMNode): PhrasingContent[] {
    const result: PhrasingContent[] = [];

    node.forEach((child) => {
      if (child.isText) {
        const converted = inlineConverters.convertTextWithMarks(child);
        result.push(...converted);
      } else if (child.type.name === "hardBreak") {
        result.push(inlineConverters.convertHardBreak());
      } else if (child.type.name === "image") {
        result.push(inlineConverters.convertImage(child));
      } else if (child.type.name === "math_inline") {
        result.push(inlineConverters.convertMathInline(child));
      } else if (child.type.name === "footnote_reference") {
        result.push(inlineConverters.convertFootnoteReference(child));
      }
    });

    return result;
  }

  // Custom node converters

  private convertFootnoteDefinition(node: PMNode): FootnoteDefinition {
    const children: BlockContent[] = [];
    node.forEach((child) => {
      const converted = this.convertNode(child);
      if (converted) {
        if (Array.isArray(converted)) {
          children.push(...(converted as BlockContent[]));
        } else {
          children.push(converted as BlockContent);
        }
      }
    });

    return {
      type: "footnoteDefinition",
      identifier: String(node.attrs.label ?? "1"),
      label: String(node.attrs.label ?? "1"),
      children,
    };
  }
}
