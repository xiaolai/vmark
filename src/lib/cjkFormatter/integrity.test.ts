// @vitest-environment node
/**
 * WI-CJKF6.1 — the integrity check has to check CONTENT, not seven substrings.
 *
 * It counted occurrences of `[^`, `<!--`, ```` ``` ````, `~~~`, `$$`, `[[` and
 * `` ` ``. It would not have caught a single defect in this plan's ten
 * reproductions, and the published guide claimed it "compares the visible text
 * content … guarantees that CJK formatting never silently loses content".
 *
 * The invariant that IS available: every legitimate rule in this formatter
 * changes only whitespace, punctuation, or the width of an alphanumeric. So
 * the content SKELETON — NFKC-folded, with whitespace and punctuation removed
 * — must be identical before and after. Letters, digits, ideographs, kana,
 * hangul and emoji all survive into it.
 *
 * @coordinates-with ./integrity.ts
 * @module lib/cjkFormatter/integrity.test
 */
import { describe, it, expect } from "vitest";
import { verifyIntegrity, contentSkeleton } from "./integrity";
import { formatMarkdown } from "./formatter";
import { DEFAULT_CJK_FORMATTING } from "./types";

const C = DEFAULT_CJK_FORMATTING;

describe("every legitimate transformation preserves the skeleton", () => {
  it.each([
    ["fullwidth alnum to halfwidth", "共１２３个", "共 123 个"],
    ["punctuation width", "你好,世界", "你好，世界"],
    ["double hyphen to em dash", "原因--结果", "原因 —— 结果"],
    ["ellipsis", "然后...继续", "然后……继续"],
    ["smart quotes", '他说"你好"', "他说“你好”"],
    ["fullwidth parentheses", "中文(注)", "中文（注）"],
    ["CJK/Latin spacing", "学习Python", "学习 Python"],
    ["repeated punctuation limit", "太棒了！！！", "太棒了！"],
    ["collapsed newlines", "中文\n\n\n结束", "中文\n\n结束"],
    ["collapsed spaces", "中文  结束", "中文 结束"],
    ["a stripped <br />", "中文\n\n<br />\n\n结束", "中文\n\n结束"],
  ])("%s", (_label, before, after) => {
    expect(verifyIntegrity(before, after).ok).toBe(true);
  });
});

describe("content loss is caught", () => {
  it("catches a dropped Han character", () => {
    expect(verifyIntegrity("中文内容", "中文容").ok).toBe(false);
  });

  it("catches a dropped Latin word", () => {
    expect(verifyIntegrity("中文 English 内容", "中文 内容").ok).toBe(false);
  });

  it("catches a dropped digit", () => {
    expect(verifyIntegrity("共 123 个", "共 12 个").ok).toBe(false);
  });

  it("catches a dropped emoji", () => {
    expect(verifyIntegrity("中文😀结束", "中文结束").ok).toBe(false);
  });

  it("catches a dropped kana", () => {
    expect(verifyIntegrity("日本語です", "日本語で").ok).toBe(false);
  });

  it("catches a dropped hangul", () => {
    expect(verifyIntegrity("한국어입니다", "한국어입니").ok).toBe(false);
  });

  it("catches REORDERED content, not just missing content", () => {
    expect(verifyIntegrity("中文English", "English中文").ok).toBe(false);
  });

  it("names the skeleton in the failure details", () => {
    const result = verifyIntegrity("中文内容", "中文容");
    expect(result.ok).toBe(false);
    expect(Object.keys(result.details)).toContain("content");
  });
});

describe("the structural counts are kept as a second signal", () => {
  it("catches a lost fence marker even when the skeleton matches", () => {
    // Same letters, one fewer fence.
    expect(verifyIntegrity("```\nabc\n```", "```\nabc\n").ok).toBe(false);
  });

  it("catches a lost inline-code backtick", () => {
    expect(verifyIntegrity("a `b` c", "a `b c").ok).toBe(false);
  });
});

describe("contentSkeleton", () => {
  it("drops whitespace and punctuation, keeps letters and digits", () => {
    expect(contentSkeleton("中文, English 123!")).toBe("中文English123");
  });

  it("folds fullwidth alphanumerics", () => {
    expect(contentSkeleton("ＡＢＣ１２３")).toBe("ABC123");
  });

  it("keeps emoji", () => {
    expect(contentSkeleton("中文 😀 结束")).toBe("中文😀结束");
  });

  it("is empty for punctuation-only input", () => {
    expect(contentSkeleton("……——，。！？")).toBe("");
  });

  it("handles empty input", () => {
    expect(contentSkeleton("")).toBe("");
  });
});

describe("the real formatter passes its own check", () => {
  it.each([
    "最近我在学习TypeScript和React,感觉收获很大.",
    "价格是 $100 和 $200 元",
    "| 列一English | 列二 |\n| --- | --- |\n| 值English | x |",
    "---\ntitle: 中文English\n---\n\n正文English\n",
    "```python\ns = {'中文key': 1}\n```\n\n结束English\n",
    "他说“你好”然后走了",
    "そして...続く",
    "VMark에는 좋은 editor입니다",
  ])("%s", (input) => {
    // If a real format run tripped the check, formatMarkdown would silently
    // return the input unchanged — which is the failure mode this guards.
    const out = formatMarkdown(input, C, { preserveTwoSpaceHardBreaks: true });
    expect(verifyIntegrity(input, out).ok).toBe(true);
  });
});
