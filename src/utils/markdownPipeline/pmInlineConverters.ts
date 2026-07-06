/**
 * ProseMirror Inline Content Converters (PM → MDAST)
 *
 * Purpose: Converts ProseMirror text nodes with marks and inline atom nodes
 * to MDAST phrasing content for markdown serialization.
 *
 * Key decisions:
 *   - Marks are converted by wrapping the text node from innermost to
 *     outermost — producing nested MDAST nodes
 *   - Consecutive inline items sharing a mark are grouped under a single
 *     MDAST wrapper (groupInlineItems). Wrapping each PM text node's marks
 *     independently would emit adjacent emphasis siblings, which
 *     mdast-util-to-markdown renders as `&#x20;`-padded growing `**` runs
 *     that do not round-trip (#1102).
 *   - The `code` mark is always applied innermost, regardless of its
 *     position in the PM marks array. MDAST `inlineCode` is a leaf
 *     (no children), so applying it later against an already-wrapped
 *     node would discard the wrapper. Required for `[`text`](url)`
 *     where PM stores both `link` and `code` marks on the same text.
 *   - URLs are passed through unchanged; the serializer's custom handlers
 *     add angle brackets for URLs with spaces
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
 * A pre-converted inline leaf plus the marks still to be applied as nested
 * MDAST wrappers (innermost first — the last mark becomes the outermost).
 */
export interface InlineItem {
  content: PhrasingContent;
  marks: readonly Mark[];
}

/**
 * Marks eligible for wrapping: `code` is excluded (it becomes the
 * `inlineCode` leaf itself), and same-type duplicates are dropped so a
 * malformed doc can never re-grow emphasis runs on save (#1102).
 */
function factorableMarks(marks: readonly Mark[]): Mark[] {
  const seen = new Set<string>();
  const out: Mark[] = [];
  for (const mark of marks) {
    if (mark.type.name === "code" || seen.has(mark.type.name)) continue;
    seen.add(mark.type.name);
    out.push(mark);
  }
  return out;
}

/**
 * Convert a text node to an inline item with its leaf content pre-built.
 *
 * MDAST `inlineCode` is a leaf node (no children), so a `code` mark becomes
 * the leaf itself rather than a wrapper. Required for `[`text`](url)` where
 * PM stores both `link` and `code` marks on the same text.
 */
export function textToInlineItems(node: PMNode): InlineItem[] {
  const text = node.text || "";
  if (!text) return [];

  const isCode = node.marks.some((m) => m.type.name === "code");
  const content: PhrasingContent = isCode
    ? ({ type: "inlineCode", value: text } as InlineCode)
    : ({ type: "text", value: text } as Text);
  return [{ content, marks: factorableMarks(node.marks) }];
}

/** Length of the run of items starting at `start` that all carry `mark`. */
function markRunLength(
  items: readonly InlineItem[],
  start: number,
  mark: Mark,
): number {
  let end = start;
  while (end < items.length && items[end].marks.some((m) => m.eq(mark))) end++;
  return end - start;
}

/**
 * Group a flat sequence of inline items into nested MDAST phrasing content.
 *
 * Greedily factors out the mark whose run extends furthest, so consecutive
 * items sharing a mark serialize under one wrapper: `**a *b* c**` stays one
 * strong node instead of three adjacent strong siblings (#1102). On ties the
 * last mark wins, preserving the historical single-node nesting order.
 */
export function groupInlineItems(items: readonly InlineItem[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let i = 0;
  while (i < items.length) {
    const { content, marks } = items[i];
    if (!marks.length) {
      out.push(content);
      i++;
      continue;
    }
    let best = marks[marks.length - 1];
    let bestLen = 0;
    for (let k = marks.length - 1; k >= 0; k--) {
      const len = markRunLength(items, i, marks[k]);
      if (len > bestLen) {
        best = marks[k];
        bestLen = len;
      }
    }
    const inner: InlineItem[] = [];
    for (let j = i; j < i + bestLen; j++) {
      inner.push({
        content: items[j].content,
        marks: items[j].marks.filter((m) => !m.eq(best)),
      });
    }
    out.push(...wrapWithMark(groupInlineItems(inner), best));
    i += bestLen;
  }
  return out;
}

/**
 * Convert a single text node with marks to nested MDAST inline nodes.
 */
export function convertTextWithMarks(node: PMNode): PhrasingContent[] {
  return groupInlineItems(textToInlineItems(node));
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
