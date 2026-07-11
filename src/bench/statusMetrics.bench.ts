/**
 * Status-Bar Text Metrics Benchmarks
 *
 * Why this file exists:
 *   `StatusBarCounts` computes word/char metrics through the segment cache
 *   (`createMetricsCache`). The direct pipeline
 *   (`computeTextMetrics(stripMarkdown(md))`) — ~12 full-string regex passes
 *   plus several full code-point allocations — is what the component paid
 *   per flush BEFORE the cache landed; it is benchmarked here as the
 *   baseline the cache is judged against, and it still runs for the CRLF
 *   bypass path.
 *
 * What to compare:
 *   - "full pipeline" tiers = the pre-cache per-flush baseline.
 *   - "warm flush" tiers = what StatusBarCounts pays per flush today after a
 *     typical single-paragraph edit.
 *
 * Run:
 *   pnpm bench src/bench/statusMetrics.bench.ts
 *
 * @module bench/statusMetrics
 */

import { bench, describe } from "vitest";
import {
  computeTextMetrics,
  stripMarkdown,
} from "@/components/StatusBar/statusTextMetrics";
import { createMetricsCache } from "@/components/StatusBar/incrementalTextMetrics";
import { generateCjkMarkdown, generateMarkdown } from "./helpers";

// ---------------------------------------------------------------------------
// Fixtures (built once at module load — outside the measured region).
// Labels use measured UTF-16 char counts (see helpers.ts sizing notes).
// ---------------------------------------------------------------------------

const TIERS: Array<{ label: string; content: string }> = [
  { label: "small (~31K chars)", content: generateMarkdown(500) },
  { label: "medium (~159K chars)", content: generateMarkdown(2_500) },
  { label: "large (~512K chars)", content: generateMarkdown(8_000) },
  { label: "xlarge (~3.2M chars)", content: generateMarkdown(50_000) },
  { label: "cjk (~1.9M chars)", content: generateCjkMarkdown(30_000) },
];

// Pre-stripped variants so computeTextMetrics can be measured in isolation.
const STRIPPED = TIERS.map(({ label, content }) => ({
  label,
  plain: stripMarkdown(content),
}));

// Prebuilt single-paragraph-edit variants for the warm-cache suite, so the
// timed region measures only the cache pass — not fixture construction or
// rope flattening. Alternating variants guarantees the cache never sees the
// identical document twice while unedited blocks stay shared.
const WARM_VARIANTS = TIERS.map(({ label, content }) => ({
  label,
  base: content,
  edits: [0, 1].map(
    (i) => `Edited paragraph revision ${i} with a few words.\n\n${content}`,
  ),
}));

describe("stripMarkdown — full document", () => {
  for (const { label, content } of TIERS) {
    bench(
      label,
      () => {
        stripMarkdown(content);
      },
      { warmupIterations: 2 },
    );
  }
});

describe("computeTextMetrics — pre-stripped", () => {
  for (const { label, plain } of STRIPPED) {
    bench(
      label,
      () => {
        computeTextMetrics(plain);
      },
      { warmupIterations: 2 },
    );
  }
});

describe("full pipeline (pre-cache per-flush baseline)", () => {
  for (const { label, content } of TIERS) {
    bench(
      label,
      () => {
        computeTextMetrics(stripMarkdown(content));
      },
      { warmupIterations: 2 },
    );
  }
});

// What StatusBarCounts pays per flush today: each iteration alternates
// between two prebuilt one-paragraph edits of the same base document.
describe("incremental cache — warm flush after a 1-paragraph edit", () => {
  for (const { label, base, edits } of WARM_VARIANTS) {
    const compute = createMetricsCache();
    compute(base); // cold pass outside the measured region
    let tick = 0;
    bench(
      label,
      () => {
        tick++;
        compute(edits[tick % edits.length]);
      },
      { warmupIterations: 2 },
    );
  }
});

describe("incremental cache — new cache + first compute", () => {
  for (const { label, content } of TIERS) {
    bench(
      label,
      () => {
        createMetricsCache()(content);
      },
      { warmupIterations: 2 },
    );
  }
});
