/**
 * ProseMirror Inline Content Converters (PM → MDAST)
 *
 * Purpose: Converts ProseMirror text nodes with marks and inline atom nodes
 * to MDAST phrasing content for markdown serialization.
 *
 * Key decisions:
 *   - Marks are converted by wrapping: innermost mark wraps text first,
 *     then outer marks wrap that result — producing nested MDAST nodes
 *   - URLs are passed through unchanged; the serializer's custom handlers
 *     add angle brackets for URLs with spaces
 *   - Inline code mark collapses children to a single string value
 *     (MDAST inlineCode has no children, just a value)
 *
 * @coordinates-with mdastInlineConverters.ts — reverse direction (MDAST → PM)
 * @coordinates-with pmBlockConverters.ts — handles block-level nodes
 * @coordinates-with serializer.ts — custom handlers for URL formatting
 * @module utils/markdownPipeline/pmInlineConverters
 */

import type { Node as PMNode, Mark } from "@tiptap/pm/model";
import type {
  Text,
  Strong,
  Emphasis,
  Delete,
  InlineCode,
  Link,
  Image,
  Break,
  PhrasingContent,
} from "mdast";
import type { InlineMath } from "mdast-util-math";
import type {
  Subscript,
  Superscript,
  Highlight,
  Underline,
  FootnoteReference,
} from "./types";
import { mdPipelineWarn } from "@/utils/debug";

/**
 * Convert a text node with marks to nested MDAST inline nodes.
 */
export function convertTextWithMarks(node: PMNode): PhrasingContent[] {
  const text = node.text || "";
  if (!text) return [];

  const marks = node.marks;
  if (!marks.length) {
    return [{ type: "text", value: text } as Text];
  }

  // Build nested structure from marks
  // Start with text node, wrap with marks from innermost to outermost
  let content: PhrasingContent[] = [{ type: "text", value: text } as Text];

  for (const mark of marks) {
    content = wrapWithMark(content, mark);
  }

  return content;
}

/**
 * Wrap content with an MDAST mark node.
 */
export function wrapWithMark(content: PhrasingContent[], mark: Mark): PhrasingContent[] {
  const markName = mark.type.name;

  switch (markName) {
    case "bold":
      return [{ type: "strong", children: content } as Strong];
    case "italic":
      return [{ type: "emphasis", children: content } as Emphasis];
    case "strike":
      return [{ type: "delete", children: content } as Delete];
    case "code": {
      // Inline code wraps text directly
      const textContent = content
        .filter((c): c is Text => c.type === "text")
        .map((t) => t.value)
        .join("");
      return [{ type: "inlineCode", value: textContent } as InlineCode];
    }
    case "link":
      return [
        {
          type: "link",
          url: mark.attrs.href as string,
          children: content,
        } as Link,
      ];

    // Custom inline marks
    case "subscript":
      return [{ type: "subscript", children: content } as Subscript];
    case "superscript":
      return [{ type: "superscript", children: content } as Superscript];
    case "highlight":
      return [{ type: "highlight", children: content } as Highlight];
    case "underline":
      return [{ type: "underline", children: content } as Underline];

    default:
      // Unknown mark - return content as-is
      mdPipelineWarn(`Unknown mark type: ${markName}`);
      return content;
  }
}

/**
 * Convert a hard break to MDAST break.
 */
export function convertHardBreak(): Break {
  return { type: "break" };
}

/**
 * Convert an image node to MDAST image.
 */
export function convertImage(node: PMNode): Image {
  return {
    type: "image",
    url: node.attrs.src as string,
    alt: (node.attrs.alt as string) || undefined,
    title: (node.attrs.title as string) || undefined,
  };
}

/**
 * Convert an inline math node to MDAST inline math.
 * Uses the content attribute (atom node approach).
 */
export function convertMathInline(node: PMNode): InlineMath {
  return {
    type: "inlineMath",
    // Use content attribute for atom nodes, fallback to textContent for backwards compatibility
    value: (node.attrs.content as string) || node.textContent,
  };
}

/**
 * Convert a footnote reference node to MDAST footnote reference.
 */
export function convertFootnoteReference(node: PMNode): FootnoteReference {
  return {
    type: "footnoteReference",
    identifier: String(node.attrs.label ?? "1"),
    label: String(node.attrs.label ?? "1"),
  };
}
