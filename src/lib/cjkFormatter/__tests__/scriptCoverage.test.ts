// @vitest-environment node
// WI-RA3.2 — one definition of "CJK letter" and one of "Latin letter", used by
// every rule; and a link's closing `)` is syntax, not a parenthesis.
/**
 * Three coverage gaps, each a rule that disagreed with another rule about
 * what a letter is:
 *
 *   - only ASCII counted as Latin, so `中文café中文` was spaced on the left
 *     (where the run starts with `c`) and not on the right (where it ends
 *     with `é`);
 *   - the spacing rules listed BMP ranges while the punctuation rule used
 *     Unicode script properties, so a supplementary-plane Han character got
 *     fullwidth punctuation but no spacing;
 *   - the `)` that closes `[text](url)` starts the segment after the protected
 *     URL, where the parenthesis rule read it as a closing parenthesis and
 *     spaced it from the CJK text that follows.
 */
import { describe, it, expect } from "vitest";
import { formatMarkdown } from "../formatter";
import { isCJKLetter } from "../latinSpanScanner";
import { isLatinLetter } from "../rules/shared";
import { DEFAULT_CJK_FORMATTING, type CJKFormattingSettings } from "../types";

const fmt = (text: string, config: CJKFormattingSettings = DEFAULT_CJK_FORMATTING) =>
  formatMarkdown(text, config);

const WITH_BRACKETS: CJKFormattingSettings = { ...DEFAULT_CJK_FORMATTING, fullwidthBrackets: true };
const KEEP_FULLWIDTH: CJKFormattingSettings = {
  ...DEFAULT_CJK_FORMATTING,
  fullwidthAlphanumeric: false,
};

describe("Latin letters beyond ASCII", () => {
  it.each([
    ["accented letter at the end of a word", "中文café中文", "中文 café 中文"],
    ["accented letter at the start of a word", "中文École中文", "中文 École 中文"],
    ["accented letter alone", "中文é中文", "中文 é 中文"],
    ["umlaut", "Zürich在瑞士", "Zürich 在瑞士"],
    ["Latin Extended-A", "中文Łódź中文", "中文 Łódź 中文"],
    ["Vietnamese (Latin Extended Additional)", "中文Việt中文", "中文 Việt 中文"],
    ["decomposed accent (letter + combining mark)", "中文cafe\u{301}中文", "中文 cafe\u{301} 中文"],
    ["word followed by a unit", "增长é5%左右", "增长 é5% 左右"],
  ])("%s", (_label, input, expected) => {
    expect(fmt(input)).toBe(expected);
  });

  it("is idempotent on the spaced form", () => {
    expect(fmt("中文 café 中文")).toBe("中文 café 中文");
  });

  it("does not space fullwidth Latin letters that the user chose to keep", () => {
    // Fullwidth forms carry their own sidebearing, like fullwidth punctuation.
    expect(fmt("中文ＡＢＣ中文", KEEP_FULLWIDTH)).toBe("中文ＡＢＣ中文");
  });

  it("converts a dash between an accented word and CJK", () => {
    expect(fmt("café--中文")).toBe("café —— 中文");
    expect(fmt("中文--café")).toBe("中文 —— café");
  });

  it("reads an apostrophe between accented letters as an apostrophe", () => {
    // `l'été` — with ASCII-only letters the `'` paired with the next `'` as a
    // quotation and both were converted.
    expect(fmt("中文 l'été 和 l'école 中文")).toBe("中文 l'été 和 l'école 中文");
  });

  it("classifies letters", () => {
    for (const ch of ["a", "Z", "é", "ß", "ø", "Ł", "ệ"]) expect(isLatinLetter(ch)).toBe(true);
    for (const ch of ["1", "中", "あ", "Ａ", "ｚ", "é".normalize("NFD")[1], " ", "", "я", "α"]) {
      expect(isLatinLetter(ch)).toBe(false);
    }
  });
});

describe("CJK letters beyond the two BMP Han blocks", () => {
  // U+20BB7 (Extension B), U+2CEB0 (Extension F), U+30000 (Extension G).
  const SUPPLEMENTARY = ["\u{20bb7}", "\u{2ceb0}", "\u{30000}"];

  describe.each(SUPPLEMENTARY)("supplementary-plane Han %s", (han) => {
    it("is spaced from Latin on both sides", () => {
      expect(fmt(`${han}abc${han}`)).toBe(`${han} abc ${han}`);
    });

    it("is spaced from digits and keeps the unit attached", () => {
      expect(fmt(`${han}50%${han}`)).toBe(`${han} 50% ${han}`);
    });

    it("is spaced from a halfwidth parenthesis", () => {
      expect(fmt(`${han}(abc)${han}`)).toBe(`${han} (abc) ${han}`);
    });

    it("turns parentheses around it fullwidth", () => {
      expect(fmt(`(${han}野家)`)).toBe(`（${han}野家）`);
    });

    it("turns brackets around it fullwidth when that rule is on", () => {
      expect(fmt(`[${han}野家]`, WITH_BRACKETS)).toBe(`【${han}野家】`);
    });

    it("gets its dashes converted", () => {
      expect(fmt(`${han}--${han}`)).toBe(`${han} —— ${han}`);
      expect(fmt(`abc--${han}`)).toBe(`abc —— ${han}`);
    });

    it("still gets fullwidth punctuation, as before", () => {
      expect(fmt(`abc${han},def`)).toBe(`abc ${han}，def`);
    });

    it("makes a quotation next to it a CJK-context quotation", () => {
      expect(fmt(`${han}"abc"`)).toBe(`${han} “abc”`);
      expect(fmt(`"abc"${han}`)).toBe(`“abc” ${han}`);
    });

    it("survives formatting intact and idempotently", () => {
      const once = fmt(`${han}abc,${han}(x)${han}--y`);
      expect([...once].filter((ch) => ch === han)).toHaveLength(3);
      expect(fmt(once)).toBe(once);
    });
  });

  it.each([
    ["ideographic iteration mark", "人々abc", "人々 abc"],
    ["ideographic number zero", "二〇abc", "二〇 abc"],
    ["compatibility ideograph", "\u{f900}abc", "\u{f900} abc"],
    ["halfwidth katakana", "ｶﾀｶﾅabc", "ｶﾀｶﾅ abc"],
    ["bopomofo", "ㄅㄆㄇabc", "ㄅㄆㄇ abc"],
  ])("%s is a CJK letter for spacing", (_label, input, expected) => {
    expect(fmt(input)).toBe(expected);
  });

  it("treats the katakana prolonged sound mark as a letter in every rule", () => {
    expect(fmt("コーヒーabc")).toBe("コーヒー abc");
    // The punctuation rule read it as a non-letter and left the comma halfwidth.
    expect(fmt("コーヒー,紅茶")).toBe("コーヒー，紅茶");
    expect(isCJKLetter("ー")).toBe(true);
  });

  it("does not treat the katakana middle dot as a letter", () => {
    // It is punctuation with its own spacing; `ジョン・Smith` is one name.
    expect(fmt("ジョン・Smith")).toBe("ジョン・Smith");
    expect(isCJKLetter("・")).toBe(false);
  });

  it("still leaves Korean unspaced", () => {
    expect(fmt("VMark에는 기능이")).toBe("VMark에는 기능이");
    expect(isCJKLetter("한")).toBe(false);
  });

  it("classifies single code units and whole code points alike", () => {
    expect(isCJKLetter("中")).toBe(true);
    expect(isCJKLetter("\u{20bb7}")).toBe(true);
    expect(isCJKLetter("")).toBe(false);
    expect(isCJKLetter("a")).toBe(false);
    expect(isCJKLetter("，")).toBe(false);
  });
});

describe("the `)` that closes a link", () => {
  it.each([
    ["CJK link text, CJK after", "见[链接](http://a.b)中文", "见[链接](http://a.b)中文"],
    ["with a title", '见[链接](http://a.b "标题")中文', '见[链接](http://a.b "标题")中文'],
    ["empty link text", "见[](http://a.b)中文", "见[](http://a.b)中文"],
    ["emphasised CJK link text", "见[**链接**](http://a.b)中文", "见[**链接**](http://a.b)中文"],
    ["two links in a row", "[一](a)[二](b)三", "[一](a)[二](b)三"],
  ])("is not spaced as a parenthesis: %s", (_label, input, expected) => {
    expect(fmt(input)).toBe(expected);
  });

  it.each([
    ["Latin link text", "[GitHub](https://github.com)上的项目", "[GitHub](https://github.com) 上的项目"],
    ["link text ending in a digit", "[第1](a)章", "[第 1](a) 章"],
    ["emphasised Latin link text", "[**GitHub**](u)上", "[**GitHub**](u) 上"],
    ["code in link text", "[`npm`](u)包", "[`npm`](u) 包"],
    ["accented Latin link text", "[café](u)在", "[café](u) 在"],
  ])("keeps the Latin/CJK gap across the link syntax: %s", (_label, input, expected) => {
    expect(fmt(input)).toBe(expected);
  });

  it("keeps a space the author already typed", () => {
    expect(fmt("见[链接](http://a.b) 中文")).toBe("见[链接](http://a.b) 中文");
  });

  it("still spaces a real parenthesis", () => {
    expect(fmt("中文(abc)中文")).toBe("中文 (abc) 中文");
    expect(fmt("见[链接](u)和(abc)中文")).toBe("见[链接](u)和 (abc) 中文");
  });

  it("applies inside a table cell", () => {
    const table = "| 名称 | 值 |\n| --- | --- |\n| [链接](u)中文 | [Git](u)中文 |";
    expect(fmt(table)).toBe("| 名称 | 值 |\n| --- | --- |\n| [链接](u)中文 | [Git](u) 中文 |");
  });

  it("is idempotent", () => {
    for (const input of ["见[链接](http://a.b)中文", "[GitHub](u)上的项目"]) {
      const once = fmt(input);
      expect(fmt(once)).toBe(once);
    }
  });
});
