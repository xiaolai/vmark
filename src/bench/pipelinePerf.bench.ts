/**
 * Pipeline serialization budget — WI-1.5.
 *
 * Purpose: a pre-inversion baseline for Phase 2. The serializer runs on every
 * WYSIWYG edit — `useTiptapFlush` schedules a full PM → mdast → markdown pass on
 * each update — so a per-node registry adds dispatch, predicate evaluation and
 * allocation to the hot path. Codex flagged the absence of any benchmark or
 * budget as a MAJOR gap.
 *
 * This is deliberately NOT wired into `check:all`. Wall-clock assertions under
 * v8 coverage instrumentation are flaky, and a gate that fails randomly gets
 * disabled — which is how gates die here. Run it before and after a Phase 2
 * tier instead:
 *
 *     pnpm exec vitest bench src/bench/pipelinePerf.bench.ts
 *
 * Unlike `markdown.bench.ts`, this uses the PRODUCTION schema. That file builds
 * `getSchema([StarterKit])`, which lacks every VMark node — so it measures a
 * pipeline the app never runs.
 *
 * Baseline recorded 2026-07-23 (M-series, unloaded, no coverage):
 *
 *   |  size  | median | p95    |
 *   |--------|--------|--------|
 *   |  10 KB |  3.9ms |  9.2ms |
 *   | 100 KB | 34.1ms | 35.4ms |
 *   |   1 MB | 368.2ms| 368.8ms|
 *
 * Roughly linear at ~0.37 ms/KB. Budget for Phase 2: no tier may regress the
 * median by more than 3x at any size. A 1 MB document already costs ~368 ms per
 * flush, so a large regression is a UX problem, not a micro-optimisation.
 *
 * @coordinates-with src/test/productionSchema.ts — the schema under measurement
 * @module bench/pipelinePerf.bench
 */
import { bench, describe } from "vitest";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline/adapter";
import { getProductionSchema } from "@/test/productionSchema";

/** A repeating block exercising headings, marks, links, lists and tables. */
const UNIT =
  "## Heading\n\nSome **bold** and *italic* text with a [link](https://example.com).\n\n" +
  "- item one\n- item two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n";

function docOfBytes(target: number): string {
  let out = "";
  while (out.length < target) out += UNIT;
  return out.slice(0, target);
}

const schema = getProductionSchema();

const md10K = docOfBytes(10_000);
const md100K = docOfBytes(100_000);
const md1M = docOfBytes(1_000_000);

const doc10K = parseMarkdown(schema, md10K);
const doc100K = parseMarkdown(schema, md100K);
const doc1M = parseMarkdown(schema, md1M);

describe("serialize (production schema)", () => {
  bench("10 KB", () => {
    serializeMarkdown(schema, doc10K);
  });

  bench("100 KB", () => {
    serializeMarkdown(schema, doc100K);
  });

  bench("1 MB", () => {
    serializeMarkdown(schema, doc1M);
  });
});

describe("parse (production schema)", () => {
  bench("10 KB", () => {
    parseMarkdown(schema, md10K);
  });

  bench("100 KB", () => {
    parseMarkdown(schema, md100K);
  });
});
