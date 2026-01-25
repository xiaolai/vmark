/**
 * Tests for default save folder resolution
 *
 * Tests the pure resolveDefaultSaveFolder function with three-tier precedence:
 * 1. Workspace root (if in workspace mode)
 * 2. Documents directory (when not in workspace mode)
 * 3. First saved tab's folder (edge case: workspace mode but no root)
 *
 * @module utils/defaultSaveFolder.test
 */
import { describe, it, expect } from "vitest";
import { resolveDefaultSaveFolder } from "./defaultSaveFolder";

describe("resolveDefaultSaveFolder", () => {
  const defaultInput = {
    isWorkspaceMode: false,
    workspaceRoot: null,
    savedFilePaths: [],
    fallbackDirectory: "/Users/test",
  };

  it("returns workspace root when in workspace mode", () => {
    const result = resolveDefaultSaveFolder({
      ...defaultInput,
      isWorkspaceMode: true,
      workspaceRoot: "/workspace/project",
    });

    expect(result).toBe("/workspace/project");
  });

  it("returns fallback directory when no workspace (ignores saved tabs)", () => {
    // When not in workspace mode, always use Documents directory
    // This prevents save dialogs opening in unexpected folders
    const result = resolveDefaultSaveFolder({
      ...defaultInput,
      savedFilePaths: ["/docs/notes/file.md", "/other/path/doc.md"],
    });

    expect(result).toBe("/Users/test");
  });

  it("uses saved tab folder only when in workspace mode but missing root", () => {
    // Edge case: in workspace mode but rootPath is null
    const result = resolveDefaultSaveFolder({
      isWorkspaceMode: true,
      workspaceRoot: null,
      savedFilePaths: ["/docs/notes/file.md"],
      fallbackDirectory: "/Users/test",
    });

    expect(result).toBe("/docs/notes");
  });

  it("returns home directory when no workspace and no saved tabs", () => {
    const result = resolveDefaultSaveFolder({
      ...defaultInput,
      savedFilePaths: [],
    });

    expect(result).toBe("/Users/test");
  });

  it("returns home directory for new window with empty saved paths", () => {
    const result = resolveDefaultSaveFolder({
      isWorkspaceMode: false,
      workspaceRoot: null,
      savedFilePaths: [],
      fallbackDirectory: "/Users/test",
    });

    expect(result).toBe("/Users/test");
  });

  it("prefers workspace root over saved tab folder", () => {
    const result = resolveDefaultSaveFolder({
      isWorkspaceMode: true,
      workspaceRoot: "/workspace/project",
      savedFilePaths: ["/other/path/file.md"],
      fallbackDirectory: "/Users/test",
    });

    // Workspace root takes precedence
    expect(result).toBe("/workspace/project");
  });

  it("handles Windows-style paths in workspace mode", () => {
    const result = resolveDefaultSaveFolder({
      isWorkspaceMode: true,
      workspaceRoot: null, // Edge case: in workspace mode but missing root
      savedFilePaths: ["C:\\Users\\Test\\Documents\\file.md"],
      fallbackDirectory: "C:\\Users\\Test",
    });

    expect(result).toBe("C:\\Users\\Test\\Documents");
  });

  it("ignores workspace root and saved tabs if not in workspace mode", () => {
    const result = resolveDefaultSaveFolder({
      isWorkspaceMode: false,
      workspaceRoot: "/workspace/project", // Set but not in workspace mode
      savedFilePaths: ["/other/path/file.md"],
      fallbackDirectory: "/Users/test",
    });

    // Should use home directory directly when not in workspace mode
    expect(result).toBe("/Users/test");
  });

  it("ignores null workspace root even in workspace mode", () => {
    const result = resolveDefaultSaveFolder({
      isWorkspaceMode: true,
      workspaceRoot: null, // Missing root
      savedFilePaths: ["/docs/file.md"],
      fallbackDirectory: "/Users/test",
    });

    // Should fall through to saved tab folder
    expect(result).toBe("/docs");
  });
});
