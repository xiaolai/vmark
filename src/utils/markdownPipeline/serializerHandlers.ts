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
 *
 * @coordinates-with serializer.ts — installs these handlers on remark-stringify
 * @coordinates-with markdownUrl.ts — shares URL whitespace detection pattern
 * @module utils/markdownPipeline/serializerHandlers
 */

import type { Image, Link, Parents } from "mdast";

/** mdast-util-to-markdown state (simplified for our handlers). */
export interface ToMarkdownState {
  containerPhrasing: (
    node: Link,
    info: { before: string; after: string }
  ) => string;
}

/** Pattern matching whitespace characters that need angle bracket wrapping */
const WHITESPACE_PATTERN = /[\s\u00A0\u2002-\u200A\u202F\u205F\u3000]/;

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
 * Custom image handler that uses angle brackets for URLs with spaces.
 * This produces more readable markdown than percent-encoding.
 */
export function handleImage(node: Image): string {
  const url = node.url;
  const alt = node.alt || "";
  const title = node.title;

  // Use angle brackets for URLs with whitespace (CommonMark standard)
  const formattedUrl = WHITESPACE_PATTERN.test(url) ? `<${url}>` : url;

  if (title) {
    return `![${alt}](${formattedUrl} "${title}")`;
  }
  return `![${alt}](${formattedUrl})`;
}

/**
 * Custom link handler: preserves autolinks, uses angle brackets for URLs
 * with spaces.
 */
export function handleLink(
  node: Link,
  _parent: Parents | undefined,
  state: ToMarkdownState
): string {
  // `<https://…>` for URI autolinks, `<user@example.com>` for mailto (#1102).
  const autolink = autolinkValue(node);
  if (autolink !== null) {
    return `<${autolink}>`;
  }

  const url = node.url;
  const title = node.title;

  // Use angle brackets for URLs with whitespace
  const formattedUrl = WHITESPACE_PATTERN.test(url) ? `<${url}>` : url;

  // Serialize children (the link text)
  const text = state.containerPhrasing(node, {
    before: "[",
    after: "]",
  });

  if (title) {
    return `[${text}](${formattedUrl} "${title}")`;
  }
  return `[${text}](${formattedUrl})`;
}
