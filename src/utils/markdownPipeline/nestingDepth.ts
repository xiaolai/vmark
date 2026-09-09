/**
 * Pre-parse nesting guard: refuse a document deep enough to overflow the stack.
 *
 * Purpose: `remark-gfm`'s autolink-literal transform walks the tree via
 * `mdast-util-find-and-replace` → `unist-util-visit-parents`, which recurses
 * once per tree LEVEL. Deeply nested containers therefore blow the JS stack
 * inside `mdast-util-from-markdown`'s compile step — before any VMark code
 * sees the tree. Making VMark's own plugin walks iterative does not help; that
 * was tried and reverted, because the upstream recursion always runs first.
 *
 * So this refuses such a document up front, with a message that says what
 * happened. The alternative is `RangeError: Maximum call stack size exceeded`,
 * which names neither the document nor the cause.
 *
 * # This is NOT what the weekly soak was failing on
 *
 * Worth stating, because the two look identical in a log and the first reading
 * of #1374 was wrong. The soak's stderr names its input:
 *
 *     Input preview: "*a **a *a **a *a **a *a **a …"
 *
 * That is deep INLINE nesting, and its recursion was VMark's own
 * `walkAndReplace` in customInlineTransform.ts, fixed there by making the walk
 * iterative. This guard does not cover that shape and should not: inline
 * markers do not reliably build a deep tree, so charging for them would refuse
 * documents that parse perfectly well.
 *
 * What this guard covers is the CONTAINER shape — nested blockquotes and lists
 * — whose recursion is upstream and therefore cannot be removed from here.
 * Both are real; only one of them is what the soak reported.
 *
 * # Where the limit comes from
 *
 * Bisected ceilings for `"> ".repeat(d)`, one process per measurement:
 *
 *   | host                    | node      | ceiling |
 *   |-------------------------|-----------|---------|
 *   | macOS 26 arm64          | v24.16.0  | 4000 ok, 8000 fails |
 *   | Linux aarch64 (spark01) | v24.16.0  | ~5585   |
 *   | Linux aarch64 (spark02) | v22.13.1  | ~4843   |
 *
 * Two things follow. The ceiling MOVES with the Node version, so it is not a
 * constant to be looked up. And it moves with LOAD: the same input at the same
 * size was measured passing, overflowing, then passing again in three
 * consecutive runs, because a busy machine has less usable stack than an idle
 * one and the parse is not the only thing on it.
 *
 * `MAX_NESTING_DEPTH` is therefore set well below the LOWEST number any
 * measurement produced, not near it: 1000 against a measured 4843 is roughly
 * fivefold headroom, which is the margin that has to absorb a machine nobody
 * measured. Raising it toward the ceiling would reintroduce exactly the
 * load-dependent failure this replaces.
 *
 * A limit is only defensible if it never fires on real writing. The deepest
 * container nesting in this repository's own corpora is in single digits;
 * 1000 is past anything a person writes and short of anything that crashes.
 *
 * @coordinates-with parser.ts — calls checkNestingDepth before parsing
 * @module utils/markdownPipeline/nestingDepth
 */

/**
 * Deepest container nesting this pipeline will parse.
 *
 * See the header for the measurements. Do not raise this toward a measured
 * ceiling: the ceiling is a property of one idle machine on one Node version,
 * and the document has to parse on every other one.
 */
export const MAX_NESTING_DEPTH = 1000;

/** A fence opener/closer: three or more backticks or tildes, up to 3 indented. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * A list marker at the start of a line's content.
 *
 * The trailing space is required: `-a` is text and `- a` is a list item, and a
 * bare `-` on its own line is a thematic break rather than a container. `*`
 * without it would also catch the opening of emphasis.
 */
const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])(?: |\t|$)/;

/**
 * The deepest container nesting any single line opens.
 *
 * Counts blockquote markers and list indentation, which are the constructs
 * that make an mdast tree deep. Inline nesting is deliberately not counted:
 * `*_` repeated 12000 times parses without incident, because micromark does
 * not build a tree that deep for it, so charging for it would reject
 * documents that parse perfectly well.
 *
 * This is a SCAN, not a parse — it runs on every document, so it must stay
 * linear in input length and independent of nesting depth.
 */
export function maxContainerDepth(markdown: string): number {
  let max = 0;
  let fence: string | null = null;

  for (const line of markdown.split("\n")) {
    // Fenced code is not nesting. Without this, an indented code sample inside
    // a fence would be scored as deep nesting and could be refused.
    const fenceMatch = FENCE.exec(line);
    if (fence) {
      if (fenceMatch && line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1][0].repeat(3);
      continue;
    }

    let i = 0;
    let depth = 0;
    let spaces = 0;

    // Leading container markers: any mix of indentation and `>`.
    while (i < line.length) {
      const ch = line[i];
      if (ch === " ") {
        spaces += 1;
        i += 1;
      } else if (ch === "\t") {
        spaces += 4;
        i += 1;
      } else if (ch === ">") {
        // Indentation accumulated before this marker is list nesting that
        // contains it; two spaces is one level.
        depth += Math.floor(spaces / 2) + 1;
        spaces = 0;
        i += 1;
      } else {
        break;
      }
    }
    // Trailing indentation before actual content is list nesting too.
    depth += Math.floor(spaces / 2);

    // The list marker itself opens a level. Without this, `> > - a` scores 2
    // when the tree is blockquote > blockquote > list, and a ladder of
    // `  - a` lines is under-counted by one at every level.
    if (LIST_MARKER.test(line.slice(i))) depth += 1;

    if (depth > max) max = depth;
  }

  return max;
}

/**
 * Thrown when a document nests deeper than the parser can survive.
 *
 * A named class, not a message: `parseMarkdown` wraps parse failures with a
 * `cause`, so a caller that wants to tell "too deep" from "malformed" would
 * otherwise have to match prose through a wrapper — which breaks the first
 * time the wording is edited.
 *
 * Module-local on purpose. `isNestingTooDeep` is the interface, and it is the
 * one callers should use: a bare `instanceof` would miss the case the wrapper
 * creates, where the refusal arrives as the `cause` of a generic parse error.
 */
class NestingTooDeepError extends Error {
  readonly depth: number;
  readonly limit: number;

  constructor(depth: number, limit: number, message: string) {
    super(message);
    this.name = "NestingTooDeepError";
    this.depth = depth;
    this.limit = limit;
  }
}

/** Is `error` — or anything it wraps — a nesting refusal? */
export function isNestingTooDeep(error: unknown): boolean {
  let cursor: unknown = error;
  // Bounded: a cause chain is short, and an accidental cycle must not hang the
  // caller that is already handling a failure.
  for (let i = 0; i < 10 && cursor instanceof Error; i += 1) {
    if (cursor instanceof NestingTooDeepError) return true;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}

/** Throw if `markdown` nests deeper than the parser can survive. */
export function checkNestingDepth(markdown: string): void {
  const depth = maxContainerDepth(markdown);
  if (depth > MAX_NESTING_DEPTH) {
    throw new NestingTooDeepError(
      depth,
      MAX_NESTING_DEPTH,
      `Nesting is ${depth} levels deep; this document cannot be parsed above ` +
        `${MAX_NESTING_DEPTH}. Deeply nested blockquotes or lists overflow the ` +
        `markdown parser's stack, so it is refused here rather than crashing ` +
        `part-way through.`,
    );
  }
}
