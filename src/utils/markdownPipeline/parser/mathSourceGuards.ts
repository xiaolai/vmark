/**
 * Purpose: Pre-parse guard for unclosed `$$` math fences (issue
 * #1181). micromark's math flow is fence-like — an unclosed opener
 * legally swallows everything to the next closing fence line, the end
 * of its container, or EOF, so by the time mdast exists the damage is
 * one giant math node. The guard applies pandoc's display-math rule:
 * a fence must close before a blank line; an opener that doesn't gets
 * its first `$` escaped so it parses as literal text and the content
 * behind it survives as normal blocks.
 *
 * How: parse-heal-reparse. A probe parse (mathProbe.ts) tells us —
 * with micromark's own container, code, and HTML grammar, not a
 * re-implementation — exactly which math flow nodes exist and where.
 * Offending nodes get their opener escaped, and the text is re-probed:
 * escaping an opener legitimately re-interprets everything after it
 * (an old closer becomes a new opener), and only the parser can say
 * what that means. Rounds are capped; a document that exhausts the
 * budget falls through to the fail-closed sweep (see
 * sweepRemainingOpeners), which escapes every remaining potential
 * opener outside opaque regions — a violating node never survives, and
 * work is never unbounded.
 *
 * A math node offends when:
 *   - its value contains a blank line followed by more content
 *     (a blank-only TAIL is tolerated — the app's own source-mode
 *     insertMath emits `$$` / blank caret line / `$$`, and a blank
 *     tail swallows nothing), or
 *   - it never closes (the node's last line is not a `$`-run at least
 *     as long as the opener, alone on its line).
 *
 * Serializing an affected document writes `\$\$` — the same
 * escape-normalization class the pipeline already applies to literal
 * `$` (see the currency-pattern tests). Runs ONLY in the document
 * parse; the source-position dialect maps offsets of the text as
 * written and must never see rewritten input.
 *
 * @coordinates-with ../parser.ts — sole caller (parseMarkdownToMdast)
 * @coordinates-with ./mathProbe.ts — micromark-authoritative extents
 * @coordinates-with ./mathDelimiterSpans.ts — the #1180 half, re-exported here
 * @module utils/markdownPipeline/parser/mathSourceGuards
 */

import {
  buildProbeOpaqueMask,
  collectMathFlowExtents,
  probeParse,
  probeParseWithoutMath,
  type MathFlowExtent,
} from "./mathProbe";

export { normalizeMathDelimiters } from "./mathDelimiterSpans";

/** Cap on parse-heal rounds. Real documents converge in one or two; a
 *  crafted flood falls through to the fail-closed sweep below rather
 *  than doing unbounded reparses. */
const MAX_HEAL_ROUNDS = 10;

/** Any CommonMark line ending — LF, CRLF, or lone CR (classic Mac). */
const LINE_ENDING = /\r\n|\r|\n/;
/** Blank line followed by more content, after tolerated trailing blanks. */
const INTERNAL_BLANK = /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/;

/**
 * Closure comes from micromark itself, not from fence grammar we would
 * only approximate: a CLOSED node's source is opener line + value
 * lines + closer line; an UNCLOSED node's source is opener line +
 * value lines. Comparing LINE COUNTS is collision-free — a suffix
 * check was not (`"$$$".endsWith("$$")` misread a valid `$$$` block
 * whose content held a shorter dollar line as unclosed). Over-indented
 * `    $$`, tab-indented, and deeper-quoted pseudo-closers all sit
 * inside `value`, so they add to the value's line count and the node
 * still counts as unclosed. Any OTHER count relationship (unexpected
 * node shape) is treated as closed — the fail-safe direction is "no
 * rewrite".
 *
 * An empty-value node (a bare dangling `$$`, or the app's empty-math
 * template) swallows nothing and is left as typed — escaping while the
 * user is mid-typing a block would be hostile.
 */
function violates(text: string, extent: MathFlowExtent): boolean {
  if (INTERNAL_BLANK.test(extent.value.trimEnd())) return true;
  if (extent.value === "") return false;
  const sliceLines = text
    .slice(extent.start, extent.end)
    .replace(/(?:\r\n|\r|\n)$/, "")
    .split(LINE_ENDING).length;
  const valueLines = extent.value.split(LINE_ENDING).length;
  return sliceLines === valueLines + 1; // opener line only — no closer
}

/**
 * Escape `$$` fence openers that never close before a blank line, the
 * end of their container, or EOF. See module header.
 */
export function escapeUnclosedMathFences(markdown: string): string {
  if (!markdown.includes("$$")) return markdown;

  let text = markdown;
  for (let round = 0; round < MAX_HEAL_ROUNDS; round++) {
    const offender = collectMathFlowExtents(probeParse(text)).find((extent) =>
      violates(text, extent),
    );
    if (!offender) return text;

    // ONE escape per round: escaping an opener re-interprets everything
    // after it (a freed closer becomes the next block's opener), so any
    // later "offender" seen in this round's parse is a phantom of the
    // pre-heal reading. The reparse decides what actually follows.
    const dollar = text.indexOf("$", offender.start);
    /* v8 ignore next -- @preserve defensive: a math node always contains its fence */
    if (dollar === -1 || dollar >= offender.end) return text;
    text = `${text.slice(0, dollar)}\\${text.slice(dollar)}`;
  }
  return sweepRemainingOpeners(text);
}

/** Opener-shaped line: any run of blockquote markers, list markers, and
 *  indentation, then a `$$` run. Deliberately broad — the sweep must
 *  not miss a container form the parser would accept. */
const SWEEP_OPENER =
  /^((?:[>\t ]|(?:[-*+]|\d{1,9}[.)])[ \t])*)(\$\$+)/;

/**
 * Fail-closed fallback for documents that exhaust the healing budget:
 * a violating node must NOT survive (it would still swallow content),
 * so every remaining potential opener line outside opaque regions is
 * escaped in one pass. Opacity comes from a MATH-DISABLED probe — the
 * damaged tree hides code/HTML blocks inside the violating math node,
 * so the normal probe cannot be trusted here. Legitimate later math in
 * such a document degrades to literal text — only crafted opener
 * floods get here, and over-escaping is the same normalization class
 * as healing itself.
 */
function sweepRemainingOpeners(text: string): string {
  const stillViolating = collectMathFlowExtents(probeParse(text)).some(
    (extent) => violates(text, extent),
  );
  /* v8 ignore next -- @preserve reachable only via crafted >10-offender floods */
  if (!stillViolating) return text;

  const mask = buildProbeOpaqueMask(text, probeParseWithoutMath(text));
  // Separator-preserving split so LF, CRLF, and lone-CR documents all
  // reassemble byte-identically.
  const parts = text.split(/(\r\n|\r|\n)/);
  let offset = 0;
  const out = parts.map((part, idx) => {
    const partOffset = offset;
    offset += part.length;
    if (idx % 2 === 1) return part; // line separator
    const m = SWEEP_OPENER.exec(part);
    if (!m || /\$\$/.test(part.slice(m[0].length))) return part;
    if (mask[partOffset + m[1].length] === 1) return part;
    return `${m[1]}\\${part.slice(m[1].length)}`;
  });
  return out.join("");
}
