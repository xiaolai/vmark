/**
 * WI-5 — Formatter-idempotence property slice (D1 follow-on).
 *
 * Purpose: the CJK formatter is a normalizer, and a normalizer's contract is
 * that it converges in one pass: `format(format(x)) === format(x)`. A rule
 * that keeps inserting (or oscillates with another rule) corrupts documents a
 * little more on every "Format CJK File" invocation. These properties GENERATE
 * mixed CJK/Latin/digit/punctuation documents — including tables, fences,
 * headings and CRLF line endings — and assert the fixed-point contract over
 * the top-level pipeline the app actually calls (`formatMarkdown`, plus
 * `formatSelection` for the selection path), under the app's default config
 * and the widest rule combinations.
 *
 * Scope matches stryker.config.json's formatter `mutate` globs
 * (cjkFormatter/rules/**, quotePairing.ts, quoteClassification.ts): every
 * rule module executes under these inputs, so surviving mutants that break
 * convergence get killed.
 *
 * Seed convention (matches roundtrip.property.test.ts and the multiCursor
 * property suites): no pinned seed — fast-check prints `seed`/`path` on
 * failure for exact reproduction, and every failure is shrunk to a minimal
 * counterexample which is then pinned as a fixed regression test.
 *
 * Behavioral decisions behind the fixes (convergence over single-pass output,
 * space-transparent quote context, glyph-intrinsic curly roles, corners never
 * rewritten) are recorded as D8 in .claude/tdd-guardian/decisions-20260803.md.
 *
 * @coordinates-with ../formatter.ts — formatMarkdown / formatSelection
 * @coordinates-with ../rules/applyRules.ts — the per-segment rule dispatcher
 * @coordinates-with ../quotePairing.ts — stack-based quote conversion
 * @module lib/cjkFormatter/__tests__/idempotence.property.test
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { formatMarkdown, formatSelection } from "../formatter";
import { DEFAULT_CJK_FORMATTING, type CJKFormattingSettings } from "../types";

/** Same rationale as roundtrip.property.test.ts: CPU-bound properties on a
 *  loaded box need wall-clock headroom; real failures assert in milliseconds. */
const PROPERTY_TEST_TIMEOUT_MS = 30_000;

// ---- configs under test -----------------------------------------------------
// The app default, plus the two widest deviations: every rule on (fullwidth
// brackets, newline collapsing, punctuation limits) and the corner-quote path
// (exercises quotePairing's corner-for-cjk + nested-corner modes).
const ALL_ON: CJKFormattingSettings = {
  ...DEFAULT_CJK_FORMATTING,
  newlineCollapsing: true,
  fullwidthBrackets: true,
  consecutivePunctuationLimit: 2,
};
const CORNER_QUOTES: CJKFormattingSettings = {
  ...DEFAULT_CJK_FORMATTING,
  quoteStyle: "corner",
  cjkCornerQuotes: true,
  cjkNestedQuotes: true,
};
const CONFIGS: Array<[name: string, config: CJKFormattingSettings]> = [
  ["app defaults", DEFAULT_CJK_FORMATTING],
  ["everything on", ALL_ON],
  ["corner quotes", CORNER_QUOTES],
];

// ---- token pools ------------------------------------------------------------
// Mixed CJK / Latin / digits / halfwidth & fullwidth punctuation. Pools omit
// `|` and backticks so table and fence STRUCTURE stays valid — the content
// inside is unconstrained mixing.
const CJK_CHARS = [..."中文汉字排版格式化测试的一是了不人时大地你我他和说到就年着还需要空格"];
const cjkRun = fc
  .array(fc.constantFrom(...CJK_CHARS), { minLength: 1, maxLength: 6 })
  .map((cs) => cs.join(""));
const latinWord = fc.constantFrom(
  "hello", "world", "API", "GitHub", "npm", "v2.0", "test", "CJK", "a1b2",
);
const digits = fc.integer({ min: 0, max: 99999 }).map(String);
const halfPunct = fc.constantFrom(
  ",", ".", "!", "?", ":", ";", "(", ")", "-", "--", "...", '"', "'",
);
const fullPunct = fc.constantFrom(
  "，", "。", "！", "？", "：", "；", "（", "）", "……", "——", "、", "“", "”", "‘", "’",
);
const token = fc.oneof(cjkRun, latinWord, digits, halfPunct, fullPunct);

/** A line: tokens glued with or without spaces, so rules see both crowded and
 *  pre-spaced boundaries. */
const line = fc
  .array(fc.tuple(token, fc.constantFrom("", " ")), { minLength: 1, maxLength: 8 })
  .map((pairs) => pairs.map(([t, s]) => t + s).join("").trim())
  .filter((l) => l.length > 0);

// ---- block generators ---------------------------------------------------------
const paragraph = fc
  .array(line, { minLength: 1, maxLength: 3 })
  .map((ls) => ls.join("\n"));
const heading = fc
  .tuple(fc.integer({ min: 1, max: 6 }), line)
  .map(([lvl, l]) => `${"#".repeat(lvl)} ${l}`);
const bulletList = fc
  .array(line, { minLength: 1, maxLength: 3 })
  .map((ls) => ls.map((l) => `- ${l}`).join("\n"));
const fence = line.map((l) => "```\n" + l + "\n```"); // protected region
const table = fc
  .tuple(line, line, line, line)
  .map(([a, b, c, d]) => `| ${a} | ${b} |\n| --- | --- |\n| ${c} | ${d} |`);
const block = fc.oneof(paragraph, paragraph, heading, bulletList, fence, table);

/** A document: blocks joined by blank lines, LF or CRLF throughout. */
const document = fc
  .tuple(
    fc.array(block, { minLength: 1, maxLength: 5 }),
    fc.constantFrom("\n", "\r\n"),
  )
  .map(([blocks, eol]) => blocks.join(`${eol}${eol}`).replace(/\n/g, eol));

// ---- (1) idempotence over generated documents -------------------------------
describe("cjkFormatter — idempotence properties", () => {
  for (const [name, config] of CONFIGS) {
    it(`formatMarkdown is idempotent over generated documents (${name})`, () => {
      fc.assert(
        fc.property(document, (doc) => {
          const once = formatMarkdown(doc, config);
          const twice = formatMarkdown(once, config);
          expect(twice).toBe(once);
        }),
        { numRuns: 200 },
      );
    }, PROPERTY_TEST_TIMEOUT_MS);
  }

  it("formatSelection is idempotent over generated fragments (all configs)", () => {
    fc.assert(
      fc.property(line, (fragment) => {
        for (const [, config] of CONFIGS) {
          const once = formatSelection(fragment, config);
          const twice = formatSelection(once, config);
          expect(twice).toBe(once);
        }
      }),
      { numRuns: 200 },
    );
  }, PROPERTY_TEST_TIMEOUT_MS);

  // ---- (4) determinism: same input, same output, every call ------------------
  it("formatMarkdown is deterministic across repeated calls", () => {
    fc.assert(
      fc.property(document, (doc) => {
        for (const [, config] of CONFIGS) {
          expect(formatMarkdown(doc, config)).toBe(formatMarkdown(doc, config));
        }
      }),
      { numRuns: 100 },
    );
  }, PROPERTY_TEST_TIMEOUT_MS);
});

// ---- (2) boundary corpus ------------------------------------------------------
const LONG_LINE = "中文abc123，混排test。".repeat(834).slice(0, 10_000); // 10k chars, one line
const BOUNDARY_CORPUS: Array<[label: string, input: string]> = [
  ["empty string", ""],
  ["whitespace only", "   \n\t"],
  ["mixed CJK/Latin/digits, no spaces", "中文English混排123"],
  ["RTL Hebrew with Latin and CJK", "עברית abc 中文"],
  ["10k-char single line", LONG_LINE],
  ["astral-plane letters (surrogate pairs)", "𝔘𝔫𝔦 中文 𝔘𝔫𝔦code"],
  ["CRLF line endings", "第一行line one\r\n第二行line two\r\n第三行"],
];

describe("cjkFormatter — boundary corpus idempotence", () => {
  for (const [configName, config] of CONFIGS) {
    it.each(BOUNDARY_CORPUS)(
      `%s stays a fixed point after one pass (${configName})`,
      (_label, input) => {
        const once = formatMarkdown(input, config);
        expect(formatMarkdown(once, config)).toBe(once);
      },
    );
  }
});

// ---- pinned counterexamples (found by the properties above, then shrunk) ------
// Each entry is a real non-idempotence bug the property discovered on its first
// run (2026-08-03), shrunk by fast-check and pinned here so the exact regression
// stays covered even when the generator's random walk misses it.
describe("cjkFormatter — pinned shrunk counterexamples", () => {
  it("fullwidth punctuation cascades to its fixed point in one pass (中,,)", () => {
    // Was: 中,, → 中，, → 中，， (each pass converted one more comma because
    // the CJK-context scan read the ORIGINAL text, not its own output).
    const once = formatMarkdown("中,,", DEFAULT_CJK_FORMATTING);
    expect(formatMarkdown(once, DEFAULT_CJK_FORMATTING)).toBe(once);
  });

  it("fullwidth punctuation cascades rightward too (,,中)", () => {
    const once = formatMarkdown(",,中", DEFAULT_CJK_FORMATTING);
    expect(formatMarkdown(once, DEFAULT_CJK_FORMATTING)).toBe(once);
  });

  it("fullwidth cascade inside a table cell (defaults)", () => {
    const doc = "| 中 | 中 |\n| --- | --- |\n| 中,, | ， |";
    const once = formatMarkdown(doc, DEFAULT_CJK_FORMATTING);
    expect(formatMarkdown(once, DEFAULT_CJK_FORMATTING)).toBe(once);
  });

  it("quote context survives the pipeline's own spacing ('',中0 selection)", () => {
    // Was: ''中0 → ‘’ 中 0 → '' 中 0 (pass 1 saw 中 adjacent → curly; pass 1
    // also inserted the space; pass 2 saw a space boundary → back to straight).
    const once = formatSelection("''中0", DEFAULT_CJK_FORMATTING);
    expect(formatSelection(once, DEFAULT_CJK_FORMATTING)).toBe(once);
  });

  it("pre-existing curly open + straight close near CJK is stable", () => {
    // Was: “"中hello → “” 中 hello → "" 中 hello (same space-boundary flip).
    const once = formatSelection('“"中hello', DEFAULT_CJK_FORMATTING);
    expect(formatSelection(once, DEFAULT_CJK_FORMATTING)).toBe(once);
  });

  it("curly-glyph roles do not flip when spacing lands next to them", () => {
    // Was: hello“，" → hello “，" → hello "，" (pass 1 classified “ as close
    // — letter on its left; pass 1 also inserted a space before it; pass 2
    // then classified “ as open, paired it with ", and converted the pair).
    const doc = 'hello“，"\nhello\n\n中0';
    for (const [, config] of CONFIGS) {
      const once = formatMarkdown(doc, config);
      expect(formatMarkdown(once, config)).toBe(once);
    }
  });

  it("fullwidth punctuation sees the brackets quote conversion creates", () => {
    // Was: ,"中\n0“ → ,「中\n0」 → ，「中\n0」 (fullwidth ran before quote
    // conversion, so the comma became convertible — 「 on its right — only
    // on the second pass).
    const once = formatMarkdown(',"中\n0“', CORNER_QUOTES);
    expect(formatMarkdown(once, CORNER_QUOTES)).toBe(once);
  });

  it("dash conversion sees the corner brackets quote conversion creates", () => {
    // Was: ，--“中”0 → ，--「中」0 → ， ——「中」0 (dashes run before quotes,
    // so the 「 that makes -- convertible only existed on the next pass).
    const once = formatMarkdown("，--“中”0", CORNER_QUOTES);
    expect(formatMarkdown(once, CORNER_QUOTES)).toBe(once);
  });

  it("nested fullwidth parentheses convert all levels in one call", () => {
    // Was: (中(文)) → (中 （文）) → （中 （文）） (the regex converts one
    // nesting level per pass).
    const once = formatMarkdown("(中(文))", DEFAULT_CJK_FORMATTING);
    expect(formatMarkdown(once, DEFAULT_CJK_FORMATTING)).toBe(once);
  });

  it("nested fullwidth brackets convert all levels in one call", () => {
    // Was: [中[文]] → [中【文】] → 【中【文】】 (same one-level-per-pass).
    const once = formatMarkdown("[中[文]]", ALL_ON);
    expect(formatMarkdown(once, ALL_ON)).toBe(once);
  });

  it("corner conversion keeps pairing topology stable across passes", () => {
    // Was: pass 1 converted the double pair to 「…」; pass 2 no longer saw the
    // corners as quotes, so two ’ orphans (previously absorbed by the double
    // pair's orphan cleanup) paired with each other and became 『…』.
    const doc = "“hello\n\n中0 ’hello\nhello“，\n\n# 中’中";
    const once = formatMarkdown(doc, CORNER_QUOTES);
    expect(formatMarkdown(once, CORNER_QUOTES)).toBe(once);
  });
});

// ---- (3) fixed point: house-style input passes through byte-identical ---------
describe("cjkFormatter — house-style fixed points", () => {
  it("keeps an already-formatted mixed document byte-identical", () => {
    const houseStyle =
      "中文 English 混排 123，测试通过。\n\n下一段落 v2.0 保持不变。";
    expect(formatMarkdown(houseStyle, DEFAULT_CJK_FORMATTING)).toBe(houseStyle);
  });

  it("keeps an already-formatted table byte-identical", () => {
    const houseStyleTable = "| 名称 | 值 |\n| --- | --- |\n| 条目 one | 数字 1 |";
    expect(formatMarkdown(houseStyleTable, DEFAULT_CJK_FORMATTING)).toBe(
      houseStyleTable,
    );
  });
});
