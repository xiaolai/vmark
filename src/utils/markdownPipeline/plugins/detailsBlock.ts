/**
 * Details block remark plugin
 *
 * Converts HTML <details>/<summary> blocks into a structured mdast node and
 * serializes them back to HTML.
 */

import type { Content, Root } from "mdast";
import { unified, type Plugin } from "unified";
import { visit } from "unist-util-visit";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import type { Details } from "../types";
import { remarkCustomInline } from "./customInline";
import { remarkResolveReferences } from "./resolveReferences";
import { remarkWikiLinks } from "./wikiLinks";

interface ToMarkdownExtension {
  handlers?: Record<string, DetailsHandler>;
}

type DetailsHandler = (
  node: Details,
  parent: unknown,
  state: DetailsHandlerState,
  info: { before: string; after: string }
) => string;

interface DetailsHandlerState {
  enter: (constructName: string) => () => void;
  containerFlow: (node: { children: Content[] }, info: { before: string; after: string }) => string;
  createTracker: (info: { before: string; after: string }) => {
    move: (value: string) => string;
    current: () => { before: string; after: string };
  };
}

const DETAILS_OPEN_RE = /<details\b[^>]*>/i;
const DETAILS_CLOSE_RE = /<\/details>/i;
const SUMMARY_RE = /<summary>([\s\S]*?)<\/summary>/i;

/**
 * Type guard to check if a node has children property.
 */
interface NodeWithChildren {
  children?: Content[];
}

function hasChildren(node: unknown): node is NodeWithChildren {
  return typeof node === "object" && node !== null && "children" in node;
}

const innerProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm, {
    // Keep in sync with the main markdown parser.
    singleTilde: false,
  })
  .use(remarkMath)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkWikiLinks)
  .use(remarkCustomInline)
  .use(remarkResolveReferences);

export const remarkDetailsBlock: Plugin<[], Root> = function () {
  const data = this.data() as { toMarkdownExtensions?: ToMarkdownExtension[] };
  data.toMarkdownExtensions = data.toMarkdownExtensions ?? [];
  data.toMarkdownExtensions.push({ handlers: { details: detailsHandler } });

  return (tree) => {
    visit(tree, (node) => {
      if (!hasChildren(node) || !Array.isArray(node.children)) return;
      node.children = transformDetailsBlocks(node.children);
    });
  };
};

function transformDetailsBlocks(children: Content[]): Content[] {
  const result: Content[] = [];

  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    if (node?.type === "html") {
      const parsed = parseDetailsHtmlBlock(node.value ?? "");
      if (parsed) {
        result.push(parsed);
        continue;
      }
    }

    if (node?.type !== "html" || !isDetailsOpen(node.value ?? "")) {
      result.push(node);
      continue;
    }

    const openInfo = parseDetailsOpen(node.value ?? "");
    const inner: Content[] = [];
    let closed = false;

    for (let cursor = index + 1; cursor < children.length; cursor += 1) {
      const next = children[cursor];
      if (next?.type === "html" && isDetailsClose(next.value ?? "")) {
        index = cursor;
        closed = true;
        break;
      }
      inner.push(next);
    }

    if (!closed) {
      // Unclosed details: push opening tag as-is.
      // Inner nodes will be processed in subsequent iterations of the outer loop.
      result.push(node);
      continue;
    }

    const { summary, children: bodyChildren } = extractSummaryFromChildren(inner);
    const nestedChildren = transformDetailsBlocks(bodyChildren);
    result.push({
      type: "details",
      open: openInfo.open,
      summary: summary ?? openInfo.summary,
      children: nestedChildren,
    } as Details);
  }

  return result;
}

function isDetailsOpen(value: string): boolean {
  return DETAILS_OPEN_RE.test(value);
}

function isDetailsClose(value: string): boolean {
  return DETAILS_CLOSE_RE.test(value.trim());
}

function parseDetailsOpen(value: string): { open: boolean; summary: string } {
  const open = /\bopen\b/i.test(value);
  const summaryMatch = value.match(SUMMARY_RE);
  const summary = (summaryMatch?.[1] ?? "Details").trim() || "Details";
  return { open, summary };
}

function parseDetailsHtmlBlock(value: string): Details | null {
  const openTagMatch = value.match(DETAILS_OPEN_RE);
  const closeTagMatch = value.match(DETAILS_CLOSE_RE);
  if (!openTagMatch || !closeTagMatch) return null;

  const openIndex = value.search(DETAILS_OPEN_RE);
  const closeIndex = value.search(DETAILS_CLOSE_RE);
  if (openIndex === -1 || closeIndex === -1 || closeIndex <= openIndex) return null;

  // Only parse if <details> wraps the entire block (no prefix/suffix content)
  // This prevents dropping content that exists outside the details tags
  const closeTag = closeTagMatch[0];
  const closeEndIndex = closeIndex + closeTag.length;
  const prefix = value.slice(0, openIndex).trim();
  const suffix = value.slice(closeEndIndex).trim();
  if (prefix || suffix) {
    // Content exists outside <details> tags - don't parse as single details block
    return null;
  }

  const openTag = openTagMatch[0];
  const open = /\bopen\b/i.test(openTag);
  const summaryMatch = value.match(SUMMARY_RE);
  const summary = (summaryMatch?.[1] ?? "Details").trim() || "Details";

  const openTagEnd = openIndex + openTag.length;
  const closeTagStart = closeIndex;
  let bodyStart = openTagEnd;
  if (summaryMatch?.index !== undefined) {
    bodyStart = summaryMatch.index + summaryMatch[0].length;
  }

  const body = value.slice(bodyStart, closeTagStart);
  const children = parseDetailsBody(body);

  return {
    type: "details",
    open,
    summary,
    children,
  } as Details;
}

function extractSummaryFromChildren(
  children: Content[]
): { summary?: string; children: Content[] } {
  if (children.length === 0) {
    return { children };
  }

  const [first, ...rest] = children;
  if (first?.type !== "html") {
    return { children };
  }

  const summaryMatch = first.value?.match(SUMMARY_RE);
  if (!summaryMatch) {
    return { children };
  }

  const summary = (summaryMatch[1] ?? "Details").trim() || "Details";
  return { summary, children: rest };
}

function parseDetailsBody(markdown: string): Content[] {
  if (!markdown.trim()) {
    return [];
  }

  const parsed = innerProcessor.parse(markdown);
  const transformed = innerProcessor.runSync(parsed) as Root;
  return transformDetailsBlocks(transformed.children as Content[]);
}

function detailsHandler(
  node: Details,
  _parent: unknown,
  state: DetailsHandlerState,
  info: { before: string; after: string }
): string {
  const exit = state.enter("details");
  const tracker = state.createTracker(info);
  const openAttr = node.open ? " open" : "";

  let value = tracker.move(`<details${openAttr}>`);
  value += tracker.move("\n");
  value += tracker.move(`<summary>${escapeHtml(node.summary ?? "Details")}</summary>`);
  value += tracker.move("\n\n");

  const content = state.containerFlow(node, tracker.current()).trimEnd();
  value += tracker.move(content);
  value += tracker.move("\n");
  value += tracker.move("</details>");

  exit();
  return value;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
