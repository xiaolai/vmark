/**
 * Purpose: the `<details>` TAG grammar — matching the tags and reading their
 * attributes. Everything about HTML syntax lives here; `detailsBlock.ts` deals
 * in mdast nodes.
 *
 * Split out when `detailsBlock.ts` crossed the 300-line limit, along the seam
 * that was already there: three regexes and four small functions that never
 * touch a node.
 *
 * @coordinates-with utils/markdownPipeline/plugins/detailsBlock.ts — the consumer
 * @module utils/markdownPipeline/plugins/detailsTags
 */

/**
 * An opening `<details>` tag, quote-aware.
 *
 * `[^>]*` stopped at the first `>` — including one inside a quoted value — so
 * `<details title="a > b" open>` was truncated mid-tag and its `open`
 * attribute was never seen.
 */
export const DETAILS_OPEN_RE = /<details\b(?:"[^"]*"|'[^']*'|[^>])*>/i;
export const DETAILS_CLOSE_RE = /<\/details>/i;
export const SUMMARY_RE = /<summary>([\s\S]*?)<\/summary>/i;


export function isDetailsOpen(value: string): boolean {
  return DETAILS_OPEN_RE.test(value);
}

export function isDetailsClose(value: string): boolean {
  return DETAILS_CLOSE_RE.test(value.trim());
}

/**
 * Whether the opening tag carries a real `open` ATTRIBUTE.
 *
 * `/\bopen\b/i` over the whole value matched `data-open="false"` and
 * `data-state="open"` — an attribute NAME and a VALUE, neither of which opens
 * anything — so a collapsed block rendered expanded. The attribute list is
 * isolated first, then matched on attribute boundaries.
 */
export function hasOpenAttribute(value: string): boolean {
  const tag = /<details\b((?:"[^"]*"|'[^']*'|[^>])*)>/i.exec(value);
  if (!tag) return false;
  // Drop quoted values, so `data-state="open"` cannot contribute a match.
  const attributes = tag[1].replace(/=\s*("[^"]*"|'[^']*')/g, "=");
  return /(?:^|\s)open(?:\s|=|$)/i.test(attributes);
}

/**
 * The opening tag's attributes and summary — plus whatever ELSE it swallowed.
 *
 * remark keeps consecutive HTML lines in one block, so `<details>` and any
 * content up to the `<summary>` arrive as a single node. That whole node used
 * to be consumed as "the opening tag", silently deleting content between the
 * two: `<details>\nprose\n<summary>S</summary>` lost `prose` entirely.
 * The residue is returned so the caller can parse it back as body content.
 */
export function parseDetailsOpen(value: string): {
  open: boolean;
  summary: string;
  residue: string;
} {
  const open = hasOpenAttribute(value);
  const summaryMatch = value.match(SUMMARY_RE);
  const summary = (summaryMatch?.[1] ?? "Details").trim() || "Details";
  const residue = value
    .replace(DETAILS_OPEN_RE, "")
    .replace(SUMMARY_RE, "")
    .trim();
  return { open, summary, residue };
}
