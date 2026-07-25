/**
 * Footnote-definition PM → mdast converter.
 *
 * Purpose: hold the one converter that recurses through the shared context, so
 * `pmBlockConverters.ts` stays under its frozen size baseline.
 *
 * It lives apart from the other block converters only for that reason — it is
 * an ordinary registry-2 entry (ADR-015 D2) like every other node type. It was
 * the last arm handled inline on PMToMdastConverter; extracting it made
 * `convertNode` pure dispatch.
 *
 * @coordinates-with pmConverters.registry.ts — registers this converter
 * @module utils/markdownPipeline/pmFootnoteConverters
 */
import type { Node as PMNode } from "@tiptap/pm/model";
import type { BlockContent } from "mdast";
import type { FootnoteDefinition } from "./types";
import type { PmToMdastContext } from "./pmBlockConverters";

/**
 * Convert a footnote definition, recursing through the shared context.
 *
 * Extracted from PMToMdastConverter so it can live in registry 2 like every
 * other node; it was the last arm handled inline (ADR-015 D2).
 */
export function convertFootnoteDefinition(
  context: PmToMdastContext,
  node: PMNode,
): FootnoteDefinition {
  const children: BlockContent[] = [];
  node.forEach((child) => {
    const converted = context.convertNode(child);
    /* v8 ignore next -- @preserve convertNode returns null for unrecognized node types */
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
