/**
 * Text-level mark parsing and the node predicates the walk shares.
 *
 * Purpose: the leaf half of the custom-inline transform — deciding what a node
 * IS (`isTextNode`, `isSkippableNode`) and turning the markers inside one text
 * value into mark nodes (`parseMarksInText`, `createMarkNode`).
 *
 * Split out of customInlineTransform.ts when making that file's walk iterative
 * (#1374) took it past the 300-line limit. This is the leaf side of the seam:
 * nothing here reaches back into the walk, so the dependency runs one way and
 * both the walk and the cross-sibling span logic can import it.
 *
 * @coordinates-with customInlineTransform.ts — the walk that calls these
 * @module utils/markdownPipeline/plugins/customInlineMarks
 */

import type { PhrasingContent, Text } from "mdast";
import type { Subscript, Superscript, Highlight, Underline } from "../types";
import { MARKS, findMarkPair, unescapeWhitespace, type MarkDefinition } from "./markPairing";

/** Node types whose contents are literal, so markers inside them are text. */
const SKIP_NODE_TYPES = new Set(["inlineCode", "code", "math", "inlineMath", "html", "yaml"]);

type MarkName = "subscript" | "superscript" | "highlight" | "underline";

export function isTextNode(node: unknown): node is Text {
  return typeof node === "object" && node !== null && (node as { type?: string }).type === "text";
}

export function isSkippableNode(node: unknown): boolean {
  /* v8 ignore next -- @preserve defensive null/type guard; MDAST nodes are always objects */
  if (!node || typeof node !== "object") return false;
  const type = (node as { type?: string }).type;
  return typeof type === "string" && SKIP_NODE_TYPES.has(type);
}


export function parseMarksInText(text: string): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  let position = 0;

  while (position < text.length) {
    // Find the earliest mark starting from current position
    let earliestMark: MarkDefinition | null = null;
    let earliestStart = -1;
    let earliestEnd = -1;

    for (const mark of MARKS) {
      const pair = findMarkPair(text, mark, position);
      if (pair && (earliestStart === -1 || pair.start < earliestStart)) {
        earliestMark = mark;
        earliestStart = pair.start;
        earliestEnd = pair.end;
      }
    }

    if (!earliestMark || earliestStart === -1) {
      // No more marks found, add remaining as text
      /* v8 ignore next -- @preserve while(position < text.length) guarantees this is always true */
      if (position < text.length) {
        result.push({ type: "text", value: text.slice(position) });
      }
      break;
    }

    // Add text before the mark
    if (earliestStart > position) {
      result.push({ type: "text", value: text.slice(position, earliestStart) });
    }

    // Add the mark node. `\ ` inside a sub/superscript is Pandoc's way to write
    // a deliberate space; the backslash is syntax, not content.
    const rawContent = text.slice(earliestStart + earliestMark.markerLen, earliestEnd);
    const content = earliestMark.noUnescapedWhitespace
      ? unescapeWhitespace(rawContent)
      : rawContent;
    const markNode = createMarkNode(earliestMark.name as MarkName, content);
    result.push(markNode);

    // Continue from after the closing marker
    position = earliestEnd + earliestMark.markerLen;
  }

  /* v8 ignore next -- @preserve fallback for empty string input; text nodes from parsers are rarely empty */
  return result.length > 0 ? result : [{ type: "text", value: text }];
}

function createMarkNode(name: MarkName, content: string): Subscript | Superscript | Highlight | Underline {
  const children: PhrasingContent[] = parseMarksInText(content);

  switch (name) {
    case "subscript":
      return { type: "subscript", children } as Subscript;
    case "superscript":
      return { type: "superscript", children } as Superscript;
    case "highlight":
      return { type: "highlight", children } as Highlight;
    case "underline":
      return { type: "underline", children } as Underline;
  }
}
