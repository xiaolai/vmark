/**
 * MDAST Block Node Converters
 *
 * Purpose: Converts block-level MDAST nodes (headings, code, lists, tables, math,
 * definitions, frontmatter, wiki links, footnotes, TOC) to ProseMirror nodes, and
 * re-exports the media (mdastMediaConverters.ts) and container
 * (mdastContainerConverters.ts) converters so this file stays the single public
 * import path. Split from mdastToProseMirror.ts for size.
 *
 * Key decisions:
 *   - Each converter is a pure function taking a context object — no class state
 *   - sourceLine attributes are extracted from MDAST positions for cursor sync
 *   - MATH_BLOCK_LANGUAGE sentinel stores math blocks as codeBlock with a special
 *     language value, since PM schema doesn't have a dedicated math block node
 *   - TOC nodes are converted from `toc` MDAST type to atom PM nodes
 *
 * @coordinates-with mdastConverterHelpers.ts — shared context type and helpers
 * @coordinates-with mdastMediaConverters.ts — paragraph/HTML media promotion
 * @coordinates-with mdastContainerConverters.ts — blockquote/alert/details converters
 * @coordinates-with mdastInlineConverters.ts — handles inline content within blocks
 * @coordinates-with mdastToProseMirror.ts — orchestrates block + inline conversion
 * @coordinates-with pmBlockConverters.ts — reverse direction (PM → MDAST)
 * @module utils/markdownPipeline/mdastBlockConverters
 */

import type { Node as PMNode, Mark } from "@tiptap/pm/model";
import type {
  Code,
  Content,
  Definition,
  Heading,
  List,
  ListItem,
  Table,
  ThematicBreak,
} from "mdast";
import type { Math } from "mdast-util-math";
import type { Toc, WikiLink, Yaml } from "./types";
import {
  ensureNonEmptyBlocks,
  getSourceLine,
  mdastTextContent,
  type MdastToPmContext,
} from "./mdastConverterHelpers";

export type { ContentContext, MdastToPmContext } from "./mdastConverterHelpers";
export { convertParagraph, convertHtml } from "./mdastMediaConverters";
export {
  convertBlockquote,
  convertDetails,
  convertAlert,
  convertAlertBlockquote,
} from "./mdastContainerConverters";

export function convertHeading(
  context: MdastToPmContext,
  node: Heading,
  marks: Mark[]
): PMNode | null {
  const type = context.schema.nodes.heading;
  if (!type) return null;
  const children = context.convertChildren(node.children as Content[], marks, "inline");
  // Extract heading text for ID generation — recursive, so text nested in
  // emphasis/strong/links/inline code is included.
  const headingText = node.children.map(mdastTextContent).join("");
  const id = context.generateHeadingId?.(headingText) ?? null;
  return type.create({ level: node.depth, sourceLine: getSourceLine(node), id }, children);
}

export function convertCode(context: MdastToPmContext, node: Code): PMNode | null {
  const type = context.schema.nodes.codeBlock;
  if (!type) return null;

  const text = node.value ? context.schema.text(node.value) : null;
  return type.create({ language: node.lang || null, sourceLine: getSourceLine(node) }, text ? [text] : []);
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

  // Guard: a listItem with 0 children is structurally invalid (schema: "block+")
  // and causes DOM/serialization bugs. Insert an empty paragraph as fallback.
  const children = ensureNonEmptyBlocks(
    context.convertChildren(node.children, marks, "block"),
    context.schema
  );

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

export function convertToc(context: MdastToPmContext, node: Toc): PMNode | null {
  const type = context.schema.nodes.toc;
  if (!type) return null;
  return type.create({ sourceLine: getSourceLine(node) });
}

function supportsAlignmentAttr(nodeType: { spec?: { attrs?: Record<string, unknown> } }): boolean {
  const attrs = nodeType.spec?.attrs;
  return Boolean(attrs && "alignment" in attrs);
}
