// @vitest-environment node
/**
 * WI-CJKF3.2 — `preserveTwoSpaceHardBreaks` was inert under default settings.
 *
 * Mechanism, isolated: `collapseSpaces` rewrote `English  ` to `English `
 * FIRST, so `removeTrailingSpaces` — which would have preserved a two-space
 * run — saw a single space and deleted it. Both rules are on by default, so
 * every hard line break in a CJK document was silently dropped and the
 * rendered output changed:
 *
 *     "第一行English  \n第二行"  ->  "第一行 English\n第二行"
 *
 * The option was passed correctly all the way down; the rule ORDER defeated it.
 * That is why the assertions below run through `formatMarkdown` and not just
 * through `removeTrailingSpaces`: the unit was already right.
 *
 * @coordinates-with ../rules/spacing.ts — collapseSpaces
 * @coordinates-with ../rules/cleanup.ts — removeTrailingSpaces
 * @module lib/cjkFormatter/__tests__/hardBreaks.test
 */
import { describe, it, expect } from "vitest";
import { formatMarkdown } from "../formatter";
import { collapseSpaces } from "../rules/spacing";
import { DEFAULT_CJK_FORMATTING } from "../types";

const C = DEFAULT_CJK_FORMATTING;
const keep = { preserveTwoSpaceHardBreaks: true };
const drop = { preserveTwoSpaceHardBreaks: false };

describe("formatMarkdown honours preserveTwoSpaceHardBreaks", () => {
  it("keeps a two-space hard break while still formatting the line", () => {
    expect(formatMarkdown("第一行English  \n第二行", C, keep)).toBe("第一行 English  \n第二行");
  });

  it("keeps a longer trailing run — 2+ is a break, and the run is syntax", () => {
    expect(formatMarkdown("第一行English    \n第二行", C, keep)).toBe("第一行 English    \n第二行");
  });

  it("drops the break when the document's convention is backslash", () => {
    expect(formatMarkdown("第一行English  \n第二行", C, drop)).toBe("第一行 English\n第二行");
  });

  it("still collapses an interior double space in both modes", () => {
    expect(formatMarkdown("中文  English  中文", C, keep)).toBe("中文 English 中文");
    expect(formatMarkdown("中文  English  中文", C, drop)).toBe("中文 English 中文");
  });

  it("does not treat a whitespace-only line as a hard break", () => {
    expect(formatMarkdown("中文English\n   \n第三行", C, keep)).toBe("中文 English\n\n第三行");
  });

  it("removes a single trailing space, which is never a break", () => {
    expect(formatMarkdown("中文English \n第二行", C, keep)).toBe("中文 English\n第二行");
  });

  it("preserves a break in a CRLF document", () => {
    expect(formatMarkdown("第一行English  \r\n第二行", C, keep)).toBe("第一行 English  \r\n第二行");
  });

  it("still trims a break at end of document — it has nothing to break", () => {
    expect(formatMarkdown("第一行English  ", C, keep)).toBe("第一行 English");
  });

  it("preserves a break on a line that also ends a protected region's line", () => {
    expect(formatMarkdown("中文 `code`  \n下一行", C, keep)).toBe("中文 `code`  \n下一行");
  });

  it("is idempotent in both modes", () => {
    for (const opts of [keep, drop]) {
      for (const input of ["第一行English  \n第二行", "中文  English  中文", "中文 `code`  \n下一行"]) {
        const once = formatMarkdown(input, C, opts);
        expect(formatMarkdown(once, C, opts)).toBe(once);
      }
    }
  });
});

describe("collapseSpaces, in isolation", () => {
  it("leaves an end-of-line run alone when preserving breaks", () => {
    expect(collapseSpaces("abc  \ndef", keep)).toBe("abc  \ndef");
  });

  it("collapses an end-of-line run when not preserving breaks", () => {
    expect(collapseSpaces("abc  \ndef", drop)).toBe("abc \ndef");
  });

  it("collapses interior runs either way", () => {
    expect(collapseSpaces("a  b", keep)).toBe("a b");
    expect(collapseSpaces("a  b", drop)).toBe("a b");
  });

  it("backtracks correctly on a longer run before a newline", () => {
    // `{2,}` is greedy; without `[ ]*` in the lookahead the engine backtracks
    // to two spaces and then matches, collapsing the run after all.
    expect(collapseSpaces("abc    \ndef", keep)).toBe("abc    \ndef");
  });

  it("leaves a run at end of string alone when preserving", () => {
    expect(collapseSpaces("abc  ", keep)).toBe("abc  ");
  });

  it("preserves leading indentation by default", () => {
    expect(collapseSpaces("    indented", drop)).toBe("    indented");
  });

  it("collapses a leading run when the segment does not start a line", () => {
    expect(collapseSpaces("    trailing-of-a-mid-line-segment", { startsAtLineStart: false })).toBe(
      " trailing-of-a-mid-line-segment"
    );
  });
});
