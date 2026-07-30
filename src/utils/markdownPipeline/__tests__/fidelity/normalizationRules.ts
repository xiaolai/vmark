/**
 * Named classifiers for round-trip source deviations.
 *
 * Purpose: the fidelity gate asks, of every difference between what an author
 * wrote and what the pipeline gave back, "which named, reviewed transformation
 * explains this?". A rule is that name made executable. A deviation no rule
 * explains fails the gate.
 *
 * Adding a rule is a claim that the transformation is intended — not that it is
 * convenient. Two disciplines keep the claims honest:
 *   - Rules must be CONSERVATIVE and DIRECTIONAL. A rule that over-matches
 *     silently absorbs real defects, which is the failure this gate exists to
 *     prevent. `redundantEscapeDropped` originally matched escapes being ADDED
 *     as well as removed, and swallowed the `17-escaped-markers` case whole;
 *     it is now removal-only, with `markerReEscaped` naming the other direction.
 *   - A rule only says the SPELLING changed. Whether MEANING survived is
 *     decided separately and mechanically by `docFingerprint`, so a mis-named
 *     or over-broad rule here cannot approve corruption.
 *
 * @coordinates-with fidelityLedger.ts — declares which rules apply per document
 * @coordinates-with roundtripFidelity.test.ts — the gate
 * @coordinates-with docFingerprint.ts — the independent semantic check
 * @module utils/markdownPipeline/__tests__/fidelity/normalizationRules
 */
import type { Hunk } from "./hunkDiff";

/** Every deviation class the corpus has been reviewed against. */
export type RuleName =
  | "blankLineCollapse"
  | "tableFormatting"
  | "alertQuoteContinuation"
  | "providerEmbedRewrite"
  | "referenceLinkInlined"
  | "redundantEscapeDropped"
  | "markerReEscaped"
  | "codeSpanPaddingNormalized"
  | "orderedListRenumbered"
  | "setextNormalisedToAtx";

const isBlank = (l: string): boolean => l.trim() === "";
const isTableRow = (l: string): boolean => /^\s*\|/.test(l);
const stripBackslashes = (l: string): string => l.replace(/\\/g, "");
const countBackslashes = (ls: readonly string[]): number =>
  ls.reduce((n, l) => n + (l.match(/\\/g)?.length ?? 0), 0);

/** Collapse a table row to its cell texts, discarding padding and rule width. */
const tableShape = (l: string): string =>
  l
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => {
      const cell = c.trim();
      // A delimiter cell keeps only its alignment colons, not its dash count.
      const align = /^(:?)-+(:?)$/.exec(cell);
      return align ? `${align[1]}-${align[2]}` : cell;
    })
    .join("|");

/** Drop the one padding space CommonMark strips from inside a code span. */
const codeSpanShape = (l: string): string => l.replace(/(`+) (.*?) (\1)/g, "$1$2$3");

/** Text of an ordered-list item, with its ordinal removed. */
const orderedItemText = (l: string): string | null => {
  const m = /^(\s*)\d+([.)])\s+(.*)$/.exec(l);
  return m ? `${m[1]}|${m[3]}` : null;
};

/**
 * Each rule answers: does this named transformation fully explain the hunk?
 * Every rule in this map must be declared by at least one corpus document —
 * the gate fails on a rule nothing uses, so dead classifiers cannot accumulate.
 */
export const RULES: Record<RuleName, (hunk: Hunk) => boolean> = {
  /** Blank-line preservation is opt-in; runs of blank lines collapse. */
  blankLineCollapse: (h) =>
    h.before.every(isBlank) && h.after.every(isBlank) && h.before.length !== h.after.length,

  /** Cell padding and delimiter-run width are re-laid-out; cell text is kept. */
  tableFormatting: (h) =>
    h.before.length === h.after.length &&
    h.before.length > 0 &&
    h.before.every(isTableRow) &&
    h.after.every(isTableRow) &&
    h.before.every((l, i) => tableShape(l) === tableShape(h.after[i])),

  /** Alerts gain `>` continuation lines between their parts. */
  alertQuoteContinuation: (h) =>
    h.before.length === 0 && h.after.length > 0 && h.after.every((l) => /^\s*>\s*$/.test(l)),

  /** Provider embeds gain the privacy host and default dimensions (deliberate). */
  providerEmbedRewrite: (h) =>
    h.before.length === h.after.length &&
    h.before.every((l) => /<iframe/.test(l)) &&
    h.after.every((l) => /<iframe/.test(l)) &&
    h.after.some((l) => /youtube-nocookie\.com|width=|height=/.test(l)),

  /** `[text][ref]` is re-emitted inline as `[text](url)`. */
  referenceLinkInlined: (h) =>
    h.before.length === h.after.length &&
    h.before.some((l) => /\[[^\]]*\]\[[^\]]*\]/.test(l)) &&
    h.after.some((l) => /\[[^\]]*\]\([^)]*\)/.test(l)),

  /** A backslash escape the output no longer needs is REMOVED. */
  redundantEscapeDropped: (h) =>
    h.before.length === h.after.length &&
    countBackslashes(h.after) < countBackslashes(h.before) &&
    h.before.every((l, i) => stripBackslashes(l) === stripBackslashes(h.after[i])),

  /** A marker is re-escaped to keep it unambiguous — an escape is ADDED. */
  markerReEscaped: (h) =>
    h.before.length === h.after.length &&
    countBackslashes(h.after) > countBackslashes(h.before) &&
    h.before.every((l, i) => stripBackslashes(l) === stripBackslashes(h.after[i])),

  /** ``` `` a ` b `` ``` → ``` ``a ` b`` ``` — CommonMark strips that padding anyway. */
  codeSpanPaddingNormalized: (h) =>
    h.before.length === h.after.length &&
    h.before.some((l) => l.includes("`")) &&
    h.before.every((l, i) => codeSpanShape(l) === codeSpanShape(h.after[i])),

  /**
   * Ordinals are re-emitted sequentially from the list's start.
   *
   * CommonMark takes the start number from the FIRST item and ignores every
   * later ordinal, and a blank line between items of one type makes a loose
   * list rather than a new list. So an authored `7.` following `1. 2. 3.` is
   * item four, and emitting `4.` is spec-correct rather than lossy — confirmed
   * by the fingerprint check, which sees no change.
   */
  orderedListRenumbered: (h) => {
    const b = h.before.filter((l) => !isBlank(l));
    const a = h.after.filter((l) => !isBlank(l));
    if (b.length === 0 || b.length !== a.length) return false;
    return b.every((l, i) => {
      const bt = orderedItemText(l);
      const at = orderedItemText(a[i]);
      return bt !== null && at !== null && bt === at;
    });
  },

  /**
   * A setext heading is READ as a heading and re-emitted as ATX.
   *
   * VMark serializes every heading as `#`, so `Title` over `=====` comes back
   * as `# Title`. That is a spelling change, not a loss — and it is the whole
   * point of the fix: setext used to be DESTROYED on read, becoming a paragraph
   * whose underline was escaped to `\=====`, or a paragraph plus a thematic
   * break, with `useTiptapFlush` writing the damage back on the next keystroke.
   */
  setextNormalisedToAtx: (h) => {
    const before = h.before.filter((l) => !isBlank(l));
    const after = h.after.filter((l) => !isBlank(l));
    if (before.length !== 2 || after.length !== 1) return false;
    const [title, underline] = before;
    if (!/^\s*(?:=+|-{2,})\s*$/.test(underline)) return false;
    const atx = /^(#{1,6})\s+(.*)$/.exec(after[0]);
    return atx !== null && atx[2].trim() === title.trim();
  },
};
