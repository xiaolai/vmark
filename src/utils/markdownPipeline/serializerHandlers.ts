/**
 * Custom mdast-util-to-markdown handlers for images and links.
 *
 * Purpose: VMark overrides remark-stringify's default image/link handlers to
 * emit angle-bracket destinations for URLs containing whitespace instead of
 * percent-encoding them (more readable, still CommonMark).
 *
 * Key decisions:
 *   - Links whose only child is a text node equal to the URL (or its
 *     `mailto:` form) serialize as autolinks (`<url>`), mirroring
 *     mdast-util-to-markdown's formatLinkAsAutolink. Without this branch the
 *     custom handler rewrote every autolink and bare GFM URL literal to
 *     `[https\://…](https://…)` — losing the authored form and injecting
 *     escapes into the label (#1102).
 *   - Destinations, image alt text, and titles are escaped: a raw
 *     destination cannot hold whitespace, control chars, unbalanced parens,
 *     or a leading `<` (those switch to the `<…>` literal form with `\`,
 *     `<`, `>` escaped and CR/LF percent-encoded); `"` in titles and
 *     `[`/`]` in alt text are backslash-escaped so they cannot terminate
 *     the construct early.
 *   - Both handlers carry a `peek` function (upstream Handle contract) so
 *     phrasing lookahead reads the first character without running the
 *     full serializer.
 *
 * @coordinates-with serializer.ts — installs these handlers on remark-stringify
 * @coordinates-with @/utils/markdownUrl — shared whitespace predicate (urlNeedsBrackets)
 * @module utils/markdownPipeline/serializerHandlers
 */

import type { Image, Link, Parents } from "mdast";
import { urlNeedsBrackets } from "@/utils/markdownUrl";

/** mdast-util-to-markdown state (simplified for our handlers). */
export interface ToMarkdownState {
  containerPhrasing: (
    node: Link,
    info: { before: string; after: string }
  ) => string;
}

/** URI scheme at the start of a URL (per CommonMark autolinks). */
const URI_SCHEME_RE = /^[a-z][a-z+.-]+:/i;

/** True when the URL contains a character that would terminate or invalidate an autolink (`<url>`): control chars, space, `<`, `>`, DEL. */
function hasAutolinkUnsafeChar(url: string): boolean {
  for (const ch of url) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || ch === "<" || ch === ">") return true;
  }
  return false;
}

/** True when `(`/`)` in the URL are not balanced (raw destinations require balance). */
function hasUnbalancedParens(url: string): boolean {
  let depth = 0;
  for (const ch of url) {
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth < 0) return true;
    }
  }
  return depth !== 0;
}

/** True when the URL contains an ASCII control character or DEL. */
function hasControlChar(url: string): boolean {
  for (const ch of url) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Format a destination for `[text](…)` / `![alt](…)`.
 *
 * Raw form is kept whenever CommonMark allows it. URLs that a raw
 * destination cannot represent — empty, whitespace, control chars,
 * unbalanced parens, or a leading `<` (which would read as the literal
 * form) — switch to `<…>` with `\`, `<`, `>` escaped and CR/LF
 * percent-encoded (newlines are invalid in a destination even escaped).
 */
function formatDestination(url: string): string {
  const needsAngle =
    url === "" ||
    url.startsWith("<") ||
    urlNeedsBrackets(url) ||
    hasControlChar(url) ||
    hasUnbalancedParens(url);
  if (!needsAngle) return url;
  const escaped = url
    .replace(/\\/g, "\\\\")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
  return `<${escaped}>`;
}

/** Escape a title for the double-quoted `"…"` position. */
function formatTitle(title: string): string {
  return title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Escape image alt text for the `![…]` label position. */
function formatAltText(alt: string): string {
  return alt.replace(/[\\[\]]/g, "\\$&");
}

/**
 * The text to place inside `<…>` when the link round-trips as an autolink,
 * or null when it must stay in `[text](url)` resource form. Mirrors
 * mdast-util-to-markdown's formatLinkAsAutolink: a single text child equal
 * to the URL (or the URL minus `mailto:`), no title, a URI scheme, and no
 * characters that would terminate the autolink.
 */
function autolinkValue(node: Link): string | null {
  if (node.title) return null;
  if (node.children.length !== 1) return null;
  const child = node.children[0];
  if (child.type !== "text" || !child.value) return null;
  if (child.value !== node.url && `mailto:${child.value}` !== node.url) return null;
  if (!URI_SCHEME_RE.test(node.url) || hasAutolinkUnsafeChar(node.url)) return null;
  return child.value;
}

/**
 * Custom image handler: escaped alt/title, angle-bracket destination when
 * the raw form cannot represent the URL.
 */
function imageHandler(node: Image): string {
  const alt = formatAltText(node.alt || "");
  const formattedUrl = formatDestination(node.url);

  if (node.title) {
    return `![${alt}](${formattedUrl} "${formatTitle(node.title)}")`;
  }
  return `![${alt}](${formattedUrl})`;
}

/**
 * Custom link handler: preserves autolinks, escaped title, angle-bracket
 * destination when the raw form cannot represent the URL.
 */
function linkHandler(
  node: Link,
  _parent: Parents | undefined,
  state: ToMarkdownState
): string {
  // `<https://…>` for URI autolinks, `<user@example.com>` for mailto (#1102).
  const autolink = autolinkValue(node);
  if (autolink !== null) {
    return `<${autolink}>`;
  }

  const formattedUrl = formatDestination(node.url);

  // Serialize children (the link text)
  const text = state.containerPhrasing(node, {
    before: "[",
    after: "]",
  });

  if (node.title) {
    return `[${text}](${formattedUrl} "${formatTitle(node.title)}")`;
  }
  return `[${text}](${formattedUrl})`;
}

/** Image handler with the upstream `peek` contract (lookahead sees `!`). */
export const handleImage = Object.assign(imageHandler, {
  peek: () => "!",
});

/** Link handler with the upstream `peek` contract (`<` for autolinks, `[` otherwise). */
export const handleLink = Object.assign(linkHandler, {
  peek: (node: Link) => (autolinkValue(node) !== null ? "<" : "["),
});
