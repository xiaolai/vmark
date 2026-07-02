/**
 * MDAST Converter Shared Helpers
 *
 * Purpose: Shared context type and small helpers used by the MDAST → ProseMirror
 * block converter files. Split from mdastBlockConverters.ts for size.
 *
 * Key decisions:
 *   - MdastToPmContext carries the schema plus a convertChildren callback so each
 *     converter stays a pure function with no class state
 *   - getSourceLine extracts sourceLine attributes from MDAST positions for cursor sync
 *   - ensureNonEmptyBlocks guards container nodes (blockquotes, list items,
 *     alerts, details) whose schema requires at least one block child
 *   - mdastTextContent recursively extracts subtree text (used for heading IDs)
 *
 * @coordinates-with mdastBlockConverters.ts — core block converters (re-export hub)
 * @coordinates-with mdastMediaConverters.ts — paragraph/HTML media promotion
 * @coordinates-with mdastContainerConverters.ts — blockquote/alert/details converters
 * @module utils/markdownPipeline/mdastConverterHelpers
 */

import type { Schema, Node as PMNode, Mark } from "@tiptap/pm/model";
import type { Content } from "mdast";

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
export function getSourceLine(node: { position?: { start?: { line?: number } } }): number | null {
  return node.position?.start?.line ?? null;
}

/**
 * Ensure block content is non-empty by adding an empty paragraph if needed.
 * Many block elements (blockquotes, list items, alerts, details) require at
 * least one child ("block+").
 */
export function ensureNonEmptyBlocks(children: PMNode[], schema: Schema): PMNode[] {
  if (children.length === 0 && schema.nodes.paragraph) {
    return [schema.nodes.paragraph.create()];
  }
  return children;
}

/**
 * Recursively concatenate the text content of an MDAST subtree, so nested
 * phrasing (emphasis, strong, links, inline code) contributes its text.
 * Structurally typed so it accepts any MDAST content union (including
 * project-specific phrasing extensions).
 */
export function mdastTextContent(node: unknown): string {
  if (node === null || typeof node !== "object") return "";
  const n = node as { value?: unknown; children?: unknown };
  if (typeof n.value === "string") return n.value;
  if (Array.isArray(n.children)) return n.children.map(mdastTextContent).join("");
  return "";
}
