// @vitest-environment node
/**
 * WI-CJKF4.1 / WI-CJKF4.2 — the formatter's inline-math detection must agree
 * with the parser VMark actually renders with.
 *
 * `findProtectedRegions` used `/(?<!\$)\$(?!\$)([^$\n]+)\$(?!\$)/`, which is
 * strictly more permissive than remark-math. Measured against `parseMarkdown`:
 *
 *     价格是 $100 和 $200 元   formatter: math   parser: NOT math
 *     cost $5, tax $1          formatter: math   parser: NOT math
 *     $a $                     formatter: math   parser: NOT math
 *     $ a $                    formatter: math   parser: math
 *
 * A false positive is not harmless: the span is "protected", so the CJK rules
 * skip it AND the space in front of it is eaten as a segment edge.
 *
 * The parser's rule is micromark's math-text padding rule — content may be
 * padded with one space on BOTH sides (which is then stripped) but not on one
 * side only. WI-CJKF4.2 is the durable half: a corpus checked against the real
 * parser, so the regex cannot drift away from it again.
 *
 * @coordinates-with ../markdownParser.ts — the math_inline detector
 * @module lib/cjkFormatter/__tests__/mathRegionParity.test
 */
import { describe, it, expect } from "vitest";
import { findProtectedRegions } from "../markdownParser";
import { formatMarkdown } from "../formatter";
import { DEFAULT_CJK_FORMATTING } from "../types";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { testSchema } from "@/utils/markdownPipeline/testSchema";

const C = DEFAULT_CJK_FORMATTING;
const fmt = (s: string) => formatMarkdown(s, C, { preserveTwoSpaceHardBreaks: true });

const formatterSaysMath = (text: string): boolean =>
  findProtectedRegions(text).some((r) => r.type === "math_inline");

const parserSaysMath = (text: string): boolean => {
  let found = false;
  parseMarkdown(testSchema, text).descendants((node) => {
    if (node.type.name === "math_inline") found = true;
    return true;
  });
  return found;
};

/**
 * Single-line, single-`$`-run inputs only.
 *
 * `$$…$$` display math and multi-line math are separate detectors on both
 * sides, and mixing them in would compare two different questions.
 */
const CORPUS = [
  // --- real inline math ---
  "$a+b$",
  "$100$",
  "1$a$",
  "$a$1",
  "$a$2 b",
  "x$a$y",
  "中文$x$中文",
  "$-1$",
  "$a$-",
  "$ a $",
  "公式 $E = mc^2$ 结束",
  // --- NOT math: the currency shapes that motivated this ---
  "价格是 $100 和 $200 元",
  "cost $5, tax $1",
  "a $1 and $2 b",
  "花了 $5 和 $10 元",
  "价格 $99.99 和 $88.88 结束",
  // --- NOT math: one-sided padding ---
  "$a $",
  "$ a$",
  // --- NOT math: too few delimiters ---
  "花了 $5 元",
  "只有一个 $ 符号",
  "",
  "中文没有美元符号",
] as const;

describe("WI-CJKF4.2 — formatter and parser agree on every corpus entry", () => {
  it.each(CORPUS.map((t) => [JSON.stringify(t), t] as const))(
    "%s",
    (_label, text) => {
      expect(formatterSaysMath(text)).toBe(parserSaysMath(text));
    }
  );
});

describe("WI-CJKF4.1 — the consequences of the false positives", () => {
  it("no longer protects a currency pair, so the CJK rules reach it", () => {
    expect(formatterSaysMath("价格是 $100 和 $200 元")).toBe(false);
    expect(fmt("价格是 $100 和 $200 元")).toBe("价格是 $100 和 $200 元");
  });

  it("no longer eats the space before a currency amount", () => {
    // The old detector protected `$100 和 $`, which made the space in front of
    // it a segment edge and therefore trailing whitespace.
    expect(fmt("花了 $5 和 $10 元")).toBe("花了 $5 和 $10 元");
  });

  it("still protects real inline math and the space before it", () => {
    expect(fmt("公式 $a+b$ 结束English")).toBe("公式 $a+b$ 结束 English");
  });

  it("still protects symmetrically padded math", () => {
    expect(formatterSaysMath("$ a $")).toBe(true);
  });

  it("does not treat backslash-escaped dollars as delimiters", () => {
    expect(formatterSaysMath("\\$a\\$")).toBe(false);
  });

  it("leaves display math to its own detector", () => {
    const types = findProtectedRegions("$$\n中文English = 1\n$$").map((r) => r.type);
    expect(types).toContain("math_block");
  });

  it("is idempotent for every corpus entry", () => {
    for (const text of CORPUS) {
      const once = fmt(text);
      expect(fmt(once)).toBe(once);
    }
  });
});
