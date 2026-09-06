/**
 * Markdown Serializer (remark-stringify based)
 *
 * Purpose: Serializes MDAST back to markdown text with consistent formatting.
 * The serializer configuration determines VMark's canonical markdown style.
 *
 * Key decisions:
 *   - Bullet: `-` (not `*`), emphasis: `*`, strong: `**`, fence: backtick
 *   - listItemIndent: "one" — minimizes diff noise compared to "tab"
 *   - Custom handlers for image/link (serializerHandlers.ts): angle brackets
 *     for URLs with spaces instead of percent-encoding, and autolink
 *     preservation for links whose text equals their URL (#1102)
 *   - tocToMarkdown handler serializes `toc` MDAST nodes back to `[TOC]` text
 *   - A verified cosmetic pass converts serializer-emitted &#x20; entities
 *     back to spaces and strips defensive backslash escapes ($, [, ], *, _,
 *     `, !, (, ), :, @) — but only when re-parsing the cleaned output yields the
 *     exact same mdast as the conservative output, so it can never change
 *     document meaning (audit H6/H7).
 *   - hardBreakStyle option converts `\` breaks to two-space breaks
 *   - join re-emits captured blank-line runs (blankLinesJoin, ADR-1a)
 *
 * @coordinates-with parser.ts — plugins must match between parser and serializer
 * @coordinates-with adapter.ts — wraps this with error handling
 * @coordinates-with serializerHandlers.ts — custom image/link to-markdown handlers
 * @module utils/markdownPipeline/serializer
 */

import { unified } from "unified";
import remarkStringify from "remark-stringify";
import { handleDelete, repairSplitSurrogateEntities } from "./serializerStrikethrough";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import type { Root } from "mdast";
import { remarkCustomInline, remarkDetailsBlock, remarkWikiLinks, tocToMarkdown } from "./plugins";
import { handleImage, handleLink, blankLinesJoin } from "./serializerHandlers";
import type { MarkdownPipelineOptions } from "./types";
import { parseMarkdownToMdast } from "./parser";
import {
  applyCosmeticPass,
  buildCodeRanges,
  replaceOutsideCode,
} from "./serializerCosmetics";

/**
 * Build the unified processor configured for VMark markdown serialization.
 *
 * Plugins (must match parser configuration):
 * - remark-stringify: Base CommonMark serializer
 * - remark-gfm: GitHub Flavored Markdown output
 * - remark-math: Math output ($...$ and $$...$$)
 * - remark-frontmatter: YAML frontmatter output
 * - remarkCustomInline: Custom inline marks (==highlight==, ~sub~, etc.)
 *
 * The plugin set is fully static — it has no content- or option-dependent
 * branches — so getSerializer() builds it once and reuses it across every
 * serialize call.
 */
function buildSerializer() {
  // Cast inline: `join` is forwarded to mdast-util-to-markdown at runtime but
  // absent from remark-stringify's published Options type.
  return unified()
    .use(remarkStringify, {
      bullet: "-", // Use - for unordered lists
      bulletOther: "*", // Fallback bullet
      bulletOrdered: ".", // Use . for ordered lists
      emphasis: "*", // Use * for emphasis (single: *italic*)
      strong: "*", // Use * for strong (double: **bold**)
      fence: "`", // Use ` for code fences
      fences: true, // Use fenced code blocks
      rule: "-", // Use --- for thematic breaks
      listItemIndent: "one", // Use one space indent for list items
      handlers: {
        image: handleImage,
        link: handleLink,
        // `~~` obeys the same flanking rules as `*`, but the gfm
        // strikethrough extension never adopted remark's neighbour-encoding
        // fix — so `plain~~* word~~` was emitted as literal text on reparse.
        delete: handleDelete,
        ...tocToMarkdown.handlers,
      } as Record<string, unknown>,
      join: [blankLinesJoin], // re-emit captured blank-line runs (ADR-1a)
    } as Parameters<typeof remarkStringify>[0])
    .use(remarkGfm, {
      singleTilde: false, // Match parser config
    })
    .use(remarkMath)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkWikiLinks)
    .use(remarkDetailsBlock)
    .use(remarkCustomInline);
}

let cachedSerializer: ReturnType<typeof buildSerializer> | undefined;

/** Return the shared serialization processor, building it on first use. */
function getSerializer() {
  cachedSerializer ??= buildSerializer();
  return cachedSerializer;
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
  const processor = getSerializer();
  let result = processor.stringify(mdast);

  // Correctness, not cosmetics: the attention-encoding that makes a delimiter
  // flank splits an astral neighbour across its surrogate pair, destroying the
  // character. Repaired here — before every other pass, and with no size
  // ceiling.
  result = repairSplitSurrogateEntities(result);

  // A document-leading thematic break can serialize as `---` and then be
  // REPARSED as a frontmatter fence, swallowing structure (CommonMark
  // examples 43/47/77). But that only happens when something later closes
  // the fence — a lone `---` rule reparses as a thematic break exactly as
  // written. So VERIFY rather than assume: swap to `***` only when the
  // reparse actually turns the break into frontmatter. Assuming cost real
  // fidelity — typing `---` in an empty document came back as `***`.
  if (mdast.children[0]?.type === "thematicBreak" && result.startsWith("---")) {
    if (parseMarkdownToMdast(result).children[0]?.type !== "thematicBreak") {
      result = `***${result.slice(3)}`;
    }
  }

  // Verified cosmetic pass: restore serializer-emitted &#x20; entities and
  // strip defensive escapes, accepted only when the cleaned string re-parses
  // identically to the conservative one (audit H6/H7).
  result = applyCosmeticPass(result);

  if (options.hardBreakStyle === "twoSpaces") {
    // Escape stripping may have shortened the string, shifting offsets —
    // rebuild ranges for the post-strip string before the hard-break pass.
    result = replaceOutsideCode(result, /\\(\r?\n)/g, "  $1", buildCodeRanges(result));
  }
  return result;
}
