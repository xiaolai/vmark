/**
 * Markdown parser using remark
 *
 * Parses markdown text into MDAST (Markdown Abstract Syntax Tree).
 * Uses unified with remark-parse, remark-gfm, remark-math, and remark-frontmatter.
 *
 * @module utils/markdownPipeline/parser
 */

import { unified, type Plugin } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkBreaks from "remark-breaks";
import type { Root, Parent, Text } from "mdast";
import type { InlineMath } from "mdast-util-math";
import { remarkCustomInline, remarkDetailsBlock, remarkResolveReferences, remarkWikiLinks } from "./plugins";
import type { MarkdownPipelineOptions } from "./types";
import { perfStart, perfEnd } from "@/utils/perfLog";

/**
 * Escape placeholders for custom inline markers.
 * Uses Unicode Private Use Area to avoid conflicts with normal text.
 *
 * When users write \== or \++ etc., they want literal markers, not formatting.
 * Since remark processes backslash escapes before our plugin runs, we need to
 * pre-process these patterns into placeholders, then restore them after parsing.
 */
const ESCAPE_PATTERNS: Array<{ pattern: RegExp; placeholder: string; restore: string }> = [
  { pattern: /\\==/g, placeholder: "\uE001\uE001", restore: "==" },
  { pattern: /\\\+\+/g, placeholder: "\uE002\uE002", restore: "++" },
  { pattern: /\\\^/g, placeholder: "\uE003", restore: "^" },
  { pattern: /\\~/g, placeholder: "\uE004", restore: "~" },
];

/**
 * Pre-process markdown to handle escaped custom markers.
 * Replaces \== \++ \^ \~ with Unicode placeholders before remark parsing.
 */
function preprocessEscapedMarkers(markdown: string): string {
  let result = markdown;
  for (const { pattern, placeholder } of ESCAPE_PATTERNS) {
    result = result.replace(pattern, placeholder);
  }
  return result;
}

/**
 * Restore placeholders back to literal marker characters in the parsed tree.
 */
function restoreEscapedMarkers(tree: Root): void {
  visitAndRestoreText(tree);
}

function visitAndRestoreText(node: Root | Parent): void {
  if (!("children" in node) || !Array.isArray(node.children)) return;

  for (const child of node.children) {
    if (child.type === "text") {
      const textNode = child as Text;
      for (const { placeholder, restore } of ESCAPE_PATTERNS) {
        if (textNode.value.includes(placeholder)) {
          textNode.value = textNode.value.split(placeholder).join(restore);
        }
      }
    }
    if ("children" in child && Array.isArray((child as Parent).children)) {
      visitAndRestoreText(child as Parent);
    }
  }
}

/**
 * Plugin to validate inline math and convert invalid ones back to text.
 * Invalid inline math: content with leading or trailing whitespace.
 * This prevents `$100 and $200` from being parsed as math.
 */
const remarkValidateMath: Plugin<[], Root> = function () {
  return (tree: Root) => {
    visitAndFixMath(tree);
  };
};

function visitAndFixMath(node: Root | Parent): void {
  if (!("children" in node) || !Array.isArray(node.children)) return;

  // Type-safe children array using unknown to avoid strict type conflicts
  const newChildren: unknown[] = [];
  let modified = false;

  for (const child of node.children) {
    if (child.type === "inlineMath") {
      const mathNode = child as InlineMath;
      const value = mathNode.value || "";
      // Reject math with leading/trailing whitespace
      if (/^\s/.test(value) || /\s$/.test(value)) {
        // Convert back to text with dollar delimiters
        newChildren.push({
          type: "text",
          value: `$${value}$`,
        });
        modified = true;
        continue;
      }
    }

    // Recurse into children
    if ("children" in child && Array.isArray((child as Parent).children)) {
      visitAndFixMath(child as Parent);
    }
    newChildren.push(child);
  }

  if (modified) {
    // Use type assertion to assign the modified children array
    (node as { children: unknown[] }).children = newChildren;
  }
}

/**
 * Content analysis for lazy plugin loading.
 * Returns flags indicating which optional plugins are needed.
 */
interface ContentAnalysis {
  hasMath: boolean;
  hasFrontmatter: boolean;
  hasWikiLinks: boolean;
  hasDetails: boolean;
}

/**
 * Analyze markdown content to determine which plugins are needed.
 * This enables lazy loading of plugins for better performance.
 */
function analyzeContent(markdown: string): ContentAnalysis {
  return {
    // Math: look for $ or $$ (quick heuristic)
    hasMath: markdown.includes("$"),
    // Frontmatter: must start with ---
    hasFrontmatter: markdown.startsWith("---"),
    // Wiki links: look for [[
    hasWikiLinks: markdown.includes("[["),
    // Details block: look for <details pattern
    hasDetails: markdown.includes("<details"),
  };
}

/**
 * Unified processor configured for VMark markdown parsing.
 *
 * Plugins are loaded lazily based on content analysis:
 * - remark-parse: Always (base CommonMark parser)
 * - remark-gfm: Always (tables, task lists, strikethrough, autolinks)
 * - remark-math: Only if document contains `$`
 * - remark-frontmatter: Only if document starts with `---`
 * - remarkWikiLinks: Only if document contains `[[`
 * - remarkDetailsBlock: Only if document contains `<details`
 *
 * Custom inline syntax (==highlight==, ~sub~, ^sup^, ++underline++)
 * is handled via remarkCustomInline plugin (always loaded, lightweight).
 */
function createProcessor(markdown: string, options: MarkdownPipelineOptions = {}) {
  const analysis = analyzeContent(markdown);

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm, {
      // Disable single tilde strikethrough to avoid conflict with subscript
      // GFM strikethrough uses ~~double tilde~~
      singleTilde: false,
    });

  // Conditionally add math support
  if (analysis.hasMath) {
    processor.use(remarkMath);
    processor.use(remarkValidateMath);
  }

  // Conditionally add frontmatter support
  if (analysis.hasFrontmatter) {
    processor.use(remarkFrontmatter, ["yaml"]);
  }

  // Conditionally add wiki links support
  if (analysis.hasWikiLinks) {
    processor.use(remarkWikiLinks);
  }

  // Conditionally add details block support
  if (analysis.hasDetails) {
    processor.use(remarkDetailsBlock);
  }

  // Always load custom inline (lightweight, common syntax)
  processor.use(remarkCustomInline);

  // Always load reference resolver (needed for GFM references)
  processor.use(remarkResolveReferences);

  if (options.preserveLineBreaks) {
    processor.use(remarkBreaks);
  }

  return processor;
}

/**
 * Parse markdown text into MDAST.
 *
 * @param markdown - The markdown text to parse
 * @returns The root MDAST node
 *
 * @example
 * const mdast = parseMarkdownToMdast("# Hello\n\nWorld");
 * // mdast.type === "root"
 * // mdast.children[0].type === "heading"
 * // mdast.children[1].type === "paragraph"
 */
export function parseMarkdownToMdast(
  markdown: string,
  options: MarkdownPipelineOptions = {}
): Root {
  // Pre-process escaped custom markers before remark parsing
  const preprocessed = preprocessEscapedMarkers(markdown);

  perfStart("createProcessor");
  const processor = createProcessor(preprocessed, options);
  perfEnd("createProcessor");

  perfStart("remarkParse");
  const result = processor.parse(preprocessed);
  perfEnd("remarkParse");

  // Run transforms (plugins that modify the tree)
  perfStart("remarkRunSync");
  const transformed = processor.runSync(result);
  perfEnd("remarkRunSync");

  // Restore escaped markers back to literal characters
  restoreEscapedMarkers(transformed as Root);

  return transformed as Root;
}
