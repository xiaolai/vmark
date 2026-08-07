// @vitest-environment node
import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "./fuzzyMatch";

describe("fuzzyMatch", () => {
  describe("basic matching", () => {
    it("returns null for empty query", () => {
      expect(fuzzyMatch("", "hello.md")).toBeNull();
    });

    it("returns null when query has no subsequence match", () => {
      expect(fuzzyMatch("xyz", "hello.md")).toBeNull();
    });

    it("matches exact filename", () => {
      const result = fuzzyMatch("hello", "hello.md");
      expect(result).not.toBeNull();
      expect(result!.score).toBeGreaterThan(0);
      expect(result!.indices).toEqual([0, 1, 2, 3, 4]);
    });

    it("matches subsequence", () => {
      const result = fuzzyMatch("hlo", "hello.md");
      expect(result).not.toBeNull();
      expect(result!.indices).toEqual([0, 2, 4]);
    });

    it("is case insensitive", () => {
      expect(fuzzyMatch("HeLLo", "hello.md")).not.toBeNull();
    });
  });

  describe("scoring bonuses", () => {
    it("scores consecutive matches higher than scattered", () => {
      const consecutive = fuzzyMatch("hel", "hello.md")!;
      const scattered = fuzzyMatch("hlo", "hello.md")!;
      expect(consecutive.score).toBeGreaterThan(scattered.score);
    });

    it("scores word boundary matches higher", () => {
      const boundary = fuzzyMatch("ft", "fileTree.ts")!;
      const scattered = fuzzyMatch("ft", "raft.ts")!;
      expect(boundary.score).toBeGreaterThan(scattered.score);
    });

    it("gives bonus for first character match", () => {
      const firstChar = fuzzyMatch("f", "foo.md")!;
      const midChar = fuzzyMatch("o", "foo.md")!;
      expect(firstChar.score).toBeGreaterThan(midChar.score);
    });

    it("gives bonus for exact filename prefix", () => {
      const prefix = fuzzyMatch("read", "readme.md")!;
      const nonPrefix = fuzzyMatch("eadm", "readme.md")!;
      expect(prefix.score).toBeGreaterThan(nonPrefix.score);
    });
  });

  describe("path-aware matching", () => {
    it("matches against relative path", () => {
      const result = fuzzyMatch("store", "tabStore.ts", "src/stores/tabStore.ts");
      expect(result).not.toBeNull();
    });

    it("splits query on / for path segment matching", () => {
      const result = fuzzyMatch("s/ft", "fileTree.ts", "src/fileTree.ts");
      expect(result).not.toBeNull();
    });

    it("fails path segment match when directory doesn't match", () => {
      expect(fuzzyMatch("lib/ft", "fileTree.ts", "src/fileTree.ts")).toBeNull();
    });

    it("returns null when query has dir separator but file has no relPath", () => {
      // dirParts.length > 0 but relPath is undefined → else branch returns null
      expect(fuzzyMatch("src/file", "file.ts")).toBeNull();
    });

    it("weights filename matches higher than path matches", () => {
      const nameMatch = fuzzyMatch("tab", "tabStore.ts", "src/stores/tabStore.ts")!;
      const pathMatch = fuzzyMatch("tab", "other.ts", "src/tabs/other.ts")!;
      expect(nameMatch.score).toBeGreaterThan(pathMatch.score);
    });
  });

  describe("word boundary detection", () => {
    it("detects camelCase boundaries", () => {
      expect(fuzzyMatch("qoi", "quickOpenItems.ts")).not.toBeNull();
    });

    it("detects hyphen boundaries", () => {
      expect(fuzzyMatch("gp", "genie-picker.css")).not.toBeNull();
    });

    it("detects underscore boundaries", () => {
      expect(fuzzyMatch("fs", "file_store.ts")).not.toBeNull();
    });

    it("detects dot boundaries", () => {
      expect(fuzzyMatch("ft", "file.test.ts")).not.toBeNull();
    });
  });

  describe("CJK and Unicode", () => {
    it("matches CJK characters", () => {
      expect(fuzzyMatch("笔记", "我的笔记.md")).not.toBeNull();
    });

    it("matches mixed CJK and ASCII", () => {
      expect(fuzzyMatch("test", "测试test.md")).not.toBeNull();
    });
  });

  describe("edge cases", () => {
    it("handles single character query", () => {
      const result = fuzzyMatch("a", "abc.md");
      expect(result).not.toBeNull();
      expect(result!.indices).toEqual([0]);
    });

    it("handles query longer than target", () => {
      expect(fuzzyMatch("abcdefgh", "abc.md")).toBeNull();
    });

    it("handles special regex characters in query", () => {
      expect(fuzzyMatch(".", "file.md")).not.toBeNull();
    });

    it("handles query equal to filename", () => {
      expect(fuzzyMatch("readme.md", "readme.md")).not.toBeNull();
    });

    it("handles trailing slash in query", () => {
      // "src/" splits into ["src", ""] — after filtering empty, file part is "src"
      const result = fuzzyMatch("src/", "src", "src");
      // Should not crash; may or may not match depending on segments
      expect(result === null || typeof result.score === "number").toBe(true);
    });

    it("handles consecutive slashes in query", () => {
      // "src//f" splits and filters to ["src", "f"]
      const result = fuzzyMatch("src//f", "file.ts", "src/file.ts");
      expect(result).not.toBeNull();
    });

    it("handles slash-only query", () => {
      expect(fuzzyMatch("/", "file.md", "src/file.md")).toBeNull();
    });
  });
});
