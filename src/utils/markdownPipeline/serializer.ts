/**
 * Markdown Serializer (remark-stringify based)
 *
 * Purpose: Serializes MDAST back to markdown text with consistent formatting.
 * The serializer configuration determines VMark's canonical markdown style.
 *
 * Key decisions:
 *   - Bullet: `-` (not `*`), emphasis: `*`, strong: `**`, fence: backtick
 *   - listItemIndent: "one" — minimizes diff noise compared to "tab"
 *   - Custom handlers for image/link to use angle brackets for URLs with spaces
 *     instead of percent-encoding (more readable, CommonMark compliant)
 *   - Post-processes &#x20; entities back to spaces (remark-stringify adds these
 *     near line breaks but they are unnecessary for our use case)
 *   - Strips unnecessary backslash escapes ($, [, ], *, _, `, !) that
 *     remark-stringify adds defensively in plain text nodes
 *   - hardBreakStyle option converts `\` breaks to two-space breaks
 *
 * @coordinates-with parser.ts — plugins must match between parser and serializer
 * @coordinates-with adapter.ts — wraps this with error handling
 * @coordinates-with markdownUrl.ts — shares URL whitespace detection pattern
 * @module utils/markdownPipeline/serializer
 */

import { unified } from "unified";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import type { Root, Image, Link, Parents } from "mdast";
import { remarkCustomInline, remarkDetailsBlock, remarkWikiLinks, tocToMarkdown } from "./plugins";
import type { MarkdownPipelineOptions } from "./types";

// Type for mdast-util-to-markdown state (simplified for our handlers)
interface ToMarkdownState {
  containerPhrasing: (
    node: Link,
    info: { before: string; after: string }
  ) => string;
}

/** Pattern matching whitespace characters that need angle bracket wrapping */
const WHITESPACE_PATTERN = /[\s\u00A0\u2002-\u200A\u202F\u205F\u3000]/;

/**
 * Custom image handler that uses angle brackets for URLs with spaces.
 * This produces more readable markdown than percent-encoding.
 */
function handleImage(node: Image): string {
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
 * Custom link handler that uses angle brackets for URLs with spaces.
 */
function handleLink(
  node: Link,
  _parent: Parents | undefined,
  state: ToMarkdownState
): string {
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

/**
 * Unified processor configured for VMark markdown serialization.
 *
 * Plugins (must match parser configuration):
 * - remark-stringify: Base CommonMark serializer
 * - remark-gfm: GitHub Flavored Markdown output
 * - remark-math: Math output ($...$ and $$...$$)
 * - remark-frontmatter: YAML frontmatter output
 * - remarkCustomInline: Custom inline marks (==highlight==, ~sub~, etc.)
 */
function createSerializer(_options: MarkdownPipelineOptions = {}) {
  return unified()
    .use(remarkStringify, {
      // Serialization options for consistent output
      bullet: "-", // Use - for unordered lists
      bulletOther: "*", // Fallback bullet
      bulletOrdered: ".", // Use . for ordered lists
      emphasis: "*", // Use * for emphasis (single: *italic*)
      strong: "*", // Use * for strong (double: **bold**)
      fence: "`", // Use ` for code fences
      fences: true, // Use fenced code blocks
      rule: "-", // Use --- for thematic breaks
      listItemIndent: "one", // Use one space indent for list items
      // Custom handlers for angle-bracket URL syntax and custom node types
      handlers: {
        image: handleImage,
        link: handleLink,
        ...tocToMarkdown.handlers,
      } as Record<string, unknown>,
    })
    .use(remarkGfm, {
      singleTilde: false, // Match parser config
    })
    .use(remarkMath)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkWikiLinks)
    .use(remarkDetailsBlock)
    .use(remarkCustomInline);
}

/**
 * Strip unnecessary backslash escapes added by remark-stringify.
 *
 * remark-stringify defensively escapes characters like $, [, *, _, `
 * in text nodes to prevent them from being parsed as markdown syntax.
 * Since these characters were already in plain text (not markup) in the
 * MDAST, the escapes are redundant and visually noisy.
 *
 * We only strip escapes that are safe — block-level triggers at line
 * start (#, -, *, >, +) are preserved to avoid creating headings/lists.
 */
const SAFE_UNESCAPE_RE = /\\([[\]$`_*!])/g;

/** Characters that create block-level syntax at start of line. */
const BLOCK_START_CHARS = new Set(["#", "-", "*", ">", "+"]);

/** Build character ranges for fenced code blocks and inline code spans. */
function buildCodeRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const fenceRe = /^(`{3,}|~{3,}).*\n([\s\S]*?\n)\1\s*$/gm;
  let fm: RegExpExecArray | null;
  while ((fm = fenceRe.exec(markdown))) {
    ranges.push([fm.index, fm.index + fm[0].length]);
  }
  const inlineRe = /`[^`]+`/g;
  let im: RegExpExecArray | null;
  while ((im = inlineRe.exec(markdown))) {
    ranges.push([im.index, im.index + im[0].length]);
  }
  return ranges;
}

/** Apply a regex replacement only outside code blocks and inline code. */
function replaceOutsideCode(markdown: string, re: RegExp, replacement: string): string {
  const ranges = buildCodeRanges(markdown);
  const isInsideCode = (offset: number) =>
    ranges.some(([start, end]) => offset >= start && offset < end);
  return markdown.replace(re, (match, ...args) => {
    const offset = args[args.length - 2] as number;
    if (isInsideCode(offset)) return match;
    return match.replace(re, replacement);
  });
}

function stripUnnecessaryEscapes(markdown: string): string {
  const ranges = buildCodeRanges(markdown);
  const isInsideCode = (offset: number) =>
    ranges.some(([start, end]) => offset >= start && offset < end);

  return markdown.replace(SAFE_UNESCAPE_RE, (match, char: string, offset: number) => {
    if (isInsideCode(offset)) return match;

    const lineStart = markdown.lastIndexOf("\n", offset - 1) + 1;
    const beforeOnLine = markdown.slice(lineStart, offset).trimStart();

    if (beforeOnLine === "" && BLOCK_START_CHARS.has(char)) {
      return match;
    }

    return char;
  });
}

/**
 * Serialize MDAST to markdown text.
 *
 * @param mdast - The MDAST root node to serialize
 * @returns The markdown text
 *
 * @example
 * const md = serializeMdastToMarkdown(mdast);
 * // "# Hello\n\nWorld\n"
 */
export function serializeMdastToMarkdown(
  mdast: Root,
  options: MarkdownPipelineOptions = {}
): string {
  const processor = createSerializer(options);
  let result = processor.stringify(mdast);

  // Convert encoded space entities back to regular spaces.
  // mdast-util-to-markdown encodes spaces as &#x20; when they appear
  // before/after line breaks, but this is unnecessary for our use case.
  result = result.replace(/&#x20;/g, " ");

  // Strip unnecessary backslash escapes added by remark-stringify
  result = stripUnnecessaryEscapes(result);

  if (options.hardBreakStyle === "twoSpaces") {
    // Replace backslash line breaks with two-space breaks, but skip code fences.
    result = replaceOutsideCode(result, /\\(\r?\n)/g, "  $1");
  }
  return result;
}
