/**
 * Tests for the file-size gate's pure core (check-file-size.mjs).
 *
 * The merge-base half moved: WI-16 generalized `check-baseline-ratchet.mjs`
 * from this one baseline to every committed baseline, so its cases now live in
 * `check-baseline-ratchet.test.mjs` — exercised end-to-end against scratch git
 * repositories rather than against a hand-built pair of baseline objects.
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

  // WI-15: generated contracts grow with the surface they describe (one more
  // MCP operation = one more block), and "split the file" is not a thing a
  // human can do to them. The ~300-line rule exists for readers of code that
  // is maintained by hand; a generated file has no such reader.
  describe("generated files", () => {
    const marker = "/**\n * GENERATED FILE — DO NOT EDIT.\n */\nexport const X = 1;\n";

    it("exempts a file in a generated/ directory that declares itself generated", () => {
      expect(isExcluded("src/services/mcpBridge/v2/generated/bridgeContracts.ts", marker)).toBe(
        true,
      );
      expect(isExcluded("server/mcp/src/bridge/generated/bridgeRequests.ts", marker)).toBe(true);
    });

    it("does NOT exempt a hand-written file that merely sits in generated/", () => {
      // The directory alone is not a claim — otherwise the exemption is a
      // one-`mkdir` bypass of the whole gate.
      expect(isExcluded("src/foo/generated/handWritten.ts", "export const X = 1;\n")).toBe(false);
    });

    it("does NOT exempt a file that claims to be generated from outside generated/", () => {
      expect(isExcluded("src/foo/bridgeContracts.ts", marker)).toBe(false);
    });

    it("only reads the header — a marker buried in the body does not count", () => {
      const buried = `${"// filler\n".repeat(40)} * GENERATED FILE — DO NOT EDIT.\n`;
      expect(isExcluded("src/foo/generated/sneaky.ts", buried)).toBe(false);
    });

    it("is inert when no content is supplied", () => {
      expect(isExcluded("src/foo/generated/bridgeContracts.ts")).toBe(false);
    });
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
