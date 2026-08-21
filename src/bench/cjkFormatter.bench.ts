/**
 * CJK formatter benchmarks.
 *
 * Run: pnpm bench src/bench/cjkFormatter.bench.ts
 *
 * The formatter is SYNCHRONOUS and runs on the UI thread, so its cost is a
 * freeze the user sees. It is linear in document size with a constant of
 * roughly forty full-document regex passes (~20 rules × the fixed-point loop's
 * two-to-three iterations), which is why a large document is measured in
 * seconds rather than milliseconds.
 *
 * Measured 2026-08-21 on the maintainer's machine, for orientation rather than
 * as a threshold — this tier is not a gate:
 *
 *   33 KB   ~30 ms
 *   132 KB  ~190 ms
 *   330 KB  ~890 ms
 *   660 KB  ~3.2 s
 *
 * A typical Chinese document is 10–50 KB, i.e. under 80 ms. The numbers exist
 * so a change that makes this super-linear is noticed rather than remembered.
 *
 * @module bench/cjkFormatter.bench
 */
import { bench, describe } from "vitest";
import { formatMarkdown } from "@/lib/cjkFormatter";
import { DEFAULT_CJK_FORMATTING } from "@/lib/cjkFormatter/types";

const PARAGRAPH =
  "这是一段中文，里面有English单词和数字123，还有标点!以及(括号)。学习TypeScript和React,感觉收获很大.\n\n";

/** Prose with protected regions in every paragraph — the region-scan path. */
const WITH_REGIONS =
  "中文English `code` 更多English [链接](https://a.com/x) 文本 $a+b$ 结束\n\n";

const OPTIONS = { preserveTwoSpaceHardBreaks: true };
const run = (text: string) => formatMarkdown(text, DEFAULT_CJK_FORMATTING, OPTIONS);

const prose33k = PARAGRAPH.repeat(500);
const prose132k = PARAGRAPH.repeat(2000);
const prose330k = PARAGRAPH.repeat(5000);
const regions106k = WITH_REGIONS.repeat(2000);

describe("formatMarkdown — plain CJK prose", () => {
  bench("33 KB", () => void run(prose33k));
  bench("132 KB", () => void run(prose132k));
  bench("330 KB", () => void run(prose330k));
});

describe("formatMarkdown — prose dense with protected regions", () => {
  bench("106 KB, ~8000 regions", () => void run(regions106k));
});
