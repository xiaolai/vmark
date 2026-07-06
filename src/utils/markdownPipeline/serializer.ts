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
 *     exact same mdast as the conservative output. This guarantees the
 *     cosmetic pass can never change document meaning (audit H6/H7: the old
 *     unverified pass corrupted literal &#x20; in code blocks and turned
 *     escaped text like \_bar\_ into real emphasis on round trip).
 *   - hardBreakStyle option converts `\` breaks to two-space breaks
 *
 * @coordinates-with parser.ts — plugins must match between parser and serializer
 * @coordinates-with adapter.ts — wraps this with error handling
 * @coordinates-with serializerHandlers.ts — custom image/link to-markdown handlers
 * @module utils/markdownPipeline/serializer
 */

import { unified } from "unified";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import type { Root } from "mdast";
import { remarkCustomInline, remarkDetailsBlock, remarkWikiLinks, tocToMarkdown } from "./plugins";
import { handleImage, handleLink } from "./serializerHandlers";
import { parseMarkdownToMdast } from "./parser";
import type { MarkdownPipelineOptions } from "./types";

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

let cachedSerializer: ReturnType<typeof buildSerializer> | undefined;

/** Return the shared serialization processor, building it on first use. */
function getSerializer() {
  cachedSerializer ??= buildSerializer();
  return cachedSerializer;
}

/**
 * Strip unnecessary backslash escapes added by remark-stringify.
 *
 * remark-stringify defensively escapes characters like $, [, *, _, `, (, )
 * in text nodes to prevent them from being parsed as markdown syntax — and,
 * with the GFM autolink-literal extension, : and @ in URL-like text (e.g.
 * inside link labels). Since these characters were already in plain text
 * (not markup) in the MDAST, the escapes are redundant and visually noisy.
 *
 * We only strip escapes that are safe — block-level triggers at line
 * start (#, -, *, >, +) are preserved to avoid creating headings/lists,
 * and the whole pass is gated on a byte-identical re-parse.
 */
const SAFE_UNESCAPE_RE = /\\([[\]$`_*!():@])/g;

/** Characters that create block-level syntax at start of line. */
const BLOCK_START_CHARS = new Set(["#", "-", "*", ">", "+"]);

/**
 * Build sorted, merged character ranges for fenced code blocks and inline
 * code spans. Ranges are non-overlapping and sorted by start, enabling
 * O(log N) `isInsideCode` lookups during escape processing.
 */
function buildCodeRanges(markdown: string): Array<[number, number]> {
  const raw: Array<[number, number]> = [];
  const fenceRe = /^(`{3,}|~{3,}).*\n([\s\S]*?\n)\1\s*$/gm;
  let fm: RegExpExecArray | null;
  while ((fm = fenceRe.exec(markdown))) {
    raw.push([fm.index, fm.index + fm[0].length]);
  }
  // Only treat unescaped backticks as code-span boundaries. Without this,
  // serialized plain text such as `[\`LICENSE\`]\(./LICENSE).` would falsely
  // register `\`LICENSE\`` as an inline code range, blocking later escape
  // stripping on the contained `\``.
  const inlineRe = /(?<!\\)`[^`]+?(?<!\\)`/g;
  let im: RegExpExecArray | null;
  while ((im = inlineRe.exec(markdown))) {
    raw.push([im.index, im.index + im[0].length]);
  }
  if (raw.length <= 1) return raw;
  raw.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const last = merged[merged.length - 1];
    const [s, e] = raw[i];
    if (s <= last[1]) {
      if (e > last[1]) last[1] = e;
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
}

/**
 * Binary-search a sorted, non-overlapping ranges array for whether `offset`
 * falls inside any range. O(log N) vs the previous O(N) `Array.some`.
 */
function isInsideCodeRange(
  ranges: Array<[number, number]>,
  offset: number
): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [s, e] = ranges[mid];
    if (s <= offset) {
      if (offset < e) return true;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return false;
}

/** Apply a regex replacement only outside code blocks and inline code. */
function replaceOutsideCode(
  markdown: string,
  re: RegExp,
  replacement: string,
  ranges: Array<[number, number]>
): string {
  return markdown.replace(re, (match, ...args) => {
    const offset = args[args.length - 2] as number;
    if (isInsideCodeRange(ranges, offset)) return match;
    return match.replace(re, replacement);
  });
}

/** One pending cosmetic replacement on the serialized string. */
interface CosmeticEdit {
  start: number;
  end: number;
  replacement: string;
}

const SPACE_ENTITY = "&#x20;";

/**
 * Collect &#x20; entities that look serializer-emitted: a single entity at a
 * line boundary, outside code, and not part of user text (which arrives
 * escaped as \&#x20;). Runs of two or more entities are left alone — turning
 * them into literal spaces could create hard breaks or indented code.
 */
function collectEntityEdits(
  markdown: string,
  ranges: Array<[number, number]>
): CosmeticEdit[] {
  const edits: CosmeticEdit[] = [];
  const re = /&#x20;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const start = m.index;
    const end = start + SPACE_ENTITY.length;
    if (isInsideCodeRange(ranges, start)) continue;
    if (markdown[start - 1] === "\\") continue;
    if (markdown.startsWith(SPACE_ENTITY, end)) continue;
    if (start >= SPACE_ENTITY.length && markdown.endsWith(SPACE_ENTITY, start)) continue;
    const atLineStart = start === 0 || markdown[start - 1] === "\n";
    const next = markdown[end];
    const atLineEnd =
      end === markdown.length ||
      next === "\n" ||
      next === "\r" ||
      // trailing space before a backslash hard break
      (next === "\\" && (markdown[end + 1] === "\n" || markdown[end + 1] === "\r"));
    if (atLineStart || atLineEnd) {
      edits.push({ start, end, replacement: " " });
    }
  }
  return edits;
}

/** Collect candidate escape strips, applying the same guards as before. */
function collectEscapeEdits(
  markdown: string,
  ranges: Array<[number, number]>
): CosmeticEdit[] {
  const edits: CosmeticEdit[] = [];
  const re = new RegExp(SAFE_UNESCAPE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const offset = m.index;
    if (isInsideCodeRange(ranges, offset)) continue;
    const char = m[1];
    const lineStart = markdown.lastIndexOf("\n", offset - 1) + 1;
    const beforeOnLine = markdown.slice(lineStart, offset).trimStart();
    if (beforeOnLine === "" && BLOCK_START_CHARS.has(char)) continue;
    edits.push({ start: offset, end: offset + 2, replacement: char });
  }
  return edits;
}

/** Apply non-overlapping, ascending edits to a string. */
function applyEdits(markdown: string, edits: CosmeticEdit[]): string {
  let out = "";
  let cursor = 0;
  for (const e of edits) {
    out += markdown.slice(cursor, e.start) + e.replacement;
    cursor = e.end;
  }
  return out + markdown.slice(cursor);
}

/**
 * Right-trim the final text child of each paragraph/heading. Serializer-
 * emitted trailing-space entities decode to spaces the next parse would trim
 * anyway; normalizing both sides keeps that long-accepted loss from forcing
 * the conservative (entity-bearing) output.
 */
function trimBlockFinalText(node: unknown): void {
  if (!node || typeof node !== "object") return;
  const n = node as { type?: string; children?: unknown[] };
  if (!Array.isArray(n.children)) return;
  for (const child of n.children) trimBlockFinalText(child);
  if ((n.type === "paragraph" || n.type === "heading") && n.children.length) {
    const last = n.children[n.children.length - 1] as { type?: string; value?: string };
    if (last.type === "text" && typeof last.value === "string") {
      last.value = last.value.replace(/[ \t]+$/, "");
    }
  }
}

/** Parse markdown and return a normalized, comparable JSON form (or null). */
function normalizedParse(markdown: string): string | null {
  try {
    const tree = parseMarkdownToMdast(markdown);
    const clone = JSON.parse(
      JSON.stringify(tree, (key, value) => (key === "position" ? undefined : value))
    ) as unknown;
    trimBlockFinalText(clone);
    return JSON.stringify(clone);
  } catch {
    return null;
  }
}

/**
 * Documents larger than this skip the cosmetic pass entirely: verification
 * costs a re-parse, and very large documents are routed to Source mode by the
 * large-file pipeline anyway. Conservative output is always correct.
 */
const COSMETIC_VERIFY_SIZE_LIMIT = 300_000;

/**
 * Apply the cosmetic pass (entity restoration + escape stripping) only if the
 * result re-parses to the exact same mdast as the conservative output. Falls
 * back to entity-edits-only, then to the conservative string. This makes
 * "the cosmetic pass never changes meaning" a structural invariant instead of
 * a per-character guess (audit H6/H7).
 */
function applyCosmeticPass(markdown: string): string {
  if (markdown.length > COSMETIC_VERIFY_SIZE_LIMIT) return markdown;
  const ranges = buildCodeRanges(markdown);
  const entityEdits = collectEntityEdits(markdown, ranges);
  const escapeEdits = collectEscapeEdits(markdown, ranges);
  if (!entityEdits.length && !escapeEdits.length) return markdown;

  const reference = normalizedParse(markdown);
  if (reference === null) return markdown;

  const allEdits = [...entityEdits, ...escapeEdits].sort((a, b) => a.start - b.start);
  const full = applyEdits(markdown, allEdits);
  if (normalizedParse(full) === reference) return full;

  if (escapeEdits.length && entityEdits.length) {
    const entityOnly = applyEdits(markdown, entityEdits);
    if (normalizedParse(entityOnly) === reference) return entityOnly;
  }
  return markdown;
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
