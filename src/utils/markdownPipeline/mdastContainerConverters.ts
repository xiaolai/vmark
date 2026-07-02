/**
 * MDAST Container Converters
 *
 * Purpose: Converts container-style block MDAST nodes (blockquotes, GitHub-flavored
 * alerts, details) to ProseMirror nodes. Split from mdastBlockConverters.ts for size.
 *
 * Key decisions:
 *   - Alert blocks are detected by parsing blockquote children for `[!TYPE]` markers
 *     (GitHub-flavored markdown alerts), falling back to normal blockquote conversion
 *   - Details summaries are parsed as inline markdown so bold and italic work
 *   - Container children are guarded by ensureNonEmptyBlocks (schema requires "block+")
 *
 * @coordinates-with mdastConverterHelpers.ts — shared context type and helpers
 * @coordinates-with mdastBlockConverters.ts — re-export hub for all block converters
 * @module utils/markdownPipeline/mdastContainerConverters
 */

import type { Node as PMNode, Mark } from "@tiptap/pm/model";
import type { Blockquote, Content, Paragraph } from "mdast";
import type { Alert, Details } from "./types";
import { parseInlineMarkdown } from "./inlineParser";
import { getSourceLine, ensureNonEmptyBlocks, type MdastToPmContext } from "./mdastConverterHelpers";

const ALERT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;

export function convertBlockquote(
  context: MdastToPmContext,
  node: Blockquote,
  marks: Mark[]
): PMNode | null {
  const alertNode = convertAlertBlockquote(context, node, marks);
  if (alertNode) return alertNode;

  const type = context.schema.nodes.blockquote;
  if (!type) return null;

  const children = ensureNonEmptyBlocks(
    context.convertChildren(node.children, marks, "block"),
    context.schema
  );
  return type.create({ sourceLine: getSourceLine(node) }, children);
}

export function convertDetails(
  context: MdastToPmContext,
  node: Details,
  marks: Mark[]
): PMNode | null {
  const detailsType = context.schema.nodes.detailsBlock;
  const summaryType = context.schema.nodes.detailsSummary;
  if (!detailsType || !summaryType) return null;

  const sourceLine = getSourceLine(node);
  const summaryText = node.summary ?? "Details";

  // Parse summary text as inline markdown to support **bold**, *italic*, etc.
  const summaryInlineContent = parseInlineMarkdown(summaryText);
  const summaryPmNodes = context.convertChildren(summaryInlineContent, marks, "inline");

  const summaryNode = summaryType.create(
    { sourceLine },
    summaryPmNodes.length > 0 ? summaryPmNodes : []
  );
  const children = ensureNonEmptyBlocks(
    context.convertChildren(node.children as Content[], marks, "block"),
    context.schema
  );

  return detailsType.create({ open: node.open ?? false, sourceLine }, [summaryNode, ...children]);
}

export function convertAlert(
  context: MdastToPmContext,
  node: Alert,
  marks: Mark[]
): PMNode | null {
  const alertType = context.schema.nodes.alertBlock;
  if (!alertType) return null;

  const children = ensureNonEmptyBlocks(
    context.convertChildren(node.children as Content[], marks, "block"),
    context.schema
  );

  return alertType.create({ alertType: node.alertType, sourceLine: getSourceLine(node) }, children);
}

export function convertAlertBlockquote(
  context: MdastToPmContext,
  node: Blockquote,
  marks: Mark[]
): PMNode | null {
  const alertType = context.schema.nodes.alertBlock;
  if (!alertType) return null;

  const firstChild = node.children[0];
  if (!firstChild || firstChild.type !== "paragraph") return null;

  const stripped = stripAlertMarker(firstChild);
  if (!stripped) return null;

  const alertChildren: Content[] = [];
  if (stripped.paragraph) {
    alertChildren.push(stripped.paragraph);
  }
  alertChildren.push(...node.children.slice(1));

  const converted = ensureNonEmptyBlocks(
    context.convertChildren(alertChildren, marks, "block"),
    context.schema
  );

  return alertType.create({ alertType: stripped.alertType, sourceLine: getSourceLine(node) }, converted);
}

function stripAlertMarker(
  paragraph: Paragraph
): { alertType: (typeof ALERT_TYPES)[number]; paragraph: Paragraph | null } | null {
  const children = [...(paragraph.children ?? [])];
  const first = children[0];
  if (!first || first.type !== "text") return null;

  const match = first.value.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+)?/i);
  if (!match) return null;

  const alertType = match[1].toUpperCase();
  // v8 ignore next 3 -- @preserve reason: regex already restricts match[1] to the five ALERT_TYPES values; this guard can never be false in practice
  if (!ALERT_TYPES.includes(alertType as (typeof ALERT_TYPES)[number])) {
    return null;
  }
  const rest = first.value.slice(match[0].length);

  if (rest.length > 0) {
    children[0] = { ...first, value: rest };
  } else {
    children.shift();
  }

  if (children[0]?.type === "break") {
    children.shift();
  }

  const nextParagraph = children.length > 0 ? { ...paragraph, children } : null;
  return { alertType: alertType as (typeof ALERT_TYPES)[number], paragraph: nextParagraph };
}
