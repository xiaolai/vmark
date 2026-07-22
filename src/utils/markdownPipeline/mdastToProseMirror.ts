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
  Html,
  Text,
} from "mdast";
import { perfStart, perfEnd } from "@/utils/perfLog";
import { escapeHtml } from "@/utils/sanitize";
import {
  type ContentContext,
  type MdastToPmContext,
} from "./mdastBlockConverters";
import { generateSlug, makeUniqueSlug } from "@/utils/headingSlug";
import { mdPipelineWarn } from "@/utils/debug";
import {
  createMdastRegistry,
  tryMdastRegistry,
  type MdastRegistry,
} from "./mdastConverters.registry";
import { convertTopLevelWithBlankLines } from "./blankLineCapture";

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
  private context: MdastToPmContext;
  private usedSlugs = new Set<string>();

  /** Registry 2, mdast → PM direction (ADR-015 D2). Owns all node dispatch. */
  private readonly registry: MdastRegistry = createMdastRegistry();

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

  /** Convert root to a PM doc; top-level conversion also captures inter-block
   *  blank-line runs into blankLinesBefore (see blankLineCapture.ts). */
  convertRoot(root: Root): PMNode {
    perfStart("convertRoot:convertChildren");
    const topChildren = convertTopLevelWithBlankLines(root, (c) => this.convertNode(c, [], "block"));
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

    const viaRegistry = tryMdastRegistry(this.registry, nodeType, {
      node,
      marks,
      position: context,
      schema: this.schema,
      ctx: this.context,
      convertInlineChildren,
    });
    if (viaRegistry.handled) return viaRegistry.result;

    mdPipelineWarn(`[MdastToPM] Unknown node type: ${nodeType}`);
    return null;
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
