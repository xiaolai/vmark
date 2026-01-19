/**
 * Markdown serializer using remark-stringify
 *
 * Serializes MDAST (Markdown Abstract Syntax Tree) back to markdown text.
 * Uses unified with remark-stringify, remark-gfm, remark-math, and remark-frontmatter.
 *
 * @module utils/markdownPipeline/serializer
 */

import { unified } from "unified";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import type { Root, Image, Link, Parents } from "mdast";
import { remarkCustomInline, remarkDetailsBlock, remarkWikiLinks } from "./plugins";
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
      // Custom handlers for angle-bracket URL syntax
      handlers: {
        image: handleImage,
        link: handleLink,
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
  const result = processor.stringify(mdast);
  if (options.hardBreakStyle === "twoSpaces") {
    return result.replace(/\\(\r?\n)/g, "  $1");
  }
  return result;
}
