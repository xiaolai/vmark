// @vitest-environment node
/**
 * Quote and slash spacing — the two rules a run of formatter work redefined.
 *
 * Quote spacing honours the settings (`quoteSpacing`, `singleQuoteSpacing`)
 * beside CJK text as well as Latin text. The glyph-only argument — `“ ”` are
 * fullwidth in CJK context, and GB/T 15834, JLREQ and the W3C's *Spacing
 * between scripts inline* treat the gap as part of the glyph — is why the
 * switches exist: turning them off restores that typography. A switch that
 * left CJK text untouched was the reported bug; users read "Spacing around “”"
 * and got nothing.
 *
 * The slash rule is still WI-CJKF3.4: `fixSlashSpacing` removed horizontal
 * whitespace on BOTH sides of every slash, so a path lost the space in front
 * of it:
 *
 *     路径 /usr/local/bin 目录  ->  路径/usr/local/bin 目录
 *
 * Whitespace on the left only is the shape of a path or a root-anchored token,
 * never of a spaced separator.
 *
 * @coordinates-with ../rules/dashesQuotes.ts — fixQuoteSpacing
 * @coordinates-with ../rules/spacing.ts — fixSlashSpacing
 * @module lib/cjkFormatter/__tests__/quoteAndSlashSpacing.test
 */
import { describe, it, expect } from "vitest";
import { fixDoubleQuoteSpacing, fixSingleQuoteSpacing } from "../rules";
import { fixSlashSpacing } from "../rules/spacing";
import { formatMarkdown } from "../formatter";
import { DEFAULT_CJK_FORMATTING } from "../types";

const C = DEFAULT_CJK_FORMATTING;
const fmt = (s: string, config = C) => formatMarkdown(s, config, { preserveTwoSpaceHardBreaks: true });
const OQ = "“";
const CQ = "”";
const OS = "‘";
const CS = "’";

describe("quote spacing beside CJK follows the setting", () => {
  it("spaces an opening quote after CJK", () => {
    expect(fixDoubleQuoteSpacing(`中文${OQ}text${CQ}`)).toBe(`中文 ${OQ}text${CQ}`);
  });

  it("spaces a closing quote before CJK", () => {
    expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}中文`)).toBe(`${OQ}text${CQ} 中文`);
  });

  it("spaces Japanese too", () => {
    expect(fixDoubleQuoteSpacing(`日本語${OQ}text${CQ}`)).toBe(`日本語 ${OQ}text${CQ}`);
  });

  it("applies to single quotes", () => {
    expect(fixSingleQuoteSpacing(`中文${OS}text${CS}`)).toBe(`中文 ${OS}text${CS}`);
    expect(fixSingleQuoteSpacing(`${OS}text${CS}中文`)).toBe(`${OS}text${CS} 中文`);
  });

  it("still spaces a Latin word from a quote", () => {
    expect(fixDoubleQuoteSpacing(`word${OQ}text${CQ}`)).toBe(`word ${OQ}text${CQ}`);
    expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}word`)).toBe(`${OQ}text${CQ} word`);
  });

  it("still spaces a digit from a quote", () => {
    expect(fixDoubleQuoteSpacing(`9${OQ}text${CQ}`)).toBe(`9 ${OQ}text${CQ}`);
  });

  it("still spaces an em dash from a quote", () => {
    expect(fixDoubleQuoteSpacing(`——${OQ}text${CQ}`)).toBe(`—— ${OQ}text${CQ}`);
  });

  it("keeps the no-space rules for brackets and terminal punctuation", () => {
    expect(fixDoubleQuoteSpacing(`」${OQ}text${CQ}`)).toBe(`」${OQ}text${CQ}`);
    expect(fixDoubleQuoteSpacing(`，${OQ}text${CQ}`)).toBe(`，${OQ}text${CQ}`);
  });

  it("leaves Korean alone, as it always did", () => {
    expect(fixDoubleQuoteSpacing(`한글${OQ}text${CQ}`)).toBe(`한글${OQ}text${CQ}`);
  });

  it("end to end: a quoted Chinese phrase gains spaces", () => {
    expect(fmt('他说"你好"然后走了')).toBe(`他说 ${OQ}你好${CQ} 然后走了`);
  });

  it("off: the setting keeps a quoted phrase tight", () => {
    expect(fmt('他说"你好"然后走了', { ...C, quoteSpacing: false })).toBe(
      `他说${OQ}你好${CQ}然后走了`
    );
  });

  it("does NOT remove a space the author typed", () => {
    expect(fmt(`中文 ${OQ}你好${CQ} 结束`)).toBe(`中文 ${OQ}你好${CQ} 结束`);
  });

  it("is idempotent", () => {
    const once = fmt('他说"你好"然后走了');
    expect(fmt(once)).toBe(once);
  });
});

describe("WI-CJKF3.4 — slash spacing keeps the space before a path", () => {
  it.each([
    ["path after a CJK word", "路径 /usr/local/bin 目录", "路径 /usr/local/bin 目录"],
    ["path after a Latin word", "see /etc/hosts now", "see /etc/hosts now"],
    ["spaced separator", "读 / 写", "读/写"],
    ["space on the right only", "读/ 写", "读/写"],
    ["already tight", "and/or", "and/or"],
    ["a spaced date", "2026 / 08 / 21", "2026/08/21"],
    ["protocol slashes", "https://a.com/x", "https://a.com/x"],
    ["a comment marker", "// comment", "// comment"],
    ["a tab separator", "读\t/\t写", "读/写"],
    ["slash at end of line", "读 /", "读 /"],
  ])("%s", (_label, input, expected) => {
    expect(fixSlashSpacing(input)).toBe(expected);
  });

  it("does not join two lines", () => {
    expect(fixSlashSpacing("标题\n/usr/bin")).toBe("标题\n/usr/bin");
  });

  it("end to end", () => {
    expect(fmt("路径 /usr/local/bin 目录")).toBe("路径 /usr/local/bin 目录");
    expect(fmt("读 / 写 操作")).toBe("读/写 操作");
  });

  it("is idempotent", () => {
    for (const input of ["路径 /usr/local/bin 目录", "读 / 写", "读/ 写"]) {
      const once = fixSlashSpacing(input);
      expect(fixSlashSpacing(once)).toBe(once);
    }
  });
});
