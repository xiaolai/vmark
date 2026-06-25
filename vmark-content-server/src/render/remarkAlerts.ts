/**
 * remarkAlerts — GitHub-style alert blockquotes → `alert` MDAST nodes.
 *
 * Purpose: VMark's editor converts `> [!NOTE]` blockquotes to alert blocks
 * during the MDAST→ProseMirror step, NOT in a remark plugin (review finding
 * D3.4). The headless content-server renderer therefore needs its own
 * transform so alerts render with parity. This plugin runs over MDAST and
 * rewrites a qualifying blockquote into a custom `alert` node consumed by the
 * mdast→hast handler in `renderMarkdown.ts`.
 *
 * Recognized kinds (GFM): NOTE, TIP, IMPORTANT, WARNING, CAUTION.
 *
 * @module render/remarkAlerts
 */

import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root, Blockquote, Paragraph, Text, BlockContent } from "mdast";

export const ALERT_KINDS = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export interface AlertNode {
  type: "alert";
  kind: AlertKind;
  children: BlockContent[];
}

const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

/**
 * Detect the alert marker on a blockquote's first paragraph and return the
 * kind plus the marker length to strip. Returns null when not an alert.
 */
function matchAlert(blockquote: Blockquote): { kind: AlertKind; markerLen: number } | null {
  const first = blockquote.children[0];
  if (!first || first.type !== "paragraph") return null;
  const firstInline = (first as Paragraph).children[0];
  if (!firstInline || firstInline.type !== "text") return null;
  const m = MARKER.exec((firstInline as Text).value);
  if (!m) return null;
  return { kind: m[1].toLowerCase() as AlertKind, markerLen: m[0].length };
}

/**
 * Strip the `[!KIND]` marker (and a following hard break / newline) from the
 * first paragraph in place. Removes the paragraph entirely if it becomes empty.
 */
function stripMarker(blockquote: Blockquote, markerLen: number): void {
  const first = blockquote.children[0] as Paragraph;
  const firstInline = first.children[0] as Text;
  firstInline.value = firstInline.value.slice(markerLen);
  // Drop a leading break left behind by `> [!NOTE]\n> body`.
  if (first.children[1]?.type === "break") {
    first.children.splice(1, 1);
  }
  if (firstInline.value === "") {
    first.children.shift();
  }
  if (first.children.length === 0) {
    blockquote.children.shift();
  }
}

export const remarkAlerts: Plugin<[], Root> = function () {
  return (tree: Root) => {
    visit(tree, "blockquote", (node, index, parent) => {
      if (!parent || index === undefined) return;
      const match = matchAlert(node as Blockquote);
      if (!match) return;
      const bq = node as Blockquote;
      stripMarker(bq, match.markerLen);
      const alert: AlertNode = {
        type: "alert",
        kind: match.kind,
        children: bq.children as BlockContent[],
      };
      // Replace the blockquote with the alert node.
      (parent.children as unknown[])[index] = alert;
    });
  };
};
