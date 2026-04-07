/**
 * Markdown Parser (remark-based)
 *
 * Purpose: Parses markdown text into MDAST (Markdown Abstract Syntax Tree)
 * with support for GFM, math, frontmatter, wiki links, and custom inline syntax.
 *
 * Pipeline: markdown string → preprocessEscapedMarkers → unified/remark → MDAST
 *
 * Key decisions:
 *   - Lazy plugin loading based on content analysis (analyzeContent) — avoids
 *     loading remark-math/frontmatter/etc. when content doesn't use them
 *   - remarkTocBlock converts `[TOC]` paragraphs to toc MDAST nodes (always loaded)
 *   - Custom escape preprocessing using Unicode Private Use Area placeholders
 *     because remark processes backslash escapes before our plugins run
 *   - remarkValidateMath rejects `$100 and $200` (leading/trailing whitespace)
 *     to prevent false positives from dollar signs in prose
 *   - singleTilde disabled in remark-gfm to avoid conflict with subscript syntax
 *
 * @coordinates-with serializer.ts — reverse direction (MDAST → markdown string)
 * @coordinates-with adapter.ts — wraps this with error handling and perf logging
 * @coordinates-with parsingCache.ts — caches results of parseMarkdownToMdast
 * @module utils/markdownPipeline/parser
 */

import { unified, type Plugin } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkBreaks from "remark-breaks";
import type { Root, Parent, Text, List, ListItem, Paragraph } from "mdast";
import type { InlineMath } from "mdast-util-math";
import { remarkCustomInline, remarkDetailsBlock, remarkResolveReferences, remarkTocBlock, remarkWikiLinks } from "./plugins";
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
const ESCAPE_PATTERNS: Array<{ sequence: string; placeholder: string; restore: string }> = [
  { sequence: "\\==", placeholder: "\uE001\uE001", restore: "==" },
  { sequence: "\\++", placeholder: "\uE002\uE002", restore: "++" },
  { sequence: "\\^", placeholder: "\uE003", restore: "^" },
  { sequence: "\\~", placeholder: "\uE004", restore: "~" },
];

/**
 * Pre-process markdown to handle escaped custom markers.
 * Replaces \== \++ \^ \~ with Unicode placeholders before remark parsing.
 *
 * Important: Do NOT touch code spans or fenced code blocks. Backslash escapes
 * are literal inside code, and replacing them would corrupt code content.
 */
function preprocessEscapedMarkers(markdown: string): string {
  let out = "";

  let inInlineCode = false;
  let inlineFenceLen = 0;

  let inFencedCodeBlock = false;
  let fencedChar: "`" | "~" | "" = "";
  let fencedLen = 0;

  const getLineEnd = (from: number): number => {
    const idx = markdown.indexOf("\n", from);
    return idx === -1 ? markdown.length : idx;
  };

  const getLineForFenceDetection = (line: string): string => {
    return line.endsWith("\r") ? line.slice(0, -1) : line;
  };

  for (let i = 0; i < markdown.length; ) {
    const atLineStart = i === 0 || markdown[i - 1] === "\n";

    // Fenced code blocks are line-based; handle by copying whole lines verbatim.
    if (atLineStart && !inInlineCode) {
      const lineEnd = getLineEnd(i);
      const line = markdown.slice(i, lineEnd);
      const lineForDetect = getLineForFenceDetection(line);

      if (!inFencedCodeBlock) {
        const openMatch = lineForDetect.match(/^ {0,3}(`{3,}|~{3,})/);
        if (openMatch) {
          inFencedCodeBlock = true;
          fencedChar = openMatch[1][0] as "`" | "~";
          fencedLen = openMatch[1].length;

          out += line;
          if (lineEnd < markdown.length) out += "\n";
          i = lineEnd < markdown.length ? lineEnd + 1 : lineEnd;
          continue;
        }
      } else {
        // fencedChar is always truthy when inFencedCodeBlock=true (invariant: set at open)
        const closeRe = new RegExp(
          `^ {0,3}\\${fencedChar}{${fencedLen},}(?=\\s|$)`
        );
        if (closeRe.test(lineForDetect)) {
          inFencedCodeBlock = false;
          fencedChar = "";
          fencedLen = 0;

          out += line;
          if (lineEnd < markdown.length) out += "\n";
          i = lineEnd < markdown.length ? lineEnd + 1 : lineEnd;
          continue;
        }
      }

      if (inFencedCodeBlock) {
        out += line;
        if (lineEnd < markdown.length) out += "\n";
        i = lineEnd < markdown.length ? lineEnd + 1 : lineEnd;
        continue;
      }
    }

    // Dead path: the line-based fast path (above) always advances i to the next line start,
    // so atLineStart is always true when inFencedCodeBlock=true outside inline code.
    /* v8 ignore next 4 -- @preserve structurally unreachable: fenced block chars are always consumed by the line-based path at line-start; this char-by-char fallback cannot be reached in practice */
    if (inFencedCodeBlock) {
      out += markdown[i];
      i += 1;
      continue;
    }

    // Inline code spans (backticks). Copy verbatim while inside.
    if (markdown[i] === "`") {
      let runLen = 1;
      while (i + runLen < markdown.length && markdown[i + runLen] === "`") {
        runLen += 1;
      }

      if (!inInlineCode) {
        inInlineCode = true;
        inlineFenceLen = runLen;
      } else if (runLen === inlineFenceLen) {
        inInlineCode = false;
        inlineFenceLen = 0;
      }

      out += markdown.slice(i, i + runLen);
      i += runLen;
      continue;
    }

    if (inInlineCode) {
      out += markdown[i];
      i += 1;
      continue;
    }

    // Escaped markers outside code.
    if (markdown[i] === "\\") {
      const match = ESCAPE_PATTERNS.find(({ sequence }) =>
        markdown.startsWith(sequence, i)
      );
      if (match) {
        out += match.placeholder;
        i += match.sequence.length;
        continue;
      }
    }

    out += markdown[i];
    i += 1;
  }

  return out;
}

/**
 * Restore placeholders back to literal marker characters in the parsed tree.
 */
function restoreEscapedMarkers(tree: Root): void {
  visitAndRestoreText(tree);
}

function visitAndRestoreText(node: Root | Parent): void {
  /* v8 ignore next -- @preserve defensive guard: always called with Root or Parent nodes that have children; the guard protects against unexpected leaf nodes in future callers */
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
  /* v8 ignore next -- @preserve defensive guard: always called with Root or Parent nodes; protects against leaf nodes passed in future refactors */
  if (!("children" in node) || !Array.isArray(node.children)) return;

  // Type-safe children array using unknown to avoid strict type conflicts
  const newChildren: unknown[] = [];
  let modified = false;

  for (const child of node.children) {
    if (child.type === "inlineMath") {
      const mathNode = child as InlineMath;
      /* v8 ignore next -- @preserve remark-math always sets value to a string; the || "" fallback guards against hypothetical undefined from future parser versions */
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
/**
 * Disable setext heading parsing (underline-style headings with `---` or `===`).
 *
 * VMark always serializes headings as ATX (`#`), never setext. Disabling setext
 * parsing prevents a common misparse: an empty nested list item (`  -`) being
 * interpreted as a setext heading underline for the preceding paragraph.
 *
 * This is an intentional compatibility trade-off for VMark:
 * - VMark's serializer never produces setext headings (always ATX `#`)
 * - Setext input (`Heading\n---`) is rare in practice and can always be
 *   written as `## Heading` instead
 * - The misparse of `  -` as heading underline causes data corruption
 */
const remarkDisableSetextHeadings: Plugin<[], Root> = function () {
  const data = this.data();
  const micromarkExtensions =
    (data.micromarkExtensions as unknown[]) || ((data as Record<string, unknown>).micromarkExtensions = []);
  micromarkExtensions.push({
    disable: { null: ["setextUnderline"] },
  });
};

function createProcessor(markdown: string, options: MarkdownPipelineOptions = {}) {
  const analysis = analyzeContent(markdown);

  const processor = unified()
    .use(remarkParse)
    .use(remarkDisableSetextHeadings)
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

  // Always load TOC block detection (lightweight, checks single-text paragraphs)
  processor.use(remarkTocBlock);

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
/**
 * Normalize bare list markers that lack a trailing space.
 *
 * CommonMark requires `- ` (dash + space) for a list item. A bare `  -` at end
 * of line is NOT a valid list marker — it becomes paragraph text. Users commonly
 * type `  -` expecting an empty nested list item, so we add the trailing space.
 *
 * Only matches indented markers (1–4 spaces) to avoid touching top-level text.
 * Skips fenced code blocks to avoid corrupting code content.
 */
/** @internal Exported for testing */
export function normalizeBareListMarkers(markdown: string): { text: string; modified: boolean } {
  const lines = markdown.split("\n");
  let inFencedBlock = false;
  let fenceChar = "";
  let fenceLen = 0;
  let modified = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.replace(/\r$/, "");

    // Track fenced code blocks
    if (!inFencedBlock) {
      const openMatch = trimmed.match(/^ {0,3}(`{3,}|~{3,})/);
      if (openMatch) {
        inFencedBlock = true;
        fenceChar = openMatch[1][0];
        fenceLen = openMatch[1].length;
        continue;
      }
    } else {
      const closeRe = new RegExp(`^ {0,3}\\${fenceChar}{${fenceLen},}\\s*$`);
      if (closeRe.test(trimmed)) {
        inFencedBlock = false;
        fenceChar = "";
        fenceLen = 0;
      }
      continue;
    }

    // Match: bare indented list markers (no content after marker, or only whitespace).
    // In CommonMark, an empty list item cannot interrupt a paragraph.
    // Insert a blank line before it so the paragraph ends first,
    // and ensure a trailing space so the marker is valid.
    // Only match markers that need fixing: no trailing space, or missing blank line.
    if (/^ {1,4}[-+*][ \t]*$/.test(trimmed)) {
      let changed = false;
      // Add blank line before if previous line is non-blank (paragraph interruption fix)
      if (i > 0 && lines[i - 1].trim() !== "") {
        lines.splice(i, 0, "");
        i++; // skip the blank line we just inserted
        changed = true;
      }
      // Ensure at least one space after the marker
      const fixed = trimmed.replace(/^( {1,4}[-+*])[ \t]*$/, "$1 ");
      if (fixed !== lines[i]) {
        lines[i] = fixed;
        changed = true;
      }
      if (changed) modified = true;
    }
  }

  return { text: lines.join("\n"), modified };
}

/**
 * Fix spread artifacts from normalizeBareListMarkers.
 *
 * The normalizer inserts blank lines before bare markers so CommonMark parses
 * them correctly, but this makes the containing listItem "loose" (spread: true).
 * remark-stringify then emits blank lines between the item's children on
 * round-trip, which the user didn't write. Reset spread on listItems that
 * became loose solely because they contain a nested list with empty items.
 */
function fixNormalizationSpread(node: Root | Parent): void {
  /* v8 ignore next -- @preserve defensive guard: always called with Root or Parent nodes; protects against unexpected leaf nodes in recursive calls */
  if (!("children" in node) || !Array.isArray(node.children)) return;

  for (const child of node.children) {
    if ("children" in child && Array.isArray((child as Parent).children)) {
      fixNormalizationSpread(child as Parent);
    }

    // Fix listItem spread when it contains a nested list with empty items
    if (child.type === "listItem") {
      const li = child as ListItem;
      if (li.spread && hasNestedEmptyListItem(li)) {
        li.spread = false;
      }
    }

    // Fix list spread: if no children are spread, the list shouldn't be either
    if (child.type === "list") {
      const list = child as List;
      if (list.spread) {
        const anyChildSpread = list.children.some((item) => item.spread);
        if (!anyChildSpread) {
          list.spread = false;
        }
      }
    }
  }
}

function hasNestedEmptyListItem(li: ListItem): boolean {
  for (const child of li.children) {
    if (child.type === "list") {
      const list = child as List;
      for (const item of list.children) {
        if (isEmptyListItem(item)) return true;
      }
    }
  }
  return false;
}

function isEmptyListItem(li: ListItem): boolean {
  if (li.children.length === 0) return true;
  if (li.children.length === 1 && li.children[0].type === "paragraph") {
    const para = li.children[0] as Paragraph;
    return (
      para.children.length === 0 ||
      (para.children.length === 1 &&
        para.children[0].type === "text" &&
        !(para.children[0] as Text).value.trim())
    );
  }
  return false;
}

export function parseMarkdownToMdast(
  markdown: string,
  options: MarkdownPipelineOptions = {}
): Root {
  // Normalize bare list markers (e.g., "  -\n") to ensure trailing space
  const { text: normalized, modified: wasNormalized } = normalizeBareListMarkers(markdown);
  // Pre-process escaped custom markers before remark parsing
  const preprocessed = preprocessEscapedMarkers(normalized);

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

  // Fix spread artifacts only when normalization inserted blank lines
  if (wasNormalized) {
    fixNormalizationSpread(transformed as Root);
  }

  return transformed as Root;
}

/**
 * Create a markdown processor for lint use.
 *
 * Same plugin stack as the editor pipeline but:
 * - Always loads ALL plugins (math, frontmatter, wiki-links, details)
 * - Skips normalizeBareListMarkers (preserves original positions)
 * - Skips preprocessEscapedMarkers (lint checks raw source)
 *
 * Returns a unified Processor — call `.parse(source)` for MDAST with
 * accurate position data, then `.runSync(tree)` for transforms.
 */
export function createMarkdownProcessor() {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDisableSetextHeadings)
    .use(remarkGfm, { singleTilde: false })
    .use(remarkMath)
    .use(remarkValidateMath)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkWikiLinks)
    .use(remarkDetailsBlock)
    .use(remarkTocBlock)
    .use(remarkCustomInline)
    .use(remarkResolveReferences);

  return processor;
}
