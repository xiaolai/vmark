/**
 * MDAST Inline Node Converters
 *
 * Purpose: Converts inline MDAST nodes (text, emphasis, strong, links, images, etc.)
 * to ProseMirror nodes/marks. Split from mdastToProseMirror.ts for 300-line limit.
 *
 * Key decisions:
 *   - Mark-based nodes (bold, italic, etc.) accumulate marks via `newMarks` array
 *     passed down to children, producing flat PM text with stacked marks
 *   - URLs are validated via isSafeUrl() to prevent XSS — unsafe URLs become about:blank
 *   - Missing mark types in schema are gracefully handled by falling through
 *     to convertChildren without adding the mark (schema flexibility)
 *
 * @coordinates-with mdastBlockConverters.ts — handles block-level nodes
 * @coordinates-with pmInlineConverters.ts — reverse direction (PM → MDAST)
 * @coordinates-with urlValidation.ts — URL safety checks for links and images
 * @module utils/markdownPipeline/mdastInlineConverters
 */

import type { Schema, Node as PMNode, Mark } from "@tiptap/pm/model";
import type {
  Content,
  Text,
  Strong,
  Emphasis,
  Delete,
  InlineCode,
  Link,
  Image,
  FootnoteReference,
} from "mdast";
import type { InlineMath } from "mdast-util-math";
import type { Subscript, Superscript, Highlight, Underline } from "./types";
import { isSafeUrl } from "./urlValidation";

/**
 * Helper type for converter functions.
 */
export type InlineConverterFn<T> = (
  schema: Schema,
  node: T,
  marks: Mark[],
  convertChildren: (children: readonly Content[], marks: Mark[]) => PMNode[]
) => PMNode | PMNode[] | null;

/**
 * Convert a text node to ProseMirror text.
 */
export function convertText(schema: Schema, node: Text, marks: Mark[]): PMNode | null {
  if (!node.value) return null;
  return schema.text(node.value, marks);
}

/**
 * Convert strong (bold) node.
 */
export function convertStrong(
  schema: Schema,
  node: Strong,
  marks: Mark[],
  convertChildren: (children: readonly Content[], marks: Mark[]) => PMNode[]
): PMNode[] {
  const markType = schema.marks.bold;
  if (!markType) {
    return convertChildren(node.children as Content[], marks);
  }
  const newMarks = [...marks, markType.create()];
  return convertChildren(node.children as Content[], newMarks);
}

/**
 * Convert emphasis (italic) node.
 */
export function convertEmphasis(
  schema: Schema,
  node: Emphasis,
  marks: Mark[],
  convertChildren: (children: readonly Content[], marks: Mark[]) => PMNode[]
): PMNode[] {
  const markType = schema.marks.italic;
  if (!markType) {
    return convertChildren(node.children as Content[], marks);
  }
  const newMarks = [...marks, markType.create()];
  return convertChildren(node.children as Content[], newMarks);
}

/**
 * Convert delete (strikethrough) node.
 */
export function convertDelete(
  schema: Schema,
  node: Delete,
  marks: Mark[],
  convertChildren: (children: readonly Content[], marks: Mark[]) => PMNode[]
): PMNode[] {
  const markType = schema.marks.strike;
  if (!markType) {
    return convertChildren(node.children as Content[], marks);
  }
  const newMarks = [...marks, markType.create()];
  return convertChildren(node.children as Content[], newMarks);
}

/**
 * Convert inline code node.
 */
export function convertInlineCode(
  schema: Schema,
  node: InlineCode,
  marks: Mark[]
): PMNode | null {
  const markType = schema.marks.code;
  if (!markType) {
    return schema.text(node.value, marks);
  }
  const newMarks = [...marks, markType.create()];
  return schema.text(node.value, newMarks);
}

/**
 * Convert link node with URL validation.
 */
export function convertLink(
  schema: Schema,
  node: Link,
  marks: Mark[],
  convertChildren: (children: readonly Content[], marks: Mark[]) => PMNode[]
): PMNode[] {
  const markType = schema.marks.link;
  if (!markType) {
    return convertChildren(node.children as Content[], marks);
  }
  // Validate URL scheme to prevent XSS
  const href = isSafeUrl(node.url) ? node.url : "about:blank";
  const newMarks = [...marks, markType.create({ href })];
  return convertChildren(node.children as Content[], newMarks);
}

/**
 * Convert image node with URL validation.
 */
export function convertImage(schema: Schema, node: Image): PMNode | null {
  const type = schema.nodes.image;
  if (!type) return null;

  // Validate URL scheme to prevent XSS
  const src = isSafeUrl(node.url) ? node.url : "about:blank";
  return type.create({
    src,
    alt: node.alt || null,
    title: node.title || null,
  });
}

/**
 * Convert hard break node.
 */
export function convertBreak(schema: Schema): PMNode | null {
  const type = schema.nodes.hardBreak;
  if (!type) return null;
  return type.create();
}

/**
 * Convert inline math node.
 * Creates an atom node with the math content stored as an attribute.
 */
export function convertInlineMath(schema: Schema, node: InlineMath): PMNode | null {
  const type = schema.nodes.math_inline;
  if (!type) return null;

  // Store content as an attribute (atom node approach)
  return type.create({ content: node.value || "" });
}

/**
 * Convert footnote reference node.
 */
export function convertFootnoteReference(
  schema: Schema,
  node: FootnoteReference
): PMNode | null {
  const type = schema.nodes.footnote_reference;
  if (!type) return null;

  return type.create({ label: node.identifier });
}

/**
 * Convert subscript node.
 */
export function convertSubscript(
  schema: Schema,
  node: Subscript,
  marks: Mark[],
  convertChildren: (children: readonly Content[], marks: Mark[]) => PMNode[]
): PMNode[] {
  const markType = schema.marks.subscript;
  if (!markType) {
    return convertChildren(node.children as Content[], marks);
  }
  const newMarks = [...marks, markType.create()];
  return convertChildren(node.children as Content[], newMarks);
}

/**
 * Convert superscript node.
 */
export function convertSuperscript(
  schema: Schema,
  node: Superscript,
  marks: Mark[],
  convertChildren: (children: readonly Content[], marks: Mark[]) => PMNode[]
): PMNode[] {
  const markType = schema.marks.superscript;
  if (!markType) {
    return convertChildren(node.children as Content[], marks);
  }
  const newMarks = [...marks, markType.create()];
  return convertChildren(node.children as Content[], newMarks);
}

/**
 * Convert highlight node.
 */
export function convertHighlight(
  schema: Schema,
  node: Highlight,
  marks: Mark[],
  convertChildren: (children: readonly Content[], marks: Mark[]) => PMNode[]
): PMNode[] {
  const markType = schema.marks.highlight;
  if (!markType) {
    return convertChildren(node.children as Content[], marks);
  }
  const newMarks = [...marks, markType.create()];
  return convertChildren(node.children as Content[], newMarks);
}

/**
 * Convert underline node.
 */
export function convertUnderline(
  schema: Schema,
  node: Underline,
  marks: Mark[],
  convertChildren: (children: readonly Content[], marks: Mark[]) => PMNode[]
): PMNode[] {
  const markType = schema.marks.underline;
  if (!markType) {
    return convertChildren(node.children as Content[], marks);
  }
  const newMarks = [...marks, markType.create()];
  return convertChildren(node.children as Content[], newMarks);
}
