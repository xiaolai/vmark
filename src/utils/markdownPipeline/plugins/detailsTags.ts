/**
 * Purpose: the `<details>` TAG grammar — matching the tags and reading their
 * attributes. Everything about HTML syntax lives here; `detailsBlock.ts` deals
 * in mdast nodes.
 *
 * Split out when `detailsBlock.ts` crossed the 300-line limit, along the seam
 * that was already there: three regexes and four small functions that never
 * touch a node.
 *
 * `parseDetailsOpen` also returns the RESIDUE the opening node swallowed,
 * each piece with its offset, so the caller can rebase rather than guess.
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
  /**
   * Content the opening node swallowed, each piece with its OFFSET into the
   * host value — a piece before the summary, a piece after it, or neither.
   *
   * The offset is not decoration. Re-parsing a bare string restarts its
   * positions at 0, producing well-formed coordinates that point at unrelated
   * text — the exact failure `positionTrust` exists to refuse. Carrying the
   * offset lets the caller rebase into host coordinates instead.
   */
  residue: { text: string; start: number }[];
} {
  const open = hasOpenAttribute(value);
  const summaryMatch = value.match(SUMMARY_RE);
  const summary = (summaryMatch?.[1] ?? "Details").trim() || "Details";
  // Two contiguous pieces at most: between the open tag and the summary, and
  // after the summary. Each keeps its own offset, so neither is re-parsed as if
  // it began the document.
  const openTag = value.match(DETAILS_OPEN_RE);
  const afterOpen = (openTag?.index ?? 0) + (openTag?.[0].length ?? 0);
  const summaryStart = summaryMatch?.index ?? value.length;
  const afterSummary = summaryMatch
    ? summaryStart + summaryMatch[0].length
    : value.length;

  const residue = [
    { raw: value.slice(afterOpen, summaryStart), at: afterOpen },
    { raw: value.slice(afterSummary), at: afterSummary },
  ]
    .map(({ raw, at }) => {
      // Trim, but keep the offset honest by counting what the trim removed.
      const lead = raw.length - raw.trimStart().length;
      return { text: raw.trim(), start: at + lead };
    })
    .filter((piece) => piece.text.length > 0);

  return { open, summary, residue };
}
