/**
 * The reference-link vocabulary E01 (`noUndefinedRefs`) and W03
 * (`noUnusedDefs`) share.
 *
 * Purpose: both rules scan SOURCE text rather than the tree, because remark
 * resolves a reference with a definition into a plain link and drops one
 * without a definition to literal text — so neither shape survives as a node.
 * Each rule used to carry its own copy of the regex, its own escape rule and
 * its own idea of what an inline link is, and the two then disagreed about one
 * document: whichever copy was fixed, the other kept the defect.
 *
 * The classification lives here; the POLICY stays with each rule. E01 reports a
 * full or collapsed reference with no definition and ignores shortcuts (a
 * shortcut with no definition is not a reference at all). W03 counts every form
 * as a USE, except an inline link.
 *
 * @coordinates-with src/lib/lintEngine/rules/labelUtils.ts — normalization and escape parity
 * @coordinates-with src/lib/lintEngine/rules/sourceMask.ts — what is prose in the first place
 * @module lib/lintEngine/rules/referenceScanner
 */

import { isEscapedAt, normalizeLabel } from "./labelUtils";

/**
 * All reference forms, in one pattern:
 *   Full:      `[text][label]`  — g1 = "[text]", g3 = "[label]", g4 = "label"
 *   Collapsed: `[text][]`       — g1 = "[text]", g3 = "[]",      g4 = ""
 *   Shortcut:  `[text]`         — g1 = "[text]", g3 = undefined
 * plus the image spellings (`![alt][label]`, …).
 *
 * Module scope so it is compiled once rather than per line; `lastIndex` is
 * reset by the generator below, which is the price of that.
 */
const REF_PATTERN = /(!?\[([^\]\\]|\\.)*?\])(\[([^\]]*?)\])?/g;

/** Not exported: it is `ReferenceToken.kind`, and no caller names it separately. */
type ReferenceKind = "full" | "collapsed" | "shortcut";

export interface ReferenceToken {
  kind: ReferenceKind;
  /** CommonMark-normalized label: lowercase, whitespace collapsed, trimmed. */
  label: string;
  /** The label exactly as written — what a diagnostic message should quote. */
  raw: string;
  /** 0-based index of the whole reference within the line. */
  index: number;
  /** The matched text, `[a][b]` and all. */
  text: string;
  /**
   * The bracket is immediately followed by `(` — `[a](url)` is an INLINE link,
   * not a shortcut reference. Counting one as a use marked an unrelated
   * definition used and silenced W03.
   */
  inlineLink: boolean;
}

/** Every reference-shaped token on `line`, already classified and normalized. */
export function* referenceTokens(line: string): Generator<ReferenceToken> {
  REF_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REF_PATTERN.exec(line)) !== null) {
    const bracket = match[1];
    const hasSecond = match[3] !== undefined;
    const second = match[4];

    // An ESCAPED opening bracket is a literal one: `\[text][label]` renders as
    // the text `[text]` followed by a shortcut that resolves to nothing. The
    // `!` of an image is stepped past — escaping it leaves the bracket real.
    if (isEscapedAt(line, match.index + (bracket.startsWith("!") ? 1 : 0))) continue;

    const inner = bracket.replace(/^!?\[/, "").replace(/\]$/, "");
    const kind: ReferenceKind = !hasSecond ? "shortcut" : second === "" ? "collapsed" : "full";
    const raw = kind === "full" ? (second as string) : inner;

    yield {
      kind,
      label: normalizeLabel(raw),
      raw,
      index: match.index,
      text: match[0],
      inlineLink: line.charAt(match.index + match[0].length) === "(",
    };
  }
}
