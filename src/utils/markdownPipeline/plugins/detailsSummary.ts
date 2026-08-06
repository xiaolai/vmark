/**
 * Purpose: find a `<details>` block's summary among its parsed children, and
 * keep everything that is NOT the summary.
 *
 * Both halves matter equally. The summary must be THIS block's — searching
 * anywhere let a nested compact block donate its title to the outer one — and
 * the node it was found in must not be discarded wholesale, because remark
 * packs `<summary>S</summary>` and the text after it into a single html node.
 *
 * @coordinates-with utils/markdownPipeline/plugins/detailsBlock.ts — the caller
 * @coordinates-with utils/markdownPipeline/positionTrust.ts — why a position is dropped
 * @module utils/markdownPipeline/plugins/detailsSummary
 */

import type { Content } from "mdast";
import { SUMMARY_RE } from "./detailsTags";
import { originWithin, type RebaseOrigin } from "./rebasePositions";

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

export function extractSummaryFromChildren(
  children: Content[]
): { summary?: string; children: Content[] } {
  if (children.length === 0) {
    return { children };
  }

  const [first, ...rest] = children;
  if (first?.type !== "html") {
    return { children };
  }

  // A COMMENT-ONLY node before the summary is not content. remark emits it as
  // its own html child when a blank line separates it, so the guard below —
  // which only tolerates a comment INSIDE the summary's node — refused a
  // perfectly good summary one node later.
  if (/^(?:\s|<!--[\s\S]*?-->)*$/.test(first.value ?? "")) {
    const deeper = extractSummaryFromChildren(rest);
    return deeper.summary ? deeper : { children };
  }

  // The summary must be THIS block's, which means the html child has to BEGIN
  // with it. Searching anywhere in the child let a nested compact
  // `<details><summary>Inner</summary>…</details>` donate its summary to the
  // outer block — and because the whole child was then consumed as the
  // summary, the nested block and its content were DISCARDED. Measured: an
  // outer block titled "Outer" came back titled "Inner" with no children.
  const value = first.value ?? "";
  // Whitespace and HTML COMMENTS may precede the summary — a comment is not
  // content, and rejecting it discarded a legitimate summary.
  if (!/^(?:\s|<!--[\s\S]*?-->)*<summary>/i.test(value)) {
    return { children };
  }

  const summaryMatch = value.match(SUMMARY_RE);
  if (!summaryMatch) {
    return { children };
  }

  // v8 ignore next -- @preserve reason: summaryMatch[1] is always a string when the regex matches (capturing group always present); the ?? "Details" branch is unreachable
  const summary = (summaryMatch[1] ?? "Details").trim() || "Details";

  // Whatever FOLLOWS `</summary>` in this same node is body content. Returning
  // `rest` alone discarded the whole child, so `<summary>S</summary>\nprose`
  // — one html node, which is what remark emits after a blank line — lost
  // `prose` entirely.
  const after = summaryMatch.index! + summaryMatch[0].length;
  const raw = value.slice(after);
  const trailing = raw.trim();
  if (!trailing) return { summary, children: rest };

  // Reusing `first.position` verbatim would claim the node still spans the
  // summary it no longer contains — a well-formed range over the wrong text,
  // which `positionTrust` exists to refuse. The start is advanced to where the
  // trailing content actually begins; when the host node has no usable origin
  // the position is DROPPED so the authorizer refuses rather than guesses.
  const origin = hostOriginOf(first);
  const start = origin
    ? originWithin(value, after + (raw.length - raw.trimStart().length), origin)
    : undefined;
  const node = { ...first, value: trailing } as Content & {
    position?: unknown;
  };
  if (start && first.position) {
    node.position = { ...first.position, start };
  } else {
    delete node.position;
  }
  return { summary, children: [node as Content, ...rest] };
}
