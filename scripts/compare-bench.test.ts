// Tests for the bench regression comparator (scripts/compare-bench.mjs).
// The comparator turns two `vitest bench --outputJson` payloads into a
// regression verdict; these tests pin the comparison semantics.
import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import {
  compareBenchResults,
  flattenBenchmarks,
  parseCliArgs,
  renderMarkdown,
} from "./compare-bench.mjs";

interface BenchEntry {
  name: string;
  mean: number;
}

function benchJson(groups: Record<string, BenchEntry[]>) {
  return {
    files: [
      {
        filepath: "/repo/src/bench/example.bench.ts",
        groups: Object.entries(groups).map(([fullName, benchmarks]) => ({
          fullName,
          benchmarks: benchmarks.map((b, i) => ({
            id: `x_${i}`,
            name: b.name,
            mean: b.mean,
            hz: 1000 / b.mean,
          })),
        })),
      },
    ],
  };
}

describe("flattenBenchmarks", () => {
  it("keys benchmarks by group fullName + bench name", () => {
    const flat = flattenBenchmarks(
      benchJson({ "parse > markdown": [{ name: "1K lines", mean: 50 }] }),
    );
    expect(flat).toEqual({ "parse > markdown :: 1K lines": 50 });
  });

  it("returns an empty map for empty or shapeless payloads", () => {
    expect(flattenBenchmarks({ files: [] })).toEqual({});
    expect(flattenBenchmarks({})).toEqual({});
  });

  it("rejects non-finite means (NaN/Infinity) instead of comparing them", () => {
    const flat = flattenBenchmarks(
      benchJson({
        parse: [
          { name: "nan", mean: NaN },
          { name: "inf", mean: Infinity },
          { name: "ok", mean: 5 },
        ],
      }),
    );
    expect(flat).toEqual({ "parse :: ok": 5 });
  });
});

describe("compareBenchResults", () => {
  const base = benchJson({
    parse: [
      { name: "1K", mean: 50 },
      { name: "5K", mean: 300 },
    ],
  });

  it("passes when means are within the ratio threshold", () => {
    const current = benchJson({
      parse: [
        { name: "1K", mean: 90 }, // 1.8x — noisy but under 2.5x
        { name: "5K", mean: 310 },
      ],
    });
    const result = compareBenchResults(base, current, { ratioThreshold: 2.5 });
    expect(result.regressions).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("flags a benchmark whose mean regressed past the threshold", () => {
    const current = benchJson({
      parse: [
        { name: "1K", mean: 200 }, // 4x slower
        { name: "5K", mean: 300 },
      ],
    });
    const result = compareBenchResults(base, current, { ratioThreshold: 2.5 });
    expect(result.ok).toBe(false);
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0]).toMatchObject({
      name: "parse :: 1K",
      baselineMean: 50,
      currentMean: 200,
    });
    expect(result.regressions[0].ratio).toBeCloseTo(4);
  });

  it("ignores sub-floor baselines where ratios are pure noise", () => {
    const tinyBase = benchJson({ parse: [{ name: "empty doc", mean: 0.02 }] });
    const tinyCurrent = benchJson({
      parse: [{ name: "empty doc", mean: 0.4 }], // 20x, but microseconds
    });
    const result = compareBenchResults(tinyBase, tinyCurrent, {
      ratioThreshold: 2.5,
      minBaselineMeanMs: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.skippedBelowFloor).toEqual(["parse :: empty doc"]);
  });

  it("reports added and removed benchmarks without failing", () => {
    const current = benchJson({
      parse: [
        { name: "5K", mean: 305 },
        { name: "10K", mean: 700 },
      ],
    });
    const result = compareBenchResults(base, current, { ratioThreshold: 2.5 });
    expect(result.ok).toBe(true);
    expect(result.removed).toEqual(["parse :: 1K"]);
    expect(result.added).toEqual(["parse :: 10K"]);
  });

  it("improvements are never regressions", () => {
    const current = benchJson({
      parse: [
        { name: "1K", mean: 10 },
        { name: "5K", mean: 100 },
      ],
    });
    const result = compareBenchResults(base, current, { ratioThreshold: 2.5 });
    expect(result.ok).toBe(true);
    expect(result.regressions).toEqual([]);
  });
});

describe("parseCliArgs", () => {
  it("accepts the documented `--threshold 2.5` usage (value is consumed, not a file)", () => {
    expect(parseCliArgs(["base.json", "cur.json", "--threshold", "2.5"])).toEqual({
      files: ["base.json", "cur.json"],
      ratioThreshold: 2.5,
    });
    // Flag order must not matter.
    expect(parseCliArgs(["--threshold", "3", "base.json", "cur.json"])).toEqual({
      files: ["base.json", "cur.json"],
      ratioThreshold: 3,
    });
  });

  it("defaults the threshold to 2.5", () => {
    expect(parseCliArgs(["a.json", "b.json"])).toEqual({
      files: ["a.json", "b.json"],
      ratioThreshold: 2.5,
    });
  });

  it("errors on wrong file counts, unknown flags, and bad thresholds", () => {
    expect(parseCliArgs([])).toHaveProperty("error");
    expect(parseCliArgs(["only-one.json"])).toHaveProperty("error");
    expect(parseCliArgs(["a", "b", "c"])).toHaveProperty("error");
    expect(parseCliArgs(["a", "b", "--bogus"])).toHaveProperty("error");
    expect(parseCliArgs(["a", "b", "--threshold"])).toHaveProperty("error"); // missing value
    expect(parseCliArgs(["a", "b", "--threshold", "nope"])).toHaveProperty("error");
    expect(parseCliArgs(["a", "b", "--threshold", "-1"])).toHaveProperty("error");
  });
});

describe("renderMarkdown", () => {
  it("escapes pipes and newlines in benchmark names so table cells stay intact", () => {
    const result = compareBenchResults(
      benchJson({ "group | a": [{ name: "bench|name", mean: 50 }] }),
      benchJson({ "group | a": [{ name: "bench|name", mean: 60 }] }),
      { ratioThreshold: 2.5 },
    );
    const md = renderMarkdown(result, 2.5);
    const row = md.split("\n").find((l: string) => l.includes("bench"));
    expect(row).toContain("group \\| a :: bench\\|name");
  });
});
