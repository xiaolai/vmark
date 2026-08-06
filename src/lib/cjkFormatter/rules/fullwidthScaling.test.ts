/**
 * Audit 20260804-F5 — fullwidth punctuation normalization must be linear-ish.
 *
 * The fixed-point wrapper used to rescan the ENTIRE document (Latin-span scan
 * included) once per converted character, because each scan read its left
 * neighbour from the original text and so could only ever advance the
 * conversion front by one. On a long punctuation run in CJK context that is
 * Θ(N²) — and the formatter is synchronous, called from "Format CJK File" and
 * from paste, so the cost lands on the UI thread as a freeze.
 *
 * The bounds below are DELIBERATELY generous. They exist to catch quadratic
 * blow-up (10k commas went from ~10k document scans to a bounded few), not to
 * police constant factors on a loaded CI box. The output assertions matter as
 * much as the timing: "fast" is easy if you stop converting.
 */
import { describe, expect, it } from "vitest";
import { normalizeFullwidthPunctuation } from "./fullwidth";

/** Generous absolute ceiling — a quadratic implementation blows past it by orders. */
const BUDGET_MS = 2000;

function elapsed(fn: () => void): number {
  const started = performance.now();
  fn();
  return performance.now() - started;
}

/**
 * The fastest of `runs` samples.
 *
 * Scheduler noise is one-sided: a descheduled worker can only make a sample
 * look SLOWER, never faster. So the minimum is the sample least contaminated by
 * the rest of the suite, and it preserves the property under test — a quadratic
 * implementation is quadratic in its best run too. A single sample is what made
 * the ratio assertion below flake inside the full parallel suite while passing
 * in isolation.
 */
function fastest(runs: number, fn: () => void): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) best = Math.min(best, elapsed(fn));
  return best;
}

describe("normalizeFullwidthPunctuation scaling", () => {
  it("converts a 10k-comma run after a CJK char well inside the budget", () => {
    const input = `中${",".repeat(10_000)}`;
    let output = "";

    const ms = elapsed(() => {
      output = normalizeFullwidthPunctuation(input);
    });

    // Every comma converts: each one's left neighbour is the comma before it,
    // which is itself CJK terminal punctuation once converted.
    expect(output).toBe(`中${"，".repeat(10_000)}`);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("handles a mixed 10k run of every convertible mark", () => {
    const marks = ",.!?;:";
    const run = Array.from({ length: 10_000 }, (_, i) => marks[i % marks.length]).join("");
    let output = "";

    const ms = elapsed(() => {
      output = normalizeFullwidthPunctuation(`中${run}`);
    });

    expect(output).not.toContain(",");
    expect(output.startsWith("中，。！？；：")).toBe(true);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  // Opt-in, like `markdownPipeline/__tests__/performance.test.ts` (PERF=1).
  //
  // This is a wall-clock RATIO, and in the full suite — ~1450 files across
  // every core — the noise is larger than the signal it measures. Linear and
  // quadratic differ by 4x at 4x input; a saturated runner inflates a
  // millisecond sample by ~14x. It failed at 26.5ms against a 20.4ms bound on
  // code measured at rest as flatly linear (0.23 ms/1k, n=8k→64k).
  //
  // Widening the input ratio to buy margin does not work either: past ~64k
  // chars the timing turns over (0.25 → 1.11 ms/1k at 96k) on V8 string
  // representation, not on this algorithm, so a bigger sample measures the
  // engine instead. Best-of-N does not save it, and taking the minimum of BOTH
  // sides actively widens the ratio, because the sub-millisecond baseline
  // improves far more than the large one does.
  //
  // What still guards the ORIGINAL defect on every run is the absolute ceiling
  // in the two tests above: the quadratic implementation this file was written
  // against rescanned the whole document per converted character, which blows
  // past a 2s budget on 10k commas by orders of magnitude — no ratio needed.
  const itPerf = process.env.PERF === "1" ? it : it.skip;

  itPerf("scales sub-quadratically: 4x the input is not ~16x the work", () => {
    // A direct shape assertion on the algorithm, independent of the machine:
    // the old implementation's pass count grew with the run length, so this
    // ratio grew with it too.
    const run = (n: number) => `中${",".repeat(n)}`;
    // Warm up so JIT/first-run costs do not land on the small sample.
    normalizeFullwidthPunctuation(run(500));

    // Best-of-5 per side: with PERF=1 this runs deliberately, on a quiet
    // machine, where the minimum is the sample least polluted by the scheduler.
    // Sizes stay in the range where the timing is genuinely linear (see above).
    const small = fastest(5, () => normalizeFullwidthPunctuation(run(2_000)));
    const large = fastest(5, () => normalizeFullwidthPunctuation(run(8_000)));

    // 4x input under a quadratic law is ~16x time; the 1ms floor keeps a
    // sub-millisecond baseline from turning timer noise into a failure.
    expect(large).toBeLessThan(Math.max(small, 1) * 12);
  });

  it("still protects technical subspans inside a long document", () => {
    // The speed-up must not come from skipping the guards.
    const filler = `中${",".repeat(5_000)}`;
    const output = normalizeFullwidthPunctuation(`${filler}\n中文 https://example.com/a,b 结束`);

    expect(output).toContain("https://example.com/a,b");
    expect(output.startsWith(`中${"，".repeat(5_000)}`)).toBe(true);
  });

  it("leaves a long ASCII-only run untouched", () => {
    const input = ",".repeat(10_000);
    let output = "";
    const ms = elapsed(() => {
      output = normalizeFullwidthPunctuation(input);
    });

    expect(output).toBe(input);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("is idempotent on the adversarial input", () => {
    const once = normalizeFullwidthPunctuation(`中${",".repeat(5_000)}`);
    expect(normalizeFullwidthPunctuation(once)).toBe(once);
  });
});
