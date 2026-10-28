// @vitest-environment node
// One identity for "is this the same file": the save queue's key and every
// same-file comparison the save pipeline makes. Separators, repeated and
// trailing slashes, and `.`/`..` segments never make two files of one; case
// does only where the platform's filesystem is case-sensitive by default
// (macOS stays byte-exact, as pathComparison.ts decides).
import { describe, expect, it } from "vitest";
import { fileIdentityKey, isSameFile } from "./fileIdentity";

describe("fileIdentityKey", () => {
  it.each([
    ["macos", "/a/./b.md", "/a/b.md"],
    ["macos", "/a/x/../b.md", "/a/b.md"],
    ["macos", "/a//b.md", "/a/b.md"],
    ["macos", "/a/B.md", "/a/B.md"],
    ["linux", "/../a/b.md", "/a/b.md"],
    ["windows", "C:\\Repo\\.\\Notes.md", "c:/repo/notes.md"],
    ["windows", "c:/repo/sub/../NOTES.md", "c:/repo/notes.md"],
    ["windows", "\\\\Server\\Share\\x\\..\\a.md", "//server/share/a.md"],
    ["macos", "/a/文档/./笔记.md", "/a/文档/笔记.md"],
  ] as const)("%s: %s → %s", (platform, input, expected) => {
    expect(fileIdentityKey(input, platform)).toBe(expected);
  });

  it("keeps a UNC share apart from a rooted path of the same names", () => {
    expect(fileIdentityKey("\\\\server\\share\\a.md", "windows")).not.toBe(fileIdentityKey("\\server\\share\\a.md", "windows"));
  });
});

describe("isSameFile", () => {
  it.each([
    ["macos", "/a/./b.md", "/a/b.md", true],
    ["macos", "/a/b.md", "/a/B.md", false],
    ["linux", "/a/b.md", "/a/B.md", false],
    ["windows", "C:\\A\\b.md", "c:/a/B.md", true],
    ["macos", "", "", false],
    ["macos", "/a/b.md", "/a/c.md", false],
  ] as const)("%s: %s vs %s → %s", (platform, a, b, same) => {
    expect(isSameFile(a, b, platform)).toBe(same);
  });
});
