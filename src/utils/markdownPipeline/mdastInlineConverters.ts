/**
 * MDAST Inline Node Converters
 *
 * Purpose: Converts inline MDAST nodes (text, emphasis, strong, links, images, etc.)
 * to ProseMirror nodes/marks. Split from mdastToProseMirror.ts for 300-line limit.
 *
 * Key decisions:
 *   - Mark-based nodes (bold, italic, etc.) accumulate marks via `newMarks` array
 *     passed down to children, producing flat PM text with stacked marks
 *   - Same-type marks are never stacked twice (addMarkOnce) — nested identical
 *     emphasis is legal CommonMark but must collapse to one mark (#1102)
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
 * Convert a text node to ProseMirror text.
 */
export function convertText(schema: Schema, node: Text, marks: Mark[]): PMNode | null {
  if (!node.value) return null;
  return schema.text(node.value, marks);
}

/**
 * Append a mark unless one of the same type is already active.
 *
 * CommonMark allows nested identical emphasis — `**a **b** c**` parses as
 * strong inside strong. Stacking `bold` twice on the inner text prevents
 * ProseMirror from merging the run with its neighbors, and the split then
 * re-serializes as growing `**` runs on every save (#1102).
 */
function addMarkOnce(marks: Mark[], mark: Mark): Mark[] {
  return marks.some((m) => m.type === mark.type) ? marks : [...marks, mark];
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
  const newMarks = addMarkOnce(marks, markType.create());
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
  const newMarks = addMarkOnce(marks, markType.create());
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
  const newMarks = addMarkOnce(marks, markType.create());
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
  // Empty code spans cannot become PM text nodes — schema.text("") throws.
  if (!node.value) return null;
  const markType = schema.marks.code;
  if (!markType) {
    return schema.text(node.value, marks);
  }
  const newMarks = addMarkOnce(marks, markType.create());
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
  const linkMark = markType.create({ href });
  // Unlike identical emphasis (where the duplicate is simply dropped), a
  // nested link carries data — and the inner link binds in CommonMark — so
  // replace an active link mark instead of keeping the outer href.
  const newMarks = marks.some((m) => m.type === markType)
    ? marks.map((m) => (m.type === markType ? linkMark : m))
    : [...marks, linkMark];
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
  const newMarks = addMarkOnce(marks, markType.create());
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
  const newMarks = addMarkOnce(marks, markType.create());
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
  const newMarks = addMarkOnce(marks, markType.create());
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
  const newMarks = addMarkOnce(marks, markType.create());
  return convertChildren(node.children as Content[], newMarks);
}
