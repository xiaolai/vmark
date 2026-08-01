/**
 * Details Block — Remark Plugin
 *
 * Purpose: Converts HTML `<details>/<summary>` blocks into structured MDAST nodes
 * and serializes them back to HTML. Enables WYSIWYG editing of collapsible sections.
 *
 * Pipeline: HTML `<details>` in markdown → Details MDAST node → PM detailsBlock node
 *
 * Key decisions:
 *   - Handles both single-block HTML (all in one html node) and multi-block
 *     (opening/closing tags as separate html nodes with content in between)
 *   - Supports nested `<details>` blocks via depth tracking
 *   - Inner content is re-parsed with the `details-body` dialect, INJECTED by
 *     `dialect.ts` rather than constructed here. This plugin is registered BY
 *     the document chain, so importing that chain's builder would close a
 *     cycle. The body dialect deliberately EXCLUDES this plugin — that is what
 *     stops a body parser needing a body parser; nested `<details>` are handled
 *     by the outer pass's depth tracking (WI-3.1)
 *   - Summary text defaults to "Details" when no `<summary>` tag is present
 *   - Serialization escapes HTML in summary text to prevent injection
 *
 * The `<details>` TAG grammar — matching tags, reading attributes — lives in
 * `detailsTags.ts`. This file deals in mdast nodes.
 *
 * Summary extraction lives in `detailsSummary.ts`; the tag grammar in
 * `detailsTags.ts`. Content either half declines to consume is parsed back as
 * body, REBASED into host coordinates — never renumbered from zero.
 *
 * @coordinates-with utils/markdownPipeline/plugins/detailsSummary.ts — the summary half
 * @coordinates-with utils/markdownPipeline/plugins/detailsTags.ts — the tag grammar
 * @coordinates-with mdastBlockConverters.ts — convertDetails creates PM nodes from Details MDAST
 * @coordinates-with pmBlockConverters.ts — convertDetailsBlock creates Details MDAST from PM
 * @coordinates-with inlineParser.ts — parses inline markdown within summary text
 * @module utils/markdownPipeline/plugins/detailsBlock
 */

import type { Content, Root } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";
import type { Details } from "../types";
import { getDetailsBodyParser } from "./detailsBodyParser";
import { extractSummaryFromChildren } from "./detailsSummary";
import {
  DETAILS_OPEN_RE,
  DETAILS_CLOSE_RE,
  SUMMARY_RE,
  isDetailsOpen,
  isDetailsClose,
  hasOpenAttribute,
  parseDetailsOpen,
} from "./detailsTags";
import { originWithin, rebasePositions, type RebaseOrigin } from "./rebasePositions";
import { detailsHandler, type DetailsHandlerState } from "./detailsSerializer";

interface ToMarkdownExtension {
  handlers?: Record<string, DetailsHandler>;
}

type DetailsHandler = (
  node: Details,
  parent: unknown,
  state: DetailsHandlerState,
  info: { before: string; after: string }
) => string;


/**
 * Type guard to check if a node has children property.
 */
interface NodeWithChildren {
  children?: Content[];
}

function hasChildren(node: unknown): node is NodeWithChildren {
  return typeof node === "object" && node !== null && "children" in node;
}

export const remarkDetailsBlock: Plugin<[], Root> = function () {
  const data = this.data() as { toMarkdownExtensions?: ToMarkdownExtension[] };
  // v8 ignore next -- @preserve reason: toMarkdownExtensions is always undefined on first remarkDetailsBlock invocation per processor; the ?? [] right-hand branch is skipped if a second plugin instance is added, but that is not a supported use case
  data.toMarkdownExtensions = data.toMarkdownExtensions ?? [];
  data.toMarkdownExtensions.push({ handlers: { details: detailsHandler } });

  return (tree) => {
    visit(tree, (node) => {
      if (!hasChildren(node) || !Array.isArray(node.children)) return;
      node.children = transformDetailsBlocks(node.children);
    });
  };
};

/** A node's own start, when it carries a complete one. */
function hostOriginOf(node: Content): RebaseOrigin | undefined {
  const start = node.position?.start;
  if (
    typeof start?.offset !== "number" ||
    typeof start.line !== "number" ||
    typeof start.column !== "number"
  ) {
    return undefined;
  }
  return { offset: start.offset, line: start.line, column: start.column };
}

function transformDetailsBlocks(children: Content[]): Content[] {
  const result: Content[] = [];

  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    if (node?.type === "html") {
      const parsed = parseDetailsHtmlBlock(node.value ?? "", hostOriginOf(node));
      if (parsed) {
        result.push(parsed);
        continue;
      }
    }

    if (node?.type !== "html" || !isDetailsOpen(node.value ?? "")) {
      result.push(node);
      continue;
    }

    // v8 ignore next -- @preserve reason: remark always sets html node.value; the ?? "" fallback is a defensive guard that is structurally unreachable
    const openInfo = parseDetailsOpen(node.value ?? "");
    const openOrigin = hostOriginOf(node);
    const inner: Content[] = [];
    let closed = false;
    let depth = 1; // Track nesting depth for nested <details> blocks

    for (let cursor = index + 1; cursor < children.length; cursor += 1) {
      const next = children[cursor];
      if (next?.type === "html") {
        const htmlValue = next.value ?? "";
        // Track nested <details> opening tags
        if (isDetailsOpen(htmlValue)) {
          depth += 1;
        }
        // Check for closing tag
        if (isDetailsClose(htmlValue)) {
          depth -= 1;
          if (depth === 0) {
            // This closes the outer details block
            index = cursor;
            closed = true;
            break;
          }
        }
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
    // Content the opening html node swallowed leads the body — it appeared
    // BEFORE everything in `inner`, so it must stay first.
    const nestedChildren = [
      ...openInfo.residue.flatMap((piece) =>
        parseDetailsBody(
          piece.text,
          // The opening html node is a REAL host node, so its own start is the
          // origin. Without this the re-parse numbered the residue from 0 and
          // handed the link-check authorizer coordinates pointing at unrelated
          // text — well-formed, and wrong.
          openOrigin && originWithin(node.value ?? "", piece.start, openOrigin)
        )
      ),
      ...transformDetailsBlocks(bodyChildren),
    ];
    result.push({
      type: "details",
      open: openInfo.open,
      summary: summary ?? openInfo.summary,
      children: nestedChildren,
    } as Details);
  }

  return result;
}

function parseDetailsHtmlBlock(
  value: string,
  hostStart?: RebaseOrigin,
): Details | null {
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
  // The SAME attribute parser as the multi-node path. This branch kept the old
  // broad match, so `data-open="false"` still opened a compact block.
  const open = hasOpenAttribute(openTag);
  const summaryMatch = value.match(SUMMARY_RE);
  // v8 ignore next -- @preserve reason: summaryMatch?.[1] is a string when the regex matches; the ?? "Details" right-hand branch triggers only when summaryMatch is null (no <summary> tag in single-block HTML), a rare path
  const summary = (summaryMatch?.[1] ?? "Details").trim() || "Details";

  const openTagEnd = openIndex + openTag.length;
  const closeTagStart = closeIndex;
  let bodyStart = openTagEnd;
  if (summaryMatch?.index !== undefined) {
    bodyStart = summaryMatch.index + summaryMatch[0].length;
  }

  const body = value.slice(bodyStart, closeTagStart);
  // The body's absolute start: where this html node begins, plus how far into
  // its value the body does. Without it the re-parse below numbers from 0 and
  // every offset inside a COMPACT `<details>` addresses the wrong text.
  const children = parseDetailsBody(
    body,
    hostStart ? originWithin(value, bodyStart, hostStart) : undefined,
  );

  return {
    type: "details",
    open,
    summary,
    children,
  } as Details;
}

function parseDetailsBody(markdown: string, origin?: RebaseOrigin): Content[] {
  if (!markdown.trim()) {
    return [];
  }

  const processor = getDetailsBodyParser();
  const parsed = processor.parse(markdown);
  const transformed = processor.runSync(parsed) as Root;
  const children = transformDetailsBlocks(transformed.children as Content[]);
  // Rebase INTO the host document. The re-parse numbered these from 0; without
  // this they are well-formed offsets pointing at unrelated text.
  if (origin) rebasePositions(children, origin);
  return children;
}
