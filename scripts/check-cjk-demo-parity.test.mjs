// Self-test for scripts/check-cjk-demo-parity.mjs (WI-CJKF7.2).
//
// The gate is only worth having if it FAILS on the drift it was built for, so
// each direction is exercised against a synthetic pair rather than against the
// repository's own files — which are, by design, in agreement.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compare, parseDefaults, REAL, DEMO } from "./check-cjk-demo-parity.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const realOf = (body) => `export const DEFAULT_CJK_FORMATTING: CJKFormattingSettings = {\n${body}\n};\n`;
const demoOf = (body) => `export const defaultCJKSettings: CJKFormattingSettings = {\n${body}\n};\n`;

const THREE = "  a: true,\n  b: false,\n  c: \"curly\",";

describe("compare", () => {
  it("passes when the two agree", () => {
    expect(compare(realOf(THREE), demoOf(THREE))).toEqual([]);
  });

  it("fails on a key the demo is missing", () => {
    const failures = compare(realOf(THREE), demoOf("  a: true,\n  b: false,"));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("missing from the demo");
    expect(failures[0]).toContain("`c`");
  });

  it("fails on a key only the demo has", () => {
    const failures = compare(realOf("  a: true,"), demoOf("  a: true,\n  z: true,"));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("present only in the demo");
  });

  it("fails on a differing default, which is worse than a missing key", () => {
    const failures = compare(realOf("  a: true,"), demoOf("  a: false,"));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBe("default differs for `a`: app true, demo false");
  });

  it("reports every divergence, not just the first", () => {
    // b and c missing, z extra, a's default differs.
    const failures = compare(realOf(THREE), demoOf("  a: false,\n  z: 1,"));
    expect(failures).toHaveLength(4);
    expect(failures.filter((f) => f.includes("missing from the demo"))).toHaveLength(2);
    expect(failures.filter((f) => f.includes("present only in the demo"))).toHaveLength(1);
    expect(failures.filter((f) => f.includes("default differs"))).toHaveLength(1);
  });
});

describe("parseDefaults", () => {
  it("ignores trailing comments", () => {
    const entries = parseDefaults(realOf("  a: false, // OFF by default"), "DEFAULT_CJK_FORMATTING");
    expect(entries.get("a")).toBe("false");
  });

  it("keeps quoted string values verbatim", () => {
    const entries = parseDefaults(realOf('  q: "curly",'), "DEFAULT_CJK_FORMATTING");
    expect(entries.get("q")).toBe('"curly"');
  });

  it("throws when the declaration is absent, so the gate fails closed", () => {
    expect(() => parseDefaults("nothing here", "DEFAULT_CJK_FORMATTING")).toThrow(/no declaration/);
  });

  it("throws when the literal parses to nothing", () => {
    expect(() => parseDefaults(realOf("  // only a comment"), "DEFAULT_CJK_FORMATTING")).toThrow(
      /no entries parsed/
    );
  });
});

describe("the gate against the real repository", () => {
  it("passes on the tree as committed", () => {
    const out = execFileSync("node", [join(root, "scripts/check-cjk-demo-parity.mjs")], {
      cwd: root,
      encoding: "utf8",
    });
    expect(out).toContain("match");
  });

  it("names both files it compares", () => {
    expect(REAL).toBe("src/lib/cjkFormatter/types.ts");
    expect(DEMO).toBe("website/.vitepress/components/demos/cjkFormatter.ts");
  });
});
