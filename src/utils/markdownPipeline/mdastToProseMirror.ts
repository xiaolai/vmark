/**
 * MDAST to ProseMirror Conversion — Orchestrator
 *
 * Purpose: Converts a complete MDAST tree to a ProseMirror document by dispatching
 * each node type to the appropriate converter (block or inline).
 *
 * Pipeline: MDAST root → MdastToPMConverter.convertRoot() → PM doc node
 *
 * Key decisions:
 *   - Uses a class (MdastToPMConverter) to hold per-document state like usedSlugs
 *     for heading ID uniqueness, but converter functions are pure/stateless
 *   - Inline HTML tags are merged (mergeInlineHtmlTags) so that paired open/close
 *     tags like `<kbd>...</kbd>` become a single html_inline node — but only when
 *     inner content has no formatting marks (otherwise marks would be lost)
 *   - Schema is passed in (not imported) to keep this layer framework-free
 *   - TOC nodes (`toc` type) are dispatched to convertToc from mdastBlockConverters
 *
 * @coordinates-with mdastBlockConverters.ts — block node conversion functions
 * @coordinates-with mdastInlineConverters.ts — inline node conversion functions
 * @coordinates-with proseMirrorToMdast.ts — reverse direction
 * @module utils/markdownPipeline/mdastToProseMirror
 */

import type { Schema, Node as PMNode, Mark } from "@tiptap/pm/model";
import type {
  Root,
  Content,
  Paragraph,
  Heading,
  Code,
  Definition,
  Blockquote,
  List,
  ListItem,
  Table,
  ThematicBreak,
  Html,
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
import { perfStart, perfEnd } from "@/utils/perfLog";
import type { InlineMath, Math } from "mdast-util-math";
import type {
  Alert,
  Details,
  Subscript,
  Superscript,
  Highlight,
  Underline,
  WikiLink,
  Yaml,
} from "./types";
import * as inlineConverters from "./mdastInlineConverters";
import { escapeHtml } from "@/utils/sanitize";
import {
  convertAlert,
  convertBlockquote,
  convertCode,
  convertDefinition,
  convertDetails,
  convertFootnoteDefinition,
  convertFrontmatter,
  convertHeading,
  convertHtml,
  convertList,
  convertListItem,
  convertMathBlock,
  convertParagraph,
  convertTable,
  convertThematicBreak,
  convertToc,
  convertWikiLink,
  type ContentContext,
  type MdastToPmContext,
} from "./mdastBlockConverters";
import { generateSlug, makeUniqueSlug } from "@/utils/headingSlug";
import { mdPipelineWarn } from "@/utils/debug";

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
/** Maximum captured blank-line run (ADR-6) — guards against a pathological file. */
export const MAX_BLANK_LINES = 10;

/**
 * Number of blank lines to capture before a block, or null to inherit the
 * serializer's default. Returns null for a missing position, and for runs of
 * 0 or 1 (the ordinary single-separator case the serializer already produces),
 * so only "extra" runs are recorded. Clamped to MAX_BLANK_LINES.
 */
function captureBlankLinesBefore(
  prevEndLine: number | null,
  startLine: number | undefined,
): number | null {
  if (prevEndLine === null || typeof startLine !== "number") return null;
  const gap = startLine - prevEndLine - 1;
  if (gap <= 1) return null;
  return Math.min(gap, MAX_BLANK_LINES);
}

/**
 * Return a copy of `node` carrying the blankLinesBefore attribute. Silently a
 * no-op on nodes whose schema doesn't declare the attr (PM's computeAttrs
 * ignores undeclared keys), so it's safe to call on any block type.
 */
function withBlankLinesBefore(node: PMNode, n: number): PMNode {
  return node.type.create({ ...node.attrs, blankLinesBefore: n }, node.content, node.marks);
}

export function mdastToProseMirror(schema: Schema, mdast: Root): PMNode {
  const converter = new MdastToPMConverter(schema);
  return converter.convertRoot(mdast);
}

/**
 * Internal converter class that maintains schema context.
 */
class MdastToPMConverter {
  private context: MdastToPmContext;
  private usedSlugs = new Set<string>();

  constructor(private schema: Schema) {
    this.context = {
      schema,
      convertChildren: this.convertChildren.bind(this),
      generateHeadingId: this.generateHeadingId.bind(this),
    };
  }

  /**
   * Generate a unique heading ID from text.
   * Tracks used slugs to ensure uniqueness within the document.
   */
  private generateHeadingId(text: string): string | null {
    const baseSlug = generateSlug(text);
    if (!baseSlug) return null;
    const uniqueSlug = makeUniqueSlug(baseSlug, this.usedSlugs);
    this.usedSlugs.add(uniqueSlug);
    return uniqueSlug;
  }

  /**
   * Convert root node to ProseMirror doc.
   *
   * Captures inter-block blank-line runs (>1) into a `blankLinesBefore`
   * attribute on the following top-level block (WI-1.2). Capture is
   * UNCONDITIONAL (ADR-4) — whether it is re-emitted is decided at serialize
   * time by the preserveBlankLines option — so toggling the setting needs no
   * reparse. Runs of 0/1 blank lines are left null (the serializer's default),
   * and long runs clamp to MAX_BLANK_LINES (ADR-6). Blocks come straight from
   * the parser here (list normalization is a parser-side remark plugin), so the
   * positions reflect the normalized source; the >1 threshold keeps ordinary
   * separators untouched. Per-child iteration (not batch convertChildren)
   * preserves behavior — block context does no inline normalization — while
   * giving each mdast child's position for the gap.
   */
  convertRoot(root: Root): PMNode {
    perfStart("convertRoot:convertChildren");
    const topChildren: PMNode[] = [];
    let prevEndLine: number | null = null;
    for (const child of root.children) {
      const converted = this.convertNode(child, [], "block");
      const nodes = converted ? (Array.isArray(converted) ? converted : [converted]) : [];
      if (nodes.length > 0) {
        const captured = captureBlankLinesBefore(prevEndLine, child.position?.start?.line);
        if (captured !== null) {
          nodes[0] = withBlankLinesBefore(nodes[0], captured);
        }
      }
      const endLine = child.position?.end?.line;
      if (typeof endLine === "number") prevEndLine = endLine;
      topChildren.push(...nodes);
    }
    perfEnd("convertRoot:convertChildren", { childCount: topChildren.length });

    perfStart("convertRoot:createDoc");
    const doc = this.schema.topNodeType.create(null, topChildren);
    perfEnd("convertRoot:createDoc", { docSize: doc.content.size });
    return doc;
  }

  /**
   * Convert array of MDAST children to ProseMirror nodes.
   * Accepts Content[] or PhrasingContent[] (inline content).
   */
  convertChildren(
    children: readonly Content[],
    marks: Mark[],
    context: ContentContext
  ): PMNode[] {
    const result: PMNode[] = [];
    const normalizedChildren = context === "inline" ? mergeInlineHtmlTags(children) : children;
    for (const child of normalizedChildren) {
      const converted = this.convertNode(child, marks, context);
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
  private convertNode(
    node: Content,
    marks: Mark[],
    context: "block" | "inline"
  ): PMNode | PMNode[] | null {
    // Use type assertion for node.type to handle custom types not in base Content union
    const nodeType = node.type as string;
    const convertInlineChildren = (children: readonly Content[], nextMarks: Mark[]) =>
      this.convertChildren(children, nextMarks, "inline");

    switch (nodeType) {
      // Block nodes
      case "paragraph":
        return convertParagraph(this.context, node as Paragraph, marks);
      case "heading":
        return convertHeading(this.context, node as Heading, marks);
      case "code":
        return convertCode(this.context, node as Code);
      case "blockquote":
        return convertBlockquote(this.context, node as Blockquote, marks);
      case "list":
        return convertList(this.context, node as List, marks);
      case "listItem":
        return convertListItem(this.context, node as ListItem, marks);
      case "thematicBreak":
        return convertThematicBreak(this.context, node as ThematicBreak);
      case "table":
        return convertTable(this.context, node as Table, marks);
      case "math":
        return convertMathBlock(this.context, node as Math);
      case "definition":
        return convertDefinition(this.context, node as Definition);
      case "toc":
        return convertToc(this.context, node as unknown as import("./types").Toc);
      case "details":
        return convertDetails(this.context, node as Details, marks);

      // Inline nodes - delegated to inline converters
      case "text":
        return inlineConverters.convertText(this.schema, node as Text, marks);
      case "strong":
        return inlineConverters.convertStrong(this.schema, node as Strong, marks, convertInlineChildren);
      case "emphasis":
        return inlineConverters.convertEmphasis(this.schema, node as Emphasis, marks, convertInlineChildren);
      case "delete":
        return inlineConverters.convertDelete(this.schema, node as Delete, marks, convertInlineChildren);
      case "inlineCode":
        return inlineConverters.convertInlineCode(this.schema, node as InlineCode, marks);
      case "link":
        return inlineConverters.convertLink(this.schema, node as Link, marks, convertInlineChildren);
      case "image":
        return inlineConverters.convertImage(this.schema, node as Image);
      case "break":
        return inlineConverters.convertBreak(this.schema);

      // Custom inline marks
      case "subscript":
        return inlineConverters.convertSubscript(this.schema, node as unknown as Subscript, marks, convertInlineChildren);
      case "superscript":
        return inlineConverters.convertSuperscript(this.schema, node as unknown as Superscript, marks, convertInlineChildren);
      case "highlight":
        return inlineConverters.convertHighlight(this.schema, node as unknown as Highlight, marks, convertInlineChildren);
      case "underline":
        return inlineConverters.convertUnderline(this.schema, node as unknown as Underline, marks, convertInlineChildren);

      // Custom nodes
      case "inlineMath":
        return inlineConverters.convertInlineMath(this.schema, node as unknown as InlineMath);
      case "footnoteReference":
        return inlineConverters.convertFootnoteReference(this.schema, node as unknown as FootnoteReference);
      case "footnoteDefinition":
        return convertFootnoteDefinition(this.context, node as unknown as FootnoteDefinition, marks);
      case "wikiLink":
        return convertWikiLink(this.context, node as unknown as WikiLink);
      case "alert":
        return convertAlert(this.context, node as Alert, marks);
      case "html":
        return convertHtml(this.context, node as Html, context === "inline");

      case "yaml":
        return convertFrontmatter(this.context, node as Yaml);

      default:
        // Unknown node type - skip with warning in dev
        mdPipelineWarn(`[MdastToPM] Unknown node type: ${nodeType}`);
        return null;
    }
  }
}

const INLINE_HTML_OPEN_RE = /^<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>$/;
const INLINE_HTML_CLOSE_RE = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>$/;

/**
 * Check if inner nodes contain only text, html, and break nodes.
 * If there are formatting nodes (emphasis, strong, link, etc.), we should not merge
 * as merging would lose their marks.
 */
function canSafelyMerge(nodes: Content[]): boolean {
  for (const node of nodes) {
    if (node.type !== "text" && node.type !== "html" && node.type !== "break") {
      return false;
    }
  }
  return true;
}

function mergeInlineHtmlTags(children: readonly Content[]): Content[] {
  const result: Content[] = [];

  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    if (node.type !== "html") {
      result.push(node);
      continue;
    }

    const openTag = parseInlineHtmlOpen(node.value ?? "");
    if (!openTag) {
      result.push(node);
      continue;
    }

    let depth = 1;
    const innerNodes: Content[] = [];
    let closeIndex = -1;

    for (let cursor = index + 1; cursor < children.length; cursor += 1) {
      const next = children[cursor];
      if (next.type === "html") {
        const nextValue = String(next.value ?? "");
        if (isInlineHtmlOpen(nextValue, openTag)) {
          depth += 1;
          innerNodes.push(next);
          continue;
        }
        if (isInlineHtmlClose(nextValue, openTag)) {
          depth -= 1;
          if (depth === 0) {
            closeIndex = cursor;
            break;
          }
          innerNodes.push(next);
          continue;
        }
      }
      innerNodes.push(next);
    }

    if (closeIndex !== -1) {
      // Only merge if inner nodes don't contain formatting marks
      // Otherwise, merging would lose emphasis, links, etc.
      if (!canSafelyMerge(innerNodes)) {
        result.push(node);
        continue;
      }
      const closeNode = children[closeIndex] as Html;
      // v8 ignore next -- @preserve reason: node.value and closeNode.value are always strings here — parseInlineHtmlOpen and isInlineHtmlClose require non-null values to match; the ?? "" branches are structurally unreachable
      const mergedValue = `${String(node.value ?? "")}${serializeInlineHtmlNodes(innerNodes)}${String(closeNode.value ?? "")}`;
      result.push({ type: "html", value: mergedValue } as Html);
      index = closeIndex;
      continue;
    }

    result.push(node);
  }

  return result;
}

function parseInlineHtmlOpen(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("<") || trimmed.startsWith("</") || trimmed.endsWith("/>")) {
    return null;
  }
  const match = trimmed.match(INLINE_HTML_OPEN_RE);
  return match ? match[1].toLowerCase() : null;
}

function isInlineHtmlOpen(value: string, tagName: string): boolean {
  const openTag = parseInlineHtmlOpen(value);
  return openTag === tagName.toLowerCase();
}

function isInlineHtmlClose(value: string, tagName: string): boolean {
  const match = value.trim().match(INLINE_HTML_CLOSE_RE);
  return match ? match[1].toLowerCase() === tagName.toLowerCase() : false;
}

function serializeInlineHtmlNodes(nodes: Content[]): string {
  let value = "";
  for (const node of nodes) {
    value += serializeInlineHtmlNode(node);
  }
  return value;
}

function serializeInlineHtmlNode(node: Content): string {
  switch (node.type) {
    case "text":
      return escapeHtml((node as Text).value ?? "");
    case "html":
      return String((node as Html).value ?? "");
    case "break":
      return "<br>";
    // v8 ignore next 5 -- @preserve reason: canSafelyMerge() only allows text/html/break into the merge path; a non-text/html/break node (with or without children) can never reach serializeInlineHtmlNode
    default:
      if ("children" in node && Array.isArray(node.children)) {
        return serializeInlineHtmlNodes(node.children as Content[]);
      }
      return "";
  }
}
