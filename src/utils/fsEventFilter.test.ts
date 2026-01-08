/**
 * Unit tests for file system event filtering
 *
 * Validates the logic for deciding whether to refresh the file tree
 * based on watcher events.
 */
import { describe, it, expect } from "vitest";
import { shouldRefreshTree, type FsEventInput } from "./fsEventFilter";

describe("fsEventFilter", () => {
  describe("shouldRefreshTree", () => {
    it("returns true when watchId matches and path is in root", () => {
      const event: FsEventInput = {
        watchId: "main",
        rootPath: "/Users/test",
        paths: ["/Users/test/docs/file.md"],
        kind: "modify",
      };
      expect(shouldRefreshTree(event, "main", "/Users/test")).toBe(true);
    });

    it("returns false when watchId does not match", () => {
      const event: FsEventInput = {
        watchId: "doc-123",
        rootPath: "/Users/other",
        paths: ["/Users/other/file.md"],
        kind: "modify",
      };
      expect(shouldRefreshTree(event, "main", "/Users/test")).toBe(false);
    });

    it("returns false when path is outside root", () => {
      const event: FsEventInput = {
        watchId: "main",
        rootPath: "/Users/test",
        paths: ["/Users/other/file.md"],
        kind: "modify",
      };
      expect(shouldRefreshTree(event, "main", "/Users/test")).toBe(false);
    });

    it("returns true when any path is within root", () => {
      const event: FsEventInput = {
        watchId: "main",
        rootPath: "/Users/test",
        paths: ["/Users/other/file.md", "/Users/test/docs/note.md"],
        kind: "create",
      };
      expect(shouldRefreshTree(event, "main", "/Users/test")).toBe(true);
    });

    it("returns false when rootPath is null", () => {
      const event: FsEventInput = {
        watchId: "main",
        rootPath: "/Users/test",
        paths: ["/Users/test/file.md"],
        kind: "modify",
      };
      expect(shouldRefreshTree(event, "main", null)).toBe(false);
    });

    it("returns false when paths array is empty", () => {
      const event: FsEventInput = {
        watchId: "main",
        rootPath: "/Users/test",
        paths: [],
        kind: "modify",
      };
      expect(shouldRefreshTree(event, "main", "/Users/test")).toBe(false);
    });

    it("handles create events", () => {
      const event: FsEventInput = {
        watchId: "main",
        rootPath: "/Users/test",
        paths: ["/Users/test/new-file.md"],
        kind: "create",
      };
      expect(shouldRefreshTree(event, "main", "/Users/test")).toBe(true);
    });

    it("handles remove events", () => {
      const event: FsEventInput = {
        watchId: "main",
        rootPath: "/Users/test",
        paths: ["/Users/test/deleted.md"],
        kind: "remove",
      };
      expect(shouldRefreshTree(event, "main", "/Users/test")).toBe(true);
    });
  });
});
