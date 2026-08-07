// @vitest-environment node
/**
 * Unit tests for path reconciliation logic
 *
 * Tests the pure decision logic for updating open tabs/documents
 * when files are renamed, moved, or deleted.
 */
import { describe, it, expect } from "vitest";
import {
  reconcilePathChange,
  type PathChangeInput,
} from "./pathReconciliation";

describe("pathReconciliation", () => {
  describe("reconcilePathChange - rename/move", () => {
    it("returns update_path for direct file match", () => {
      const input: PathChangeInput = {
        changeType: "rename",
        oldPath: "/Users/test/docs/file.md",
        newPath: "/Users/test/docs/renamed.md",
        openFilePaths: ["/Users/test/docs/file.md"],
      };
      const results = reconcilePathChange(input);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        action: "update_path",
        oldPath: "/Users/test/docs/file.md",
        newPath: "/Users/test/docs/renamed.md",
      });
    });

    it("updates all files within moved folder", () => {
      const input: PathChangeInput = {
        changeType: "move",
        oldPath: "/Users/test/docs",
        newPath: "/Users/test/archive",
        openFilePaths: [
          "/Users/test/docs/file1.md",
          "/Users/test/docs/sub/file2.md",
        ],
      };
      const results = reconcilePathChange(input);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        action: "update_path",
        oldPath: "/Users/test/docs/file1.md",
        newPath: "/Users/test/archive/file1.md",
      });
      expect(results[1]).toEqual({
        action: "update_path",
        oldPath: "/Users/test/docs/sub/file2.md",
        newPath: "/Users/test/archive/sub/file2.md",
      });
    });

    it("returns empty array when no open files match", () => {
      const input: PathChangeInput = {
        changeType: "rename",
        oldPath: "/Users/test/docs/other.md",
        newPath: "/Users/test/docs/renamed.md",
        openFilePaths: ["/Users/test/docs/file.md"],
      };
      const results = reconcilePathChange(input);
      expect(results).toHaveLength(0);
    });
  });

  describe("reconcilePathChange - delete", () => {
    it("returns mark_missing for deleted file", () => {
      const input: PathChangeInput = {
        changeType: "delete",
        oldPath: "/Users/test/docs/file.md",
        openFilePaths: ["/Users/test/docs/file.md"],
      };
      const results = reconcilePathChange(input);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        action: "mark_missing",
        oldPath: "/Users/test/docs/file.md",
      });
    });

    it("marks all files within deleted folder as missing", () => {
      const input: PathChangeInput = {
        changeType: "delete",
        oldPath: "/Users/test/docs",
        openFilePaths: [
          "/Users/test/docs/file1.md",
          "/Users/test/docs/sub/file2.md",
          "/Users/test/other/file3.md",
        ],
      };
      const results = reconcilePathChange(input);
      expect(results).toHaveLength(2);
      expect(results[0].action).toBe("mark_missing");
      expect(results[1].action).toBe("mark_missing");
    });
  });

  describe("edge cases", () => {
    it("handles empty open files array", () => {
      const input: PathChangeInput = {
        changeType: "rename",
        oldPath: "/Users/test/docs/file.md",
        newPath: "/Users/test/docs/renamed.md",
        openFilePaths: [],
      };
      const results = reconcilePathChange(input);
      expect(results).toHaveLength(0);
    });

    it("handles path with trailing slash", () => {
      const input: PathChangeInput = {
        changeType: "move",
        oldPath: "/Users/test/docs/",
        newPath: "/Users/test/archive/",
        openFilePaths: ["/Users/test/docs/file.md"],
      };
      const results = reconcilePathChange(input);
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("update_path");
    });

    it("does nothing for direct match rename without newPath", () => {
      const input: PathChangeInput = {
        changeType: "rename",
        oldPath: "/Users/test/docs/file.md",
        newPath: undefined,
        openFilePaths: ["/Users/test/docs/file.md"],
      };
      const results = reconcilePathChange(input);
      // Direct match with rename but no newPath — no action produced
      expect(results).toHaveLength(0);
    });

    it("does nothing for folder match rename without newPath", () => {
      const input: PathChangeInput = {
        changeType: "rename",
        oldPath: "/Users/test/docs",
        newPath: undefined,
        openFilePaths: ["/Users/test/docs/file.md"],
      };
      const results = reconcilePathChange(input);
      // Folder match with rename but no newPath — no action produced
      expect(results).toHaveLength(0);
    });

    it("does not match folder prefix with similar name prefix", () => {
      const input: PathChangeInput = {
        changeType: "delete",
        oldPath: "/Users/test/docs",
        openFilePaths: ["/Users/test/docsextra/file.md"],
      };
      const results = reconcilePathChange(input);
      // /Users/test/docsextra/ does not start with /Users/test/docs/
      expect(results).toHaveLength(0);
    });
  });
});
