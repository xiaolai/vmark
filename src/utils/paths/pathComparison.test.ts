// WI-17.1 — platform-aware path comparison: full case folding on Windows
// (incl. UNC), byte-exact macOS/Linux, separator + trailing normalization.
import { describe, expect, it } from "vitest";
import {
  isWithinRootForCompare,
  normalizePathForCompare,
  pathsEqualForCompare,
} from "./pathComparison";

describe("normalizePathForCompare", () => {
  it.each([
    // [platform, input, expected]
    ["windows", "C:\\Repo\\Sub", "c:/repo/sub"],
    ["windows", "C:/Repo/", "c:/repo"],
    ["windows", "\\\\Server\\Share\\Dir", "//server/share/dir"],
    ["windows", "c:\\repo/Mixed\\Sep", "c:/repo/mixed/sep"],
    ["macos", "/Users/X/Repo", "/Users/X/Repo"],
    ["macos", "/Users/X/Repo/", "/Users/X/Repo"],
    ["linux", "/home/X/Repo", "/home/X/Repo"],
    ["linux", "/home/x/repo//", "/home/x/repo"],
    ["macos", "", ""],
  ] as const)("%s: %s → %s", (platform, input, expected) => {
    expect(normalizePathForCompare(input, platform)).toBe(expected);
  });

  it("is deterministic (same input → same output)", () => {
    const a = normalizePathForCompare("C:\\Repo\\ünïcode\\文档", "windows");
    const b = normalizePathForCompare("C:\\Repo\\ünïcode\\文档", "windows");
    expect(a).toBe(b);
  });
});

describe("pathsEqualForCompare", () => {
  it.each([
    ["windows", "C:\\Repo", "c:/repo", true],
    ["windows", "\\\\SRV\\share", "//srv/Share", true],
    ["windows", "C:\\Repo", "C:\\Other", false],
    ["macos", "/Users/X/Repo", "/users/x/repo", false],
    ["macos", "/Users/X/Repo/", "/Users/X/Repo", true],
    ["linux", "/a/B", "/a/b", false],
    ["linux", "/a/b", "/a/b", true],
  ] as const)("%s: %s == %s → %s", (platform, a, b, expected) => {
    expect(pathsEqualForCompare(a, b, platform)).toBe(expected);
  });
});

describe("pathsEqualForCompare edge guards", () => {
  it("empty inputs are never equal (guard branch)", () => {
    expect(pathsEqualForCompare("", "/a", "macos")).toBe(false);
    expect(pathsEqualForCompare("/a", "", "windows")).toBe(false);
    expect(pathsEqualForCompare("", "", "linux")).toBe(false);
  });
});

describe("isWithinRootForCompare", () => {
  it.each([
    // Windows: component-case + separator variants must contain
    ["windows", "C:\\Repo", "c:\\repo\\a.md", true],
    ["windows", "C:\\Repo", "C:/REPO/sub/deep.md", true],
    ["windows", "\\\\Server\\Share", "//server/share/x.md", true],
    ["windows", "C:\\Repo", "C:\\RepoOther\\a.md", false],
    // macOS: byte-exact — alternate casing does NOT contain
    ["macos", "/Users/X/Repo", "/users/x/repo/a.md", false],
    ["macos", "/Users/X/Repo", "/Users/X/Repo/a.md", true],
    // Linux: case-sensitive
    ["linux", "/a/b", "/a/B/c.md", false],
    ["linux", "/a/b", "/a/b/c.md", true],
    // Boundary check: no substring false positives on any platform
    ["macos", "/Users/root", "/Users/rootother/f.md", false],
    ["windows", "C:\\ro", "C:\\rootother\\f.md", false],
    // Root equals target
    ["macos", "/Users/X/Repo", "/Users/X/Repo", true],
    ["windows", "C:\\Repo", "c:/repo", true],
    // Trailing separators on the root
    ["linux", "/a/b/", "/a/b/c.md", true],
  ] as const)("%s: %s ∋ %s → %s", (platform, root, target, expected) => {
    expect(isWithinRootForCompare(root, target, platform)).toBe(expected);
  });

  it("handles nested roots — deeper root also contains", () => {
    expect(isWithinRootForCompare("/a", "/a/b/c.md", "macos")).toBe(true);
    expect(isWithinRootForCompare("/a/b", "/a/b/c.md", "macos")).toBe(true);
    expect(
      normalizePathForCompare("/a/b", "macos").length >
        normalizePathForCompare("/a", "macos").length,
    ).toBe(true);
  });

  it("empty root or target never contains", () => {
    expect(isWithinRootForCompare("", "/a/b", "macos")).toBe(false);
    expect(isWithinRootForCompare("/a", "", "macos")).toBe(false);
  });
});
