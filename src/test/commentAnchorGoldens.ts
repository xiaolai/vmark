/**
 * Comment anchor goldens — the shared fixture file the Rust comment-anchor
 * resolver (`include_str!`) and the production Markdown parser are both held
 * to, and the derivation of its parser-owned fields.
 *
 * Key decisions:
 *   - Every field the parser decides is derived here from the mdast it
 *     returns, never written by hand: each heading's depth, line offset and
 *     text, every heading path, and a widened anchor's block range. The quote,
 *     context, UTF-8 size and admission follow from those by the same rules
 *     the Rust module applies, so the golden pins one answer for both sides.
 *   - Root block ranges are pinned too (`blockCases`): they are what a
 *     widened anchor covers, so Rust's block scanner is held to them.
 *   - Only root-level headings count: a heading-like line inside a list item,
 *     a block quote, code or HTML is not a section heading.
 *   - A heading's text is its content's source slice (first inline child's
 *     start to last child's end), not its rendered text: Rust reads it from
 *     the line without an inline parser, and the slice is exact.
 *   - mdast positions describe the text the parser actually read. The
 *     pipeline rewrites some input first (math guards, bare list markers,
 *     escaped custom markers); a golden whose text any of those would change
 *     is refused loudly instead of yielding shifted offsets.
 *   - Offsets are UTF-16 code units; context is up to 32 units each side,
 *     one shorter rather than split a surrogate pair.
 *
 * @coordinates-with src-tauri/src/agent_journal/comment_anchor.rs — the Rust side of the same rules
 * @coordinates-with scripts/gen-comment-anchor-goldens.ts — rewrites the derived fields
 * @module test/commentAnchorGoldens
 */

import type { Root } from "mdast";
import { escapeUnclosedMathFences, normalizeMathDelimiters } from "@/utils/markdownPipeline/parser/mathSourceGuards";
import { normalizeBareListMarkers } from "@/utils/markdownPipeline/parser/listNormalization";

export const GOLDEN_PATH = `${import.meta.dirname}/fixtures/agentJournal/commentAnchorGoldens.json`;

interface GoldenHeading {
  depth: number;
  /** UTF-16 offset of the heading's first line start. */
  offset: number;
  text: string;
}

interface GoldenFixture {
  id: string;
  category: string;
  markdown: string;
  selection: { start: number; end: number; precision: "exact" | "approximate" };
  expect: {
    outcome: "exact" | "widened";
    start: number;
    end: number;
    quote: string;
    prefix: string;
    suffix: string;
    headingPath: string[];
    quoteUtf8Bytes: number;
    admission: "accepted" | "refused";
    selfAmbiguous: boolean;
  };
}

interface GoldenScenario {
  id: string;
  markdown: string;
  selection: { start: number; end: number };
  headingPath: string[];
  edited: string;
  expect: { status: "resolved" | "ambiguous" | "orphaned"; tier: 1 | 2 | 3 | null };
  hintIsCandidate: boolean;
}

interface HeadingCase {
  id: string;
  markdown: string;
  headings: GoldenHeading[];
}

/** A document's root block ranges (UTF-16 `[start, end]`), the units a widened anchor covers. */
interface BlockCase {
  id: string;
  markdown: string;
  blocks: [number, number][];
}

export interface CommentAnchorGoldens {
  contextUnits: number;
  maxQuoteUtf8Bytes: number;
  fixtures: GoldenFixture[];
  scenarios: GoldenScenario[];
  headingCases: HeadingCase[];
  blockCases: BlockCase[];
}

export type ParseMarkdown = (markdown: string) => Root;

const CONTEXT_UNITS = 32;
const MAX_QUOTE_UTF8_BYTES = 4096;

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
/** True when `i` falls between the two halves of a surrogate pair. */
const splitsPair = (s: string, i: number) => i > 0 && i < s.length && isHigh(s.charCodeAt(i - 1)) && isLow(s.charCodeAt(i));

/** Refuse a golden whose text the parser's preprocessing would rewrite: its positions would not be this text's. */
export function assertParsedAsWritten(markdown: string): void {
  if (/\\(==|\+\+|\^|~)/.test(markdown)) throw new Error(`golden text holds an escaped custom marker the parser rewrites: ${JSON.stringify(markdown)}`);
  const guarded = normalizeBareListMarkers(escapeUnclosedMathFences(normalizeMathDelimiters(markdown))).text;
  if (guarded !== markdown) throw new Error(`golden text is rewritten before parsing: ${JSON.stringify(markdown)}`);
}

/** Any mdast node, extension nodes included: only its type and position are read. */
type Positioned = { readonly type: string; readonly position?: Root["position"] };

function span(node: Positioned): { start: number; end: number } {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) throw new Error(`a ${node.type} node has no position`);
  return { start, end };
}

/** The root-level headings of `markdown`, as the production parser reads them. */
function rootHeadings(markdown: string, parse: ParseMarkdown): GoldenHeading[] {
  assertParsedAsWritten(markdown);
  return parse(markdown).children.flatMap((node) => {
    if (node.type !== "heading") return [];
    const at = span(node).start;
    const offset = markdown.lastIndexOf("\n", at - 1) + 1;
    const kids = node.children;
    const text = kids.length === 0 ? "" : markdown.slice(span(kids[0]).start, span(kids[kids.length - 1]).end);
    return [{ depth: node.depth, offset, text }];
  });
}

/** The heading path (outermost first) of the section holding `offset`. */
function headingPathAt(headings: readonly GoldenHeading[], offset: number): string[] {
  const stack: GoldenHeading[] = [];
  for (const h of headings) {
    if (h.offset > offset) break;
    while (stack.length > 0 && stack[stack.length - 1].depth >= h.depth) stack.pop();
    stack.push(h);
  }
  return stack.map((h) => h.text);
}

/** The root blocks a widened selection covers: those touching it, else the next block, else the previous. */
function widen(markdown: string, parse: ParseMarkdown, start: number, end: number): { start: number; end: number } {
  const blocks = parse(markdown).children.map(span);
  const touching = blocks.filter((b) => b.start <= end && b.end >= start);
  const chosen = touching.length > 0 ? touching : [blocks.find((b) => b.start >= end) ?? blocks[blocks.length - 1]];
  if (chosen[0] === undefined) throw new Error("a widened golden has no block to widen to");
  return { start: chosen[0].start, end: chosen[chosen.length - 1].end };
}

function deriveFixture(f: GoldenFixture, parse: ParseMarkdown): GoldenFixture["expect"] {
  const md = f.markdown;
  let { start, end } = f.selection;
  const outcome = f.selection.precision === "exact" && start < end ? "exact" : "widened";
  if (outcome === "exact") {
    if (splitsPair(md, start)) start -= 1;
    if (splitsPair(md, end)) end += 1;
  } else {
    ({ start, end } = widen(md, parse, start, end));
  }
  let ps = Math.max(0, start - CONTEXT_UNITS);
  if (splitsPair(md, ps)) ps += 1;
  let se = Math.min(md.length, end + CONTEXT_UNITS);
  if (splitsPair(md, se)) se -= 1;
  const quote = md.slice(start, end);
  const quoteUtf8Bytes = new TextEncoder().encode(quote).length;
  return {
    outcome,
    start,
    end,
    quote,
    prefix: md.slice(ps, start),
    suffix: md.slice(end, se),
    headingPath: headingPathAt(rootHeadings(md, parse), start),
    quoteUtf8Bytes,
    admission: quoteUtf8Bytes <= MAX_QUOTE_UTF8_BYTES ? "accepted" : "refused",
    selfAmbiguous: f.expect.selfAmbiguous,
  };
}

/** `goldens` with every parser-derived field recomputed from `parse`; equal to its input when the file is current. */
export function deriveFromParser(goldens: CommentAnchorGoldens, parse: ParseMarkdown): CommentAnchorGoldens {
  return {
    ...goldens,
    contextUnits: CONTEXT_UNITS,
    maxQuoteUtf8Bytes: MAX_QUOTE_UTF8_BYTES,
    fixtures: goldens.fixtures.map((f) => ({ ...f, expect: deriveFixture(f, parse) })),
    scenarios: goldens.scenarios.map((s) => {
      assertParsedAsWritten(s.edited);
      return {
        ...s,
        headingPath: headingPathAt(rootHeadings(s.markdown, parse), s.selection.start),
      };
    }),
    headingCases: goldens.headingCases.map((c) => ({ ...c, headings: rootHeadings(c.markdown, parse) })),
    blockCases: goldens.blockCases.map((c) => {
      assertParsedAsWritten(c.markdown);
      return { ...c, blocks: parse(c.markdown).children.map((node): [number, number] => {
        const { start, end } = span(node);
        return [start, end];
      }) };
    }),
  };
}
