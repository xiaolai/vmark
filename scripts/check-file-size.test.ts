/**
 * Tests for the file-size gate's pure core (check-file-size.mjs) and the
 * merge-base ratchet comparison (check-baseline-ratchet.mjs).
 */
import { describe, it, expect } from "vitest";
import {
  countLines,
  isExcluded,
  isTestFile,
  toPosix,
  validateBaseline,
  evaluateSizes,
  TYPE_ONLY_ALLOWLIST,
} from "./check-file-size.mjs";
import { compareBaselines } from "./check-baseline-ratchet.mjs";

describe("countLines", () => {
  it.each([
    ["", 0],
    ["one line no newline", 1],
    ["one line\n", 1],
    ["a\nb\nc\n", 3],
    ["a\nb\nc", 3], // trailing partial line counts
  ])("counts %j as %i", (text, expected) => {
    expect(countLines(text)).toBe(expected);
  });
});

describe("isTestFile", () => {
  it.each([
    ["src/foo.test.ts", true],
    ["src/foo.bench.ts", true],
    ["src/__tests__/foo.ts", true],
    ["src/__mocks__/foo.ts", true],
    ["src/foo.ts", false],
  ])("%s → %s", (p, expected) => {
    expect(isTestFile(p)).toBe(expected);
  });
});

describe("isExcluded", () => {
  it.each([
    ["src/foo.d.ts", true],
    ["src/foo.ts", false],
    // Test files are NOT excluded — they are measured against the test limit.
    ["src/foo.test.ts", false],
  ])("%s → %s", (p, expected) => {
    expect(isExcluded(p)).toBe(expected);
  });

  it("exempts only allow-listed types.ts files, not the name in general", () => {
    // Allow-listed: reviewed as declarations-only.
    for (const p of TYPE_ONLY_ALLOWLIST) {
      expect(isExcluded(p)).toBe(true);
    }
    // Any other types.ts is scanned like a normal code file.
    expect(isExcluded("src/some/new/types.ts")).toBe(false);
  });
});

describe("toPosix", () => {
  it("is identity for already-posix paths", () => {
    expect(toPosix("src/a/b.ts")).toBe("src/a/b.ts");
  });
});

describe("validateBaseline", () => {
  it("accepts a valid baseline and applies the default limits", () => {
    expect(validateBaseline({ files: { "a.ts": 400 } })).toEqual({
      limit: 300,
      files: { "a.ts": 400 },
      testLimit: 800,
      testFiles: {},
    });
  });

  it("accepts and validates the test-file section", () => {
    expect(
      validateBaseline({ testLimit: 900, testFiles: { "a.test.ts": 1000 } })
    ).toMatchObject({ testLimit: 900, testFiles: { "a.test.ts": 1000 } });
    expect(() => validateBaseline({ testLimit: "big" })).toThrow();
    expect(() => validateBaseline({ testFiles: { "a.test.ts": "huge" } })).toThrow();
  });

  it.each([
    [null],
    [[]],
    [{ limit: "300" }],
    [{ limit: -1 }],
    [{ limit: 300, files: [] }],
    [{ limit: 300, files: { "a.ts": "invalid" } }],
    [{ limit: 300, files: { "a.ts": 0 } }],
  ])("rejects malformed baseline %j", (raw) => {
    expect(() => validateBaseline(raw)).toThrow();
  });
});

describe("evaluateSizes", () => {
  const baseline = { limit: 300, files: { "big.ts": 400, "gone.ts": 500, "small.ts": 350 } };

  it("classifies new violations, regressions, slack, and prunable entries", () => {
    const measured = new Map([
      ["fresh.ts", 301], // not baselined, over limit → new violation
      ["ok.ts", 299], // under limit → fine
      ["big.ts", 401], // grew past cap → regression
      ["small.ts", 250], // now at/below limit → prunable
    ]);
    const result = evaluateSizes(measured, baseline);
    expect(result.newViolations).toEqual([{ p: "fresh.ts", n: 301 }]);
    expect(result.regressions).toEqual([{ p: "big.ts", n: 401, cap: 400 }]);
    // gone.ts missing entirely + small.ts under limit → both prunable
    expect(result.prunable.sort()).toEqual(["gone.ts", "small.ts"]);
    expect(result.slack).toEqual([]);
  });

  it("flags unratcheted slack (shrunk but still above limit)", () => {
    const measured = new Map([
      ["big.ts", 350],
      ["gone.ts", 500],
      ["small.ts", 350],
    ]);
    const result = evaluateSizes(measured, baseline);
    expect(result.slack).toEqual([{ p: "big.ts", n: 350, cap: 400 }]);
    expect(result.regressions).toEqual([]);
  });

  it("passes a clean state untouched", () => {
    const measured = new Map([
      ["big.ts", 400],
      ["gone.ts", 500],
      ["small.ts", 350],
      ["ok.ts", 100],
    ]);
    const result = evaluateSizes(measured, baseline);
    expect(result.newViolations).toEqual([]);
    expect(result.regressions).toEqual([]);
    expect(result.slack).toEqual([]);
    expect(result.prunable).toEqual([]);
  });
});

describe("compareBaselines (merge-base ratchet)", () => {
  const base = {
    limit: 300,
    files: { "a.ts": 400, "b.ts": 500 },
    testLimit: 800,
    testFiles: { "a.test.ts": 1000 },
  };

  it("passes when nothing loosened", () => {
    const head = { limit: 300, files: { "a.ts": 380 }, testLimit: 800, testFiles: { "a.test.ts": 900 } }; // lowered + removed
    expect(compareBaselines(base, head)).toEqual({ failures: [], newEntries: [] });
  });

  it("fails when the global limit is raised", () => {
    const head = { limit: 400, files: {}, testLimit: 800, testFiles: {} };
    const { failures } = compareBaselines(base, head);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("limit raised");
  });

  it("fails when the test limit or a test cap is raised", () => {
    const head = {
      ...base,
      files: { ...base.files },
      testLimit: 900,
      testFiles: { "a.test.ts": 1200 },
    };
    const { failures } = compareBaselines(base, head);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain("test limit raised");
    expect(failures[1]).toContain("testFiles cap raised");
  });

  it("fails when an existing cap is raised", () => {
    const head = { limit: 300, files: { "a.ts": 450, "b.ts": 500 }, testLimit: 800, testFiles: {} };
    const { failures } = compareBaselines(base, head);
    expect(failures).toEqual(["a.ts: files cap raised 400 → 450 (never raise a cap)"]);
  });

  it("reports (but allows) new entries for reviewer judgment", () => {
    const head = {
      limit: 300,
      files: { ...base.files, "new.ts": 320 },
      testLimit: 800,
      testFiles: { ...base.testFiles },
    };
    const { failures, newEntries } = compareBaselines(base, head);
    expect(failures).toEqual([]);
    expect(newEntries).toEqual([{ p: "new.ts", cap: 320, section: "files" }]);
  });
});
