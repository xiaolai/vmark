/**
 * MDAST Block Node Converters
 *
 * Purpose: Converts block-level MDAST nodes (paragraphs, headings, lists, tables, etc.)
 * to ProseMirror nodes. Split from mdastToProseMirror.ts for the 300-line limit.
 *
 * Key decisions:
 *   - Each converter is a pure function taking a context object — no class state
 *   - Alert blocks are detected by parsing blockquote children for `[!TYPE]` markers
 *     (GitHub-flavored markdown alerts), falling back to normal blockquote conversion
 *   - Paragraphs with a single image child are promoted to block_image nodes
 *   - sourceLine attributes are extracted from MDAST positions for cursor sync
 *   - MATH_BLOCK_LANGUAGE sentinel stores math blocks as codeBlock with a special
 *     language value, since PM schema doesn't have a dedicated math block node
 *
 * @coordinates-with mdastInlineConverters.ts — handles inline content within blocks
 * @coordinates-with mdastToProseMirror.ts — orchestrates block + inline conversion
 * @coordinates-with pmBlockConverters.ts — reverse direction (PM → MDAST)
 * @module utils/markdownPipeline/mdastBlockConverters
 */

import type { Schema, Node as PMNode, Mark } from "@tiptap/pm/model";
import type {
  Blockquote,
  Code,
  Content,
  Definition,
  Heading,
  Html,
  List,
  ListItem,
  Paragraph,
  Table,
  ThematicBreak,
} from "mdast";
import type { Math } from "mdast-util-math";
import type { Alert, Details, WikiLink, Yaml } from "./types";
import * as inlineConverters from "./mdastInlineConverters";
import { parseInlineMarkdown } from "./inlineParser";
export type ContentContext = "block" | "inline";

export interface MdastToPmContext {
  schema: Schema;
  convertChildren: (children: readonly Content[], marks: Mark[], context: ContentContext) => PMNode[];
  /** Generate a unique heading ID from text. Returns null if ID generation is disabled. */
  generateHeadingId?: (text: string) => string | null;
}

/**
 * Extract source line number from MDAST node position.
 * Returns null if position is not available.
 */
function getSourceLine(node: { position?: { start?: { line?: number } } }): number | null {
  return node.position?.start?.line ?? null;
}

/**
 * Ensure block content is non-empty by adding an empty paragraph if needed.
 * Many block elements (alerts, details) require at least one child.
 */
function ensureNonEmptyBlocks(children: PMNode[], schema: Schema): PMNode[] {
  if (children.length === 0 && schema.nodes.paragraph) {
    return [schema.nodes.paragraph.create()];
  }
  return children;
}
const ALERT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;

export function convertParagraph(
  context: MdastToPmContext,
  node: Paragraph,
  marks: Mark[]
): PMNode | null {
  const type = context.schema.nodes.paragraph;
  if (!type) return null;
  const sourceLine = getSourceLine(node);
  const blockImageType = context.schema.nodes.block_image;
  if (blockImageType && node.children.length === 1 && node.children[0]?.type === "image") {
    const imageNode = inlineConverters.convertImage(
      context.schema,
      node.children[0] as import("mdast").Image
    );
    if (imageNode) {
      return blockImageType.create({
        src: imageNode.attrs.src ?? "",
        alt: imageNode.attrs.alt ?? "",
        title: imageNode.attrs.title ?? "",
        sourceLine,
      });
    }
  }
  const children = context.convertChildren(node.children as Content[], marks, "inline");
  return type.create({ sourceLine }, children);
}

export function convertHeading(
  context: MdastToPmContext,
  node: Heading,
  marks: Mark[]
): PMNode | null {
  const type = context.schema.nodes.heading;
  if (!type) return null;
  const children = context.convertChildren(node.children as Content[], marks, "inline");
  // Extract heading text for ID generation
  const headingText = node.children
    .map((child) => ("value" in child ? String(child.value) : ""))
    .join("");
  const id = context.generateHeadingId?.(headingText) ?? null;
  return type.create({ level: node.depth, sourceLine: getSourceLine(node), id }, children);
}

export function convertCode(context: MdastToPmContext, node: Code): PMNode | null {
  const type = context.schema.nodes.codeBlock;
  if (!type) return null;

  const text = node.value ? context.schema.text(node.value) : null;
  return type.create({ language: node.lang || null, sourceLine: getSourceLine(node) }, text ? [text] : []);
}

export function convertBlockquote(
  context: MdastToPmContext,
  node: Blockquote,
  marks: Mark[]
): PMNode | null {
  const alertNode = convertAlertBlockquote(context, node, marks);
  if (alertNode) return alertNode;

  const type = context.schema.nodes.blockquote;
  if (!type) return null;

  const children = context.convertChildren(node.children, marks, "block");
  return type.create({ sourceLine: getSourceLine(node) }, children);
}

export function convertList(context: MdastToPmContext, node: List, marks: Mark[]): PMNode | null {
  const isOrdered = node.ordered ?? false;
  const typeName = isOrdered ? "orderedList" : "bulletList";
  const type = context.schema.nodes[typeName];
  if (!type) return null;

  const children = context.convertChildren(node.children, marks, "block");
  const sourceLine = getSourceLine(node);
  const attrs = isOrdered ? { start: node.start ?? 1, sourceLine } : { sourceLine };
  return type.create(attrs, children);
}

export function convertListItem(
  context: MdastToPmContext,
  node: ListItem,
  marks: Mark[]
): PMNode | null {
  const type = context.schema.nodes.listItem;
  if (!type) return null;

  const checked = node.checked;
  const sourceLine = getSourceLine(node);
  const attrs = checked !== null && checked !== undefined ? { checked, sourceLine } : { sourceLine };

  const children = context.convertChildren(node.children, marks, "block");
  return type.create(attrs, children);
}

export function convertThematicBreak(context: MdastToPmContext, node: ThematicBreak): PMNode | null {
  const type = context.schema.nodes.horizontalRule;
  if (!type) return null;
  return type.create({ sourceLine: getSourceLine(node) });
}

export function convertTable(
  context: MdastToPmContext,
  node: Table,
  marks: Mark[]
): PMNode | null {
  const tableType = context.schema.nodes.table;
  const rowType = context.schema.nodes.tableRow;
  const cellType = context.schema.nodes.tableCell;
  if (!tableType || !rowType || !cellType) return null;

  const headerType = context.schema.nodes.tableHeader ?? cellType;
  const paragraphType = context.schema.nodes.paragraph;
  const alignments = node.align ?? [];
  const tableSourceLine = getSourceLine(node);

  const rows = node.children.map((row, rowIndex) => {
    const rowSourceLine = getSourceLine(row);
    const cells = row.children.map((cell, cellIndex) => {
      const cellNodeType = rowIndex === 0 ? headerType : cellType;
      const alignment = alignments[cellIndex] ?? null;
      const cellSourceLine = getSourceLine(cell);
      const baseAttrs: Record<string, unknown> = { sourceLine: cellSourceLine };
      if (alignment && supportsAlignmentAttr(cellNodeType)) {
        baseAttrs.alignment = alignment;
      }
      const inlineChildren = context.convertChildren(cell.children as Content[], marks, "inline");
      const content = paragraphType ? [paragraphType.create({ sourceLine: cellSourceLine }, inlineChildren)] : inlineChildren;
      return cellNodeType.create(baseAttrs, content);
    });
    return rowType.create({ sourceLine: rowSourceLine }, cells);
  });

  return tableType.create({ sourceLine: tableSourceLine }, rows);
}

/**
 * Internal sentinel value for math blocks stored as codeBlock.
 * Uses a value that won't collide with real language names.
 */
export const MATH_BLOCK_LANGUAGE = "$$math$$";

export function convertMathBlock(context: MdastToPmContext, node: Math): PMNode | null {
  const type = context.schema.nodes.codeBlock;
  if (!type) return null;
  const text = node.value ? context.schema.text(node.value) : null;
  return type.create({ language: MATH_BLOCK_LANGUAGE, sourceLine: getSourceLine(node) }, text ? [text] : []);
}

export function convertDefinition(context: MdastToPmContext, node: Definition): PMNode | null {
  const type = context.schema.nodes.link_definition;
  if (!type) return null;
  return type.create({
    identifier: node.identifier,
    label: node.label ?? null,
    url: node.url,
    title: node.title ?? null,
    sourceLine: getSourceLine(node),
  });
}

export function convertFrontmatter(context: MdastToPmContext, node: Yaml): PMNode | null {
  const type = context.schema.nodes.frontmatter;
  if (!type) return null;
  return type.create({ value: node.value ?? "", sourceLine: getSourceLine(node) });
}

export function convertDetails(
  context: MdastToPmContext,
  node: Details,
  marks: Mark[]
): PMNode | null {
  const detailsType = context.schema.nodes.detailsBlock;
  const summaryType = context.schema.nodes.detailsSummary;
  if (!detailsType || !summaryType) return null;

  const sourceLine = getSourceLine(node);
  const summaryText = node.summary ?? "Details";

  // Parse summary text as inline markdown to support **bold**, *italic*, etc.
  const summaryInlineContent = parseInlineMarkdown(summaryText);
  const summaryPmNodes = context.convertChildren(summaryInlineContent, marks, "inline");

  const summaryNode = summaryType.create(
    { sourceLine },
    summaryPmNodes.length > 0 ? summaryPmNodes : []
  );
  const children = ensureNonEmptyBlocks(
    context.convertChildren(node.children as Content[], marks, "block"),
    context.schema
  );

  return detailsType.create({ open: node.open ?? false, sourceLine }, [summaryNode, ...children]);
}

export function convertAlert(
  context: MdastToPmContext,
  node: Alert,
  marks: Mark[]
): PMNode | null {
  const alertType = context.schema.nodes.alertBlock;
  if (!alertType) return null;

  const children = ensureNonEmptyBlocks(
    context.convertChildren(node.children as Content[], marks, "block"),
    context.schema
  );

  return alertType.create({ alertType: node.alertType, sourceLine: getSourceLine(node) }, children);
}

export function convertWikiLink(context: MdastToPmContext, node: WikiLink): PMNode | null {
  const type = context.schema.nodes.wikiLink;
  if (!type) return null;

  // Display text: use alias if present, otherwise use the target value
  const displayText = node.alias || node.value;
  const textNode = displayText ? context.schema.text(displayText) : null;

  return type.create(
    { value: node.value, sourceLine: getSourceLine(node) },
    textNode ? [textNode] : []
  );
}

export function convertHtml(
  context: MdastToPmContext,
  node: Html,
  inline: boolean
): PMNode | null {
  const type = inline ? context.schema.nodes.html_inline : context.schema.nodes.html_block;
  if (!type) return null;
  return type.create({ value: node.value ?? "", sourceLine: getSourceLine(node) });
}

export function convertFootnoteDefinition(
  context: MdastToPmContext,
  node: import("mdast").FootnoteDefinition,
  marks: Mark[]
): PMNode | null {
  const type = context.schema.nodes.footnote_definition;
  if (!type) return null;

  const children = context.convertChildren(node.children, marks, "block");
  return type.create({ label: node.identifier, sourceLine: getSourceLine(node) }, children);
}

export function convertAlertBlockquote(
  context: MdastToPmContext,
  node: Blockquote,
  marks: Mark[]
): PMNode | null {
  const alertType = context.schema.nodes.alertBlock;
  if (!alertType) return null;

  const firstChild = node.children[0];
  if (!firstChild || firstChild.type !== "paragraph") return null;

  const stripped = stripAlertMarker(firstChild);
  if (!stripped) return null;

  const alertChildren: Content[] = [];
  if (stripped.paragraph) {
    alertChildren.push(stripped.paragraph);
  }
  alertChildren.push(...node.children.slice(1));

  const converted = ensureNonEmptyBlocks(
    context.convertChildren(alertChildren, marks, "block"),
    context.schema
  );

  return alertType.create({ alertType: stripped.alertType, sourceLine: getSourceLine(node) }, converted);
}

function stripAlertMarker(
  paragraph: Paragraph
): { alertType: (typeof ALERT_TYPES)[number]; paragraph: Paragraph | null } | null {
  const children = [...(paragraph.children ?? [])];
  const first = children[0];
  if (!first || first.type !== "text") return null;

  const match = first.value.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+)?/i);
  if (!match) return null;

  const alertType = match[1].toUpperCase();
  if (!ALERT_TYPES.includes(alertType as (typeof ALERT_TYPES)[number])) {
    return null;
  }
  const rest = first.value.slice(match[0].length);

  if (rest.length > 0) {
    children[0] = { ...first, value: rest };
  } else {
    children.shift();
  }

  if (children[0]?.type === "break") {
    children.shift();
  }

  const nextParagraph = children.length > 0 ? { ...paragraph, children } : null;
  return { alertType: alertType as (typeof ALERT_TYPES)[number], paragraph: nextParagraph };
}

function supportsAlignmentAttr(nodeType: { spec?: { attrs?: Record<string, unknown> } }): boolean {
  const attrs = nodeType.spec?.attrs;
  return Boolean(attrs && "alignment" in attrs);
}
