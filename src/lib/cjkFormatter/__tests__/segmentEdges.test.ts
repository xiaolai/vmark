// @vitest-environment node
/**
 * WI-CJKF2.1 — line-anchored rules must know where the real line edges are.
 *
 * `removeTrailingSpaces` (`/ +$/gm`) and `collapseSpaces` run per SEGMENT, and
 * a segment ends wherever a protected region begins. So the space before every
 * protected region looked like end-of-line trailing whitespace and was deleted:
 *
 *     使用 `printf` 函数   ->   使用`printf` 函数
 *
 * A CJK/Latin spacer that DELETES CJK/Latin spacing. It fired for every region
 * type — inline code, inline math, images, wiki links, footnote refs,
 * autolinks, and every HTML tag.
 *
 * The fix is not a document-level pass: that would strip trailing whitespace
 * INSIDE fenced code blocks, where it can be significant. Each segment instead
 * carries whether its start is a real line start and its end a real line end.
 *
 * @coordinates-with ../segments.ts — computes the edge flags
 * @coordinates-with ../rules/applyRules.ts — threads them to the two rules
 * @module lib/cjkFormatter/__tests__/segmentEdges.test
 */
import { describe, it, expect } from "vitest";
import { formatMarkdown } from "../formatter";
import { extractFormattableSegments } from "../segments";
import { findProtectedRegions } from "../markdownParser";
import { DEFAULT_CJK_FORMATTING } from "../types";

const C = DEFAULT_CJK_FORMATTING;
const OPT = { preserveTwoSpaceHardBreaks: true };
const fmt = (s: string) => formatMarkdown(s, C, OPT);

describe("the space before a protected region survives", () => {
  it.each([
    ["inline code", "使用 `printf` 函数", "使用 `printf` 函数"],
    ["inline math", "公式 $a+b$ 结束", "公式 $a+b$ 结束"],
    ["image", "看 ![图](a.png) 这里", "看 ![图](a.png) 这里"],
    ["wiki link", "见 [[页面]] 内容", "见 [[页面]] 内容"],
    ["footnote ref", "正文 [^1] 说明", "正文 [^1] 说明"],
    ["autolink", "见 <https://a.com> 这里", "见 <https://a.com> 这里"],
    ["html tag", "按 <kbd>Cmd</kbd> 键", "按 <kbd>Cmd</kbd> 键"],
    ["html span", "这是 <span>内容</span> 文本", "这是 <span>内容</span> 文本"],
  ])("%s", (_label, input, expected) => {
    expect(fmt(input)).toBe(expected);
  });

  it("survives across several regions on one line", () => {
    expect(fmt("中文 `a` 中文 `b` 中文")).toBe("中文 `a` 中文 `b` 中文");
  });

  it("still strips a single trailing space at a real end of line", () => {
    expect(fmt("中文 `c` \n下一行")).toBe("中文 `c`\n下一行");
  });

  it("keeps a 2+ run at end of line, because that is a hard break (WI-CJKF3.2)", () => {
    // Note this run sits at the START of the segment following the code span,
    // so nothing inside the segment proves content precedes it — the
    // `startsAtLineStart` flag is what carries that fact across the boundary.
    expect(fmt("中文 `c`   \n下一行")).toBe("中文 `c`   \n下一行");
  });

  it("strips the same run when the document's convention is backslash", () => {
    expect(formatMarkdown("中文 `c`   \n下一行", C, { preserveTwoSpaceHardBreaks: false })).toBe(
      "中文 `c`\n下一行"
    );
  });

  it("leaves a line that ends with a region and no trailing space alone", () => {
    expect(fmt("中文 `c`\n下一行")).toBe("中文 `c`\n下一行");
  });

  it("collapses a multi-space run that is NOT indentation after a region", () => {
    // The segment starts mid-line, so its leading run is not indentation.
    expect(fmt("`code`   中文")).toBe("`code` 中文");
  });

  it("preserves real indentation before a region at line start", () => {
    // A list continuation: four spaces would be indented code, so use two.
    expect(fmt("- 项目\n  `code` 中文")).toBe("- 项目\n  `code` 中文");
  });
});

describe("segment edge flags", () => {
  const segsOf = (text: string) =>
    extractFormattableSegments(text, findProtectedRegions(text));

  it("marks a segment ending at a protected region as NOT a line end", () => {
    const [first] = segsOf("中文 `a` 中文");
    expect(first.text).toBe("中文 ");
    expect(first.endsAtLineEnd).toBe(false);
    expect(first.startsAtLineStart).toBe(true);
  });

  it("marks a segment starting after a protected region as NOT a line start", () => {
    const segs = segsOf("中文 `a` 中文");
    const last = segs[segs.length - 1];
    expect(last.text).toBe(" 中文");
    expect(last.startsAtLineStart).toBe(false);
    expect(last.endsAtLineEnd).toBe(true);
  });

  it("treats a newline before the segment as a line start", () => {
    const segs = segsOf("`a`\n中文");
    const last = segs[segs.length - 1];
    expect(last.text).toBe("\n中文");
    // The segment begins at the newline itself, which is a line END, so the
    // flag describes the segment's first offset, not its first line.
    expect(last.startsAtLineStart).toBe(false);
  });

  it("treats end-of-document as a line end", () => {
    const [only] = segsOf("中文English");
    expect(only.endsAtLineEnd).toBe(true);
  });

  it("treats a segment starting at offset 0 as a line start", () => {
    const [only] = segsOf("中文English");
    expect(only.startsAtLineStart).toBe(true);
  });

  it("a segment that CONTAINS the line break ends mid-line, and says so", () => {
    // The flag describes the character AFTER the segment, not its last
    // character. Here the segment swallows the CRLF and stops at the fence, so
    // it does not end at a line end — and that is harmless, because the rule
    // consults the flag only for the segment's LAST line, which is empty.
    const segs = segsOf("中文 \r\n```js\nx\n```");
    expect(segs[0].text).toBe("中文 \r\n");
    expect(segs[0].endsAtLineEnd).toBe(false);
    expect(segs[0].text.endsWith("\r\n")).toBe(true);
  });

  it("keeps a CRLF document's fence intact end to end", () => {
    const crlf = "正文English\r\n\r\n```python\r\ns = {'中文key': 1}\r\n```\r\n\r\n结束English";
    expect(fmt(crlf)).toBe(
      "正文 English\r\n\r\n```python\r\ns = {'中文key': 1}\r\n```\r\n\r\n结束 English"
    );
  });

  it("emits no segment between two adjacent protected regions", () => {
    const segs = segsOf("`a``b`");
    expect(segs.every((s) => s.text.length > 0)).toBe(true);
  });

  it("emits no segments when the whole document is protected", () => {
    expect(segsOf("```js\nx\n```")).toEqual([]);
  });
});

describe("reconstruction is unchanged for the cases that already worked", () => {
  it("formats prose around a fence", () => {
    expect(fmt("正文English\n\n```js\nlet 中文English=1\n```\n\n结束English")).toBe(
      "正文 English\n\n```js\nlet 中文English=1\n```\n\n结束 English"
    );
  });

  it("formats table cells without disturbing padding", () => {
    expect(fmt("| 列一English | 列二 |\n| --- | --- |\n| 值English | x |")).toBe(
      "| 列一 English | 列二 |\n| --- | --- |\n| 值 English | x |"
    );
  });

  it("is idempotent for every case above", () => {
    for (const input of [
      "使用 `printf` 函数",
      "中文 `a` 中文 `b` 中文",
      "中文 `c`   \n下一行",
      "`code`   中文",
      "| 列一English | 列二 |\n| --- | --- |\n| 值English | x |",
    ]) {
      const once = fmt(input);
      expect(fmt(once)).toBe(once);
    }
  });
});
