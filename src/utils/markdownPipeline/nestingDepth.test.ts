// @vitest-environment node
/**
 * The pre-parse nesting guard (#1374).
 *
 * `remark-gfm`'s autolink-literal transform walks the tree through
 * `mdast-util-find-and-replace` → `unist-util-visit-parents`, which recurses
 * once per tree LEVEL. A document of deeply nested containers therefore
 * overflows the JS stack inside `mdast-util-from-markdown`'s compile step,
 * before any VMark code sees the tree — so this cannot be fixed by making
 * VMark's own plugin walks iterative, which was tried and reverted.
 *
 * Measured ceilings for `"> ".repeat(d)`, by bisection:
 *
 *   macOS 26, node 24       between 4000 and 8000
 *   Linux aarch64, node 24  ~5585
 *   Linux aarch64, node 22  ~4843
 *
 * The ceiling also moves with LOAD: identical input at one size was measured
 * passing, overflowing, then passing again in three consecutive runs.
 *
 * So the limit is not "the depth that crashed"; it is far below the LOWEST
 * ceiling any measurement produced, because the number that matters is the one
 * on the busiest machine, which nobody can measure in advance.
 *
 * This guard is NOT what fixed the weekly soak — that was deep INLINE nesting
 * through VMark's own `walkAndReplace`, see customInlineDepth.test.ts. This
 * covers the container shape, whose recursion is upstream and cannot be
 * removed from here.
 *
 * @coordinates-with nestingDepth.ts — the scanner and the limit
 * @module utils/markdownPipeline/nestingDepth.test
 */
import { describe, it, expect } from "vitest";
import { MAX_NESTING_DEPTH, maxContainerDepth, checkNestingDepth } from "./nestingDepth";

describe("maxContainerDepth", () => {
  it("is zero for ordinary prose", () => {
    expect(maxContainerDepth("hello\n\nworld\n")).toBe(0);
  });

  it("counts blockquote markers", () => {
    expect(maxContainerDepth("> > > a\n")).toBe(3);
  });

  it("counts blockquote markers written without spaces", () => {
    // `>>>a` is three blockquotes in CommonMark, and a scanner that only
    // understood `"> "` would read it as one.
    expect(maxContainerDepth(">>>a\n")).toBe(3);
  });

  it("counts list indentation as nesting", () => {
    expect(maxContainerDepth("- a\n  - b\n    - c\n")).toBe(3);
  });

  it("adds blockquote and list nesting on the same line", () => {
    expect(maxContainerDepth("> > - a\n")).toBe(3);
  });

  it("reports the deepest line, not the last", () => {
    expect(maxContainerDepth("> > > deep\n\nshallow\n")).toBe(3);
  });

  it("does not count a `>` that is not a container marker", () => {
    // A blockquote marker is only one at the START of a line's content.
    expect(maxContainerDepth("a > b > c\n")).toBe(0);
  });

  it("ignores indentation inside a fenced code block", () => {
    // Four spaces inside a fence is code, not nesting. Without this, any
    // document containing an indented code sample would be scored as deeply
    // nested and could be refused — a guard that rejects ordinary documents is
    // worse than the crash it prevents.
    const md = "```\n" + "                                        x\n" + "```\n";
    expect(maxContainerDepth(md)).toBe(0);
  });

  it("is linear in input size, not in nesting", () => {
    // The guard runs on every parse, so it has to be a scan. 20000 levels is
    // past every measured ceiling and must still return promptly.
    const started = Date.now();
    expect(maxContainerDepth(`${"> ".repeat(20000)}a\n`)).toBe(20000);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("checkNestingDepth", () => {
  it("accepts a document at the limit", () => {
    expect(() => checkNestingDepth(`${"> ".repeat(MAX_NESTING_DEPTH)}a\n`)).not.toThrow();
  });

  it("refuses one level past it, naming the depth and the limit", () => {
    let message = "";
    try {
      checkNestingDepth(`${"> ".repeat(MAX_NESTING_DEPTH + 1)}a\n`);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    // The whole point is that the failure says what happened. The alternative
    // it replaces is `RangeError: Maximum call stack size exceeded`, which
    // names neither the document nor the cause.
    expect(message).toContain(String(MAX_NESTING_DEPTH + 1));
    expect(message).toContain(String(MAX_NESTING_DEPTH));
    expect(message.toLowerCase()).toContain("nest");
  });

  it("sits far below the lowest measured crash ceiling", () => {
    // 4843 is the lowest ceiling any measurement produced (Linux, node 22).
    // The limit must leave room for a machine under load, which has less
    // usable stack than the one that was measured — so this asserts a MARGIN,
    // not merely that the limit is smaller.
    const LOWEST_MEASURED_CEILING = 4843;
    expect(MAX_NESTING_DEPTH).toBeLessThanOrEqual(LOWEST_MEASURED_CEILING / 4);
  });

  it("is well above any plausible real document", () => {
    // A guard is only worth having if it never fires on real writing. The
    // deepest nesting in this repo's own corpora is in single digits.
    expect(MAX_NESTING_DEPTH).toBeGreaterThanOrEqual(500);
  });
});
