/**
 * Unit tests for file ownership logic
 *
 * Tests the decision logic for which window should handle
 * files opened from the OS.
 */
import { describe, it, expect } from "vitest";
import {
  shouldClaimFile,
  getClaimPriority,
  type FileOwnershipInput,
} from "./fileOwnership";

describe("fileOwnership", () => {
  describe("shouldClaimFile", () => {
    it("workspace window claims file within its root", () => {
      const input: FileOwnershipInput = {
        filePath: "/Users/test/project/docs/readme.md",
        isWorkspaceMode: true,
        workspaceRoot: "/Users/test/project",
      };
      const result = shouldClaimFile(input);
      expect(result.shouldClaim).toBe(true);
      if (result.shouldClaim) {
        expect(result.reason).toBe("within_workspace");
      }
    });

    it("workspace window rejects file outside its root", () => {
      const input: FileOwnershipInput = {
        filePath: "/Users/test/other/readme.md",
        isWorkspaceMode: true,
        workspaceRoot: "/Users/test/project",
      };
      const result = shouldClaimFile(input);
      expect(result.shouldClaim).toBe(false);
      if (!result.shouldClaim) {
        expect(result.reason).toBe("outside_workspace");
      }
    });

    it("non-workspace window claims as fallback", () => {
      const input: FileOwnershipInput = {
        filePath: "/Users/test/random/file.md",
        isWorkspaceMode: false,
        workspaceRoot: null,
      };
      const result = shouldClaimFile(input);
      expect(result.shouldClaim).toBe(true);
      if (result.shouldClaim) {
        expect(result.reason).toBe("no_workspace_fallback");
      }
    });

    it("rejects empty file path", () => {
      const input: FileOwnershipInput = {
        filePath: "",
        isWorkspaceMode: true,
        workspaceRoot: "/Users/test/project",
      };
      const result = shouldClaimFile(input);
      expect(result.shouldClaim).toBe(false);
      if (!result.shouldClaim) {
        expect(result.reason).toBe("invalid_input");
      }
    });

    it("rejects workspace mode with null root", () => {
      const input: FileOwnershipInput = {
        filePath: "/Users/test/file.md",
        isWorkspaceMode: true,
        workspaceRoot: null,
      };
      const result = shouldClaimFile(input);
      expect(result.shouldClaim).toBe(false);
      if (!result.shouldClaim) {
        expect(result.reason).toBe("invalid_input");
      }
    });

    it("handles exact root path match", () => {
      const input: FileOwnershipInput = {
        filePath: "/Users/test/project",
        isWorkspaceMode: true,
        workspaceRoot: "/Users/test/project",
      };
      const result = shouldClaimFile(input);
      expect(result.shouldClaim).toBe(true);
    });
  });

  describe("getClaimPriority", () => {
    it("returns depth for workspace matching file", () => {
      const input: FileOwnershipInput = {
        filePath: "/Users/test/project/docs/file.md",
        isWorkspaceMode: true,
        workspaceRoot: "/Users/test/project",
      };
      // /Users/test/project = 3 segments
      expect(getClaimPriority(input)).toBe(3);
    });

    it("returns -Infinity for workspace not matching file", () => {
      const input: FileOwnershipInput = {
        filePath: "/Users/test/other/file.md",
        isWorkspaceMode: true,
        workspaceRoot: "/Users/test/project",
      };
      expect(getClaimPriority(input)).toBe(-Infinity);
    });

    it("returns -1 for non-workspace fallback", () => {
      const input: FileOwnershipInput = {
        filePath: "/Users/test/file.md",
        isWorkspaceMode: false,
        workspaceRoot: null,
      };
      expect(getClaimPriority(input)).toBe(-1);
    });

    it("deeper workspace has higher priority", () => {
      const file = "/a/b/c/d/file.md";

      const shallow: FileOwnershipInput = {
        filePath: file,
        isWorkspaceMode: true,
        workspaceRoot: "/a/b",
      };

      const deep: FileOwnershipInput = {
        filePath: file,
        isWorkspaceMode: true,
        workspaceRoot: "/a/b/c",
      };

      expect(getClaimPriority(deep)).toBeGreaterThan(getClaimPriority(shallow));
    });

    it("returns -Infinity for empty file path", () => {
      const input: FileOwnershipInput = {
        filePath: "",
        isWorkspaceMode: true,
        workspaceRoot: "/Users/test/project",
      };
      expect(getClaimPriority(input)).toBe(-Infinity);
    });
  });
});
