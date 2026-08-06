/**
 * Custom inline marker transform (parse side).
 *
 * Purpose: the mdast tree transform that turns VMark's inline markers
 * (`==highlight==`, `++underline++`, `^superscript^`, `~subscript~`) into typed
 * nodes. Extracted from customInline.ts so that file stays under the size limit;
 * the serialize handlers remain there.
 *
 * Two passes: per-text-node parsing (`parseMarksInText`), then a cross-node pass
 * (`parseMarksAcrossChildren`) for pairs remark split by parsing an inner mark
 * (e.g. `**bold**`) first.
 *
 * @coordinates-with customInline.ts — the plugin + serialize handlers
 * @coordinates-with types.ts — Subscript, Superscript, Highlight, Underline
 * @module utils/markdownPipeline/plugins/customInlineTransform
 */
import type { Root, PhrasingContent, Text } from "mdast";
import type { Subscript, Superscript, Highlight, Underline } from "../types";

export interface FromMarkdownExtension {
  transforms?: Array<(tree: Root) => void>;
}

interface MarkDefinition {
  readonly name: "highlight" | "underline" | "superscript" | "subscript";
  readonly marker: string;
  readonly markerLen: number;
  readonly skipDouble?: boolean;
}

const SKIP_NODE_TYPES = new Set(["inlineCode", "code", "math", "inlineMath", "html", "yaml"]);

const MARKS: readonly MarkDefinition[] = [
  { name: "highlight", marker: "==", markerLen: 2 },
  { name: "underline", marker: "++", markerLen: 2 },
  { name: "superscript", marker: "^", markerLen: 1 },
  { name: "subscript", marker: "~", markerLen: 1, skipDouble: true },
];

type MarkName = "subscript" | "superscript" | "highlight" | "underline";

export function customInlineFromMarkdown(): FromMarkdownExtension {
  return {
    // We use transforms instead of tokenizers
    transforms: [transformCustomMarks],
  };
}

function transformCustomMarks(tree: Root): void {
  walkAndReplace(tree);
}

function walkAndReplace(node: Root | PhrasingContent | { children?: unknown[] }): void {
  if (isSkippableNode(node)) return;
  if (!("children" in node) || !Array.isArray(node.children)) return;

  const newChildren: unknown[] = [];
  let modified = false;

  for (const child of node.children) {
    if (isTextNode(child)) {
      const replaced = parseMarksInText(child.value);
      if (replaced.length === 1 && isTextNode(replaced[0]) && replaced[0].value === child.value) {
        newChildren.push(child);
      } else {
        newChildren.push(...replaced);
        modified = true;
      }
    } else {
      walkAndReplace(child as { children?: unknown[] });
      newChildren.push(child);
    }
  }

  // Second pass: markers whose pair was split across sibling nodes. remark
  // parses `**bold**` into a `strong` node BEFORE this transform runs, so
  // `==highlight **bold**==` arrives as [text "==highlight ", strong, text "=="]
  // — a pair the per-text-node scan above can never see.
  const spanned = parseMarksAcrossChildren(newChildren);
  if (spanned !== newChildren) modified = true;

  if (modified) {
    (node as { children: unknown[] }).children = spanned;
  }
}

/**
 * Wrap marker pairs whose opening and closing markers live in different sibling
 * nodes. Runs after per-node parsing, so anything left here is genuinely split.
 * Repeats until no more pairs are found, so nested and multiple spans resolve.
 */
function parseMarksAcrossChildren(children: unknown[]): unknown[] {
  let current = children;
  for (;;) {
    let wrappedThisRound: unknown[] | null = null;
    for (const mark of MARKS) {
      wrappedThisRound = tryWrapAcross(current, mark);
      if (wrappedThisRound !== null) break;
    }
    if (wrappedThisRound === null) return current;
    current = wrappedThisRound;
  }
}

/** Index of the first usable marker in `text`, respecting `skipDouble`, or -1. */
function findMarkerIn(text: string, mark: MarkDefinition, from: number): number {
  let at = from;
  while (at < text.length) {
    const found = text.indexOf(mark.marker, at);
    if (found === -1) return -1;
    if (mark.skipDouble && mark.markerLen === 1 && text[found + 1] === mark.marker) {
      at = found + 2;
      continue;
    }
    return found;
  }
  return -1;
}

/** Wrap the first cross-node pair for `mark`, or null if none exists. */
function tryWrapAcross(children: unknown[], mark: MarkDefinition): unknown[] | null {
  for (let i = 0; i < children.length; i++) {
    const open = children[i];
    if (!isTextNode(open)) continue;
    const openAt = findMarkerIn(open.value, mark, 0);
    if (openAt === -1) continue;

    for (let j = i + 1; j < children.length; j++) {
      const between = children[j];
      // A marker pair must not span code/math/raw-HTML — abort this opening.
      if (isSkippableNode(between)) break;
      if (!isTextNode(between)) continue;
      const closeAt = findMarkerIn(between.value, mark, 0);
      if (closeAt === -1) continue;
      return buildSpan(children, i, openAt, j, closeAt, mark);
    }
  }
  return null;
}

/** Build the children array with [i..j] wrapped into a `mark` node. */
function buildSpan(
  children: unknown[],
  i: number,
  openAt: number,
  j: number,
  closeAt: number,
  mark: MarkDefinition,
): unknown[] {
  const openText = (children[i] as Text).value;
  const closeText = (children[j] as Text).value;
  const beforeOpen = openText.slice(0, openAt);
  const afterOpen = openText.slice(openAt + mark.markerLen);
  const beforeClose = closeText.slice(0, closeAt);
  const afterClose = closeText.slice(closeAt + mark.markerLen);

  const asText = (value: string): Text[] => (value ? [{ type: "text", value }] : []);
  const inner: unknown[] = [
    ...asText(afterOpen),
    ...children.slice(i + 1, j),
    ...asText(beforeClose),
  ];
  // A nested split pair may live inside the span too (e.g. `==a ++b **x**++==`).
  const markNode = { type: mark.name, children: parseMarksAcrossChildren(inner) };

  return [
    ...children.slice(0, i),
    ...asText(beforeOpen),
    markNode,
    ...asText(afterClose),
    ...children.slice(j + 1),
  ];
}

function isTextNode(node: unknown): node is Text {
  return typeof node === "object" && node !== null && (node as { type?: string }).type === "text";
}

function isSkippableNode(node: unknown): boolean {
  /* v8 ignore next -- @preserve defensive null/type guard; MDAST nodes are always objects */
  if (!node || typeof node !== "object") return false;
  const type = (node as { type?: string }).type;
  return typeof type === "string" && SKIP_NODE_TYPES.has(type);
}

function findMarkPair(
  text: string,
  mark: MarkDefinition,
  fromIndex: number
): { start: number; end: number } | null {
  let startIdx = fromIndex;

  while (startIdx < text.length) {
    const foundStart = text.indexOf(mark.marker, startIdx);
    if (foundStart === -1) return null;

    // Skip if this is a double marker when skipDouble is set
    if (mark.skipDouble && mark.markerLen === 1 && text[foundStart + 1] === mark.marker) {
      startIdx = foundStart + 2;
      continue;
    }

    // Find closing marker
    let searchPos = foundStart + mark.markerLen;
    while (searchPos < text.length) {
      const closeIdx = text.indexOf(mark.marker, searchPos);
      if (closeIdx === -1) break;

      // Skip double markers when configured
      if (mark.skipDouble && mark.markerLen === 1 && text[closeIdx + 1] === mark.marker) {
        searchPos = closeIdx + 2;
        continue;
      }

      // Valid closing marker found
      if (closeIdx > foundStart + mark.markerLen) {
        return { start: foundStart, end: closeIdx };
      }
      break;
    }

    // No valid closing marker, try next occurrence
    startIdx = foundStart + 1;
  }

  return null;
}

function parseMarksInText(text: string): PhrasingContent[] {
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

    // Add the mark node
    const content = text.slice(earliestStart + earliestMark.markerLen, earliestEnd);
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
