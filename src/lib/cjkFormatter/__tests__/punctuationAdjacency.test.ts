// @vitest-environment node
/**
 * WI-CJKF3.1 — fullwidth punctuation conversion requires ADJACENCY.
 *
 * `getLeftNeighbor` / `getRightNeighbor` skipped over spaces and tabs, so a
 * mark separated from CJK by a space still converted. The output is never
 * right in any CJK orthography: fullwidth punctuation carries its own
 * sidebearing and is never preceded by a space.
 *
 *     中文 , English      ->  中文 ， English
 *     中文 :smile: English ->  中文 ：smile: English
 *     ## 1. 第一章         ->  ## 1。 第一章
 *     > 1. 中文            ->  > 1。 中文
 *     见第 1. 条           ->  见第 1。 条
 *     #1. 中文             ->  #1。 中文
 *
 * Requiring adjacency fixes all six at once — including the numbered-heading
 * and blockquote-list cases, which a special-cased `isOrderedListMarker` patch
 * would each have needed separately. It costs nothing, because every
 * conversion the guide documents (`你好,世界`, `什么?`, `注意:重要`) is already
 * adjacent.
 *
 * @coordinates-with ../rules/fullwidth.ts — normalizeFullwidthPunctuation
 * @coordinates-with ../rules/shared.ts — the neighbour helpers
 * @module lib/cjkFormatter/__tests__/punctuationAdjacency.test
 */
import { describe, it, expect } from "vitest";
import { normalizeFullwidthPunctuation } from "../rules";
import { formatMarkdown } from "../formatter";
import { DEFAULT_CJK_FORMATTING } from "../types";

const C = DEFAULT_CJK_FORMATTING;
const fmt = (s: string) => formatMarkdown(s, C, { preserveTwoSpaceHardBreaks: true });

describe("a mark separated from CJK by whitespace does not convert", () => {
  it.each([
    ["comma", "中文 , English"],
    ["period", "中文 . English"],
    ["colon", "中文 : English"],
    ["question mark", "中文 ? 对吗"],
    ["semicolon", "中文 ; 继续"],
    ["exclamation", "中文 ! 真的"],
    ["tab separator", "中文\t,English"],
    ["newline separator", "中文\n,English"],
  ])("%s", (_label, input) => {
    expect(normalizeFullwidthPunctuation(input)).toBe(input);
  });

  it("leaves an emoji shortcode alone", () => {
    expect(fmt("中文 :smile: English")).toBe("中文 :smile: English");
  });

  it("leaves a spaced ratio alone", () => {
    expect(fmt("中文 3 : 4 比例")).toBe("中文 3 : 4 比例");
  });
});

describe("numbered markers survive, wherever they appear", () => {
  it.each([
    ["h2 heading", "## 1. 第一章"],
    ["h6 heading", "###### 6. 第六章"],
    ["heading in a blockquote", "> ## 1. 中文"],
    ["ordered list in a blockquote", "> 1. 中文"],
    ["a hash-number token", "#1. 中文"],
    ["a mid-sentence ordinal", "见第 1. 条"],
    ["a top-level ordered list", "1. 中文"],
    ["an indented ordered list", "  10. 中文"],
  ])("%s", (_label, input) => {
    expect(normalizeFullwidthPunctuation(input)).toBe(input);
  });

  it("formats the prose of a numbered heading without touching the marker", () => {
    expect(fmt("## 1. 第一章English")).toBe("## 1. 第一章 English");
  });

  it("formats a blockquoted ordered list without touching the marker", () => {
    expect(fmt("> 1. 中文English")).toBe("> 1. 中文 English");
  });
});

describe("an enumerator period is spared even with no space after it", () => {
  // Adjacency alone cannot do this: `1.中文` has 中 immediately to the right.
  // The space-less form is common in Chinese text.
  it.each([
    ["top level", "1.中文"],
    ["indented", "  10.中文"],
    ["in a blockquote", "> 1.中文"],
    ["under a heading mark", "## 1.中文"],
    ["nested blockquote", ">> 3.中文"],
    ["after a CRLF line break", "上一行\r\n1.中文"],
  ])("%s", (_label, input) => {
    expect(normalizeFullwidthPunctuation(input)).toBe(input);
  });

  it("does NOT spare a mid-sentence period followed directly by CJK", () => {
    // Not at a line start, so it reads as a sentence period, and 文 is adjacent.
    expect(normalizeFullwidthPunctuation("见第 1.中文")).toBe("见第 1。中文");
  });
});

describe("the documented conversions still fire", () => {
  it.each([
    ["comma", "你好,世界", "你好，世界"],
    ["question", "什么?", "什么？"],
    ["colon", "注意:重要", "注意：重要"],
    ["period", "结束.", "结束。"],
    ["right-side adjacency alone", ",中文", "，中文"],
    ["after a fullwidth closing bracket", "（说明）,继续", "（说明），继续"],
  ])("%s", (_label, input, expected) => {
    expect(normalizeFullwidthPunctuation(input)).toBe(expected);
  });

  it("converts across a surrogate-pair Han neighbour", () => {
    expect(normalizeFullwidthPunctuation("𠮷,")).toBe("𠮷，");
  });

  it("cascades along an adjacent run", () => {
    expect(normalizeFullwidthPunctuation("中文,,,")).toBe("中文，，，");
  });

  it("stops the cascade at the first gap", () => {
    expect(normalizeFullwidthPunctuation("中文, , ,")).toBe("中文， , ,");
  });

  it("never converts backslash-escaped punctuation", () => {
    expect(normalizeFullwidthPunctuation("中文\\,内容")).toBe("中文\\,内容");
  });

  it("leaves technical subspans alone", () => {
    expect(fmt("时间 12:30 到达")).toBe("时间 12:30 到达");
    expect(fmt("共 1,000 个")).toBe("共 1,000 个");
    expect(fmt("版本 v1.2.3 发布")).toBe("版本 v1.2.3 发布");
  });

  it("is idempotent for every case in this file", () => {
    for (const input of [
      "中文 , English",
      "中文 :smile: English",
      "## 1. 第一章English",
      "> 1. 中文English",
      "你好,世界",
      "中文,,,",
      "见第 1. 条",
    ]) {
      const once = fmt(input);
      expect(fmt(once)).toBe(once);
    }
  });
});
