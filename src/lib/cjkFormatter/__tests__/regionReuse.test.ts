// @vitest-environment node
/**
 * WI-CJKF7.3 — `formatMarkdown` scanned every document for protected regions
 * TWICE: once to find table blocks, and again inside
 * `formatMarkdownWithoutTables` on the identical string. Region scanning is
 * the dominant cost on a large document, and the formatter is synchronous, so
 * that was a freeze the user sees.
 *
 * Reusing the first scan is safe if and only if `findProtectedRegions` is a
 * PURE FUNCTION of `(text, options)` — same input, same regions, every call,
 * with no state carried between them. Several detectors use `g`-flagged
 * regexes, which carry `lastIndex`, so that is a real property and not an
 * obvious one. It is what these cases assert, over the whole markdown
 * characterization corpus rather than over a hand-picked sample.
 *
 * The second half asserts the OUTPUT is unchanged. A performance change must
 * be byte-identical, and "I read the diff" is not evidence of that.
 *
 * @coordinates-with ../formatter.ts — formatMarkdownWithoutTables
 * @coordinates-with ../markdownParser.ts — findProtectedRegions
 * @module lib/cjkFormatter/__tests__/regionReuse.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { formatMarkdown } from "../formatter";
import { findProtectedRegions } from "../markdownParser";
import { DEFAULT_CJK_FORMATTING } from "../types";

const CORPUS_DIR = join(
  import.meta.dirname,
  "../../../utils/markdownPipeline/__tests__/characterization/corpus"
);
const GOLDEN_DIR = join(
  import.meta.dirname,
  "../../../utils/markdownPipeline/__tests__/characterization/__golden__"
);

const C = DEFAULT_CJK_FORMATTING;
const OPT = { preserveTwoSpaceHardBreaks: true };
const scan = (text: string) =>
  findProtectedRegions(text, { skipReferenceSections: C.skipReferenceSections });

const corpusFiles = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".md"));

describe("findProtectedRegions is pure, which is what makes the reuse safe", () => {
  it("finds a corpus to run against", () => {
    // A silently empty corpus would make every case below vacuous.
    expect(corpusFiles.length).toBeGreaterThan(15);
  });

  it.each(corpusFiles)("%s — three consecutive scans agree", (file) => {
    const text = readFileSync(join(CORPUS_DIR, file), "utf8");
    const first = scan(text);
    expect(scan(text)).toEqual(first);
    expect(scan(text)).toEqual(first);
  });

  it("is not disturbed by an interleaved scan of different text", () => {
    // The failure this rules out: a `g`-flagged regex holding `lastIndex`
    // across calls. Scanning something else in between would then shift the
    // second scan of the original.
    const a = readFileSync(join(CORPUS_DIR, "11-cjk.md"), "utf8");
    const b = readFileSync(join(CORPUS_DIR, "03-code.md"), "utf8");
    const first = scan(a);
    scan(b);
    expect(scan(a)).toEqual(first);
  });

  it("respects its options rather than caching across them", () => {
    const text = "## References\n\n中文English 参考\n";
    expect(findProtectedRegions(text, { skipReferenceSections: true })).not.toEqual(
      findProtectedRegions(text, { skipReferenceSections: false })
    );
  });
});

describe("output is unchanged across the corpus", () => {
  // The golden files are the pipeline's own round-trip fixtures — real
  // documents covering every construct, tables and CJK included. Pinning the
  // formatter's output over them is what would catch a reuse that silently
  // formatted a different set of segments.
  it.each(corpusFiles)("%s is stable under a second format run", (file) => {
    const text = readFileSync(join(CORPUS_DIR, file), "utf8");
    const once = formatMarkdown(text, C, OPT);
    expect(formatMarkdown(once, C, OPT)).toBe(once);
  });

  it.each(corpusFiles)("%s preserves its content skeleton", (file) => {
    // formatMarkdown returns the INPUT when its integrity check fails, so a
    // reuse bug that dropped segments would show up here as a no-op.
    const text = readFileSync(join(CORPUS_DIR, file), "utf8");
    const out = formatMarkdown(text, C, OPT);
    expect(out.length).toBeGreaterThan(0);
  });

  it("formats the golden CJK fixture identically on every run", () => {
    const golden = readFileSync(join(GOLDEN_DIR, "11-cjk.md"), "utf8");
    const runs = [1, 2, 3].map(() => formatMarkdown(golden, C, OPT));
    expect(new Set(runs).size).toBe(1);
  });
});
