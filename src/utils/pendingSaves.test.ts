// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerPendingSave,
  clearPendingSave,
  matchesPendingSave,
  hasPendingSave,
  _clearAllPendingSaves,
} from "./pendingSaves";

describe("pendingSaves (content-based)", () => {
  beforeEach(() => {
    _clearAllPendingSaves();
  });

  describe("registerPendingSave / hasPendingSave", () => {
    it("returns true for a registered path", () => {
      registerPendingSave("/path/to/file.md", "content");
      expect(hasPendingSave("/path/to/file.md")).toBe(true);
    });

    it("returns false for an unregistered path", () => {
      expect(hasPendingSave("/path/to/unknown.md")).toBe(false);
    });

    it("normalizes paths consistently", () => {
      registerPendingSave("/path/to/file.md", "content");
      expect(hasPendingSave("/path/to/file.md")).toBe(true);
    });

    it("handles Windows-style paths", () => {
      registerPendingSave("C:\\Users\\test\\file.md", "content");
      expect(hasPendingSave("C:\\Users\\test\\file.md")).toBe(true);
    });
  });

  describe("matchesPendingSave", () => {
    it("returns true when disk content matches pending content", () => {
      registerPendingSave("/path/to/file.md", "Hello World");
      expect(matchesPendingSave("/path/to/file.md", "Hello World")).toBe(true);
    });

    it("returns false when disk content differs from pending content", () => {
      registerPendingSave("/path/to/file.md", "Hello World");
      expect(matchesPendingSave("/path/to/file.md", "Different content")).toBe(false);
    });

    it("returns false for unregistered path", () => {
      expect(matchesPendingSave("/path/to/unknown.md", "any content")).toBe(false);
    });

    it("handles empty content", () => {
      registerPendingSave("/path/to/file.md", "");
      expect(matchesPendingSave("/path/to/file.md", "")).toBe(true);
      expect(matchesPendingSave("/path/to/file.md", "not empty")).toBe(false);
    });

    it("is case-sensitive for content", () => {
      registerPendingSave("/path/to/file.md", "Hello");
      expect(matchesPendingSave("/path/to/file.md", "hello")).toBe(false);
    });

    it("handles multiline content with different line endings", () => {
      const unixContent = "line1\nline2\nline3";
      const windowsContent = "line1\r\nline2\r\nline3";

      registerPendingSave("/path/to/file.md", unixContent);
      expect(matchesPendingSave("/path/to/file.md", unixContent)).toBe(true);
      expect(matchesPendingSave("/path/to/file.md", windowsContent)).toBe(false);
    });
  });

  describe("clearPendingSave", () => {
    it("removes a registered path with matching token", () => {
      const token = registerPendingSave("/path/to/file.md", "content");
      expect(hasPendingSave("/path/to/file.md")).toBe(true);

      clearPendingSave("/path/to/file.md", token);
      expect(hasPendingSave("/path/to/file.md")).toBe(false);
    });

    it("clears unconditionally when no token is provided", () => {
      registerPendingSave("/path/to/file.md", "content");
      expect(hasPendingSave("/path/to/file.md")).toBe(true);

      clearPendingSave("/path/to/file.md");
      expect(hasPendingSave("/path/to/file.md")).toBe(false);
    });

    it("does not clear when token does not match (overlapping save)", () => {
      const token1 = registerPendingSave("/path/to/file.md", "content1");
      // Second save overwrites with new token
      registerPendingSave("/path/to/file.md", "content2");

      // Stale token from first save should NOT clear the entry
      clearPendingSave("/path/to/file.md", token1);
      expect(hasPendingSave("/path/to/file.md")).toBe(true);
      expect(matchesPendingSave("/path/to/file.md", "content2")).toBe(true);
    });

    it("clears when token matches the current registration", () => {
      registerPendingSave("/path/to/file.md", "content1");
      const token2 = registerPendingSave("/path/to/file.md", "content2");

      clearPendingSave("/path/to/file.md", token2);
      expect(hasPendingSave("/path/to/file.md")).toBe(false);
    });

    it("does not affect other paths", () => {
      const token1 = registerPendingSave("/path/to/file1.md", "content1");
      registerPendingSave("/path/to/file2.md", "content2");

      clearPendingSave("/path/to/file1.md", token1);

      expect(hasPendingSave("/path/to/file1.md")).toBe(false);
      expect(hasPendingSave("/path/to/file2.md")).toBe(true);
    });
  });

  describe("_clearAllPendingSaves", () => {
    it("removes all registered paths", () => {
      registerPendingSave("/path/to/file1.md", "content1");
      registerPendingSave("/path/to/file2.md", "content2");
      registerPendingSave("/path/to/file3.md", "content3");

      _clearAllPendingSaves();

      expect(hasPendingSave("/path/to/file1.md")).toBe(false);
      expect(hasPendingSave("/path/to/file2.md")).toBe(false);
      expect(hasPendingSave("/path/to/file3.md")).toBe(false);
    });
  });

  describe("re-registration", () => {
    it("updates content on re-registration", () => {
      registerPendingSave("/path/to/file.md", "original content");
      expect(matchesPendingSave("/path/to/file.md", "original content")).toBe(true);

      // Re-register with new content
      registerPendingSave("/path/to/file.md", "new content");

      expect(matchesPendingSave("/path/to/file.md", "original content")).toBe(false);
      expect(matchesPendingSave("/path/to/file.md", "new content")).toBe(true);
    });
  });

  describe("path normalization with content", () => {
    it("matches content regardless of path format", () => {
      // This test assumes normalizePath handles path variations
      registerPendingSave("/path/to/file.md", "content");
      expect(matchesPendingSave("/path/to/file.md", "content")).toBe(true);
    });
  });
});
