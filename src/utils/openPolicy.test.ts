/**
 * Open Policy Helpers - Tests
 *
 * TDD tests for pure policy helpers that decide:
 * - Where to open a file (new tab, activate existing, new window)
 * - What folder to use for external file opens
 * - Whether to block save for missing files
 * - How to handle external file changes
 */
import { describe, it, expect } from "vitest";
import {
  resolveOpenAction,
  resolveWorkspaceRootForExternalFile,
  resolveMissingFileSaveAction,
  resolveExternalChangeAction,
  type OpenActionContext,
  type MissingFileSaveContext,
  type ExternalChangeContext,
} from "./openPolicy";

describe("resolveOpenAction", () => {
  describe("when in workspace mode", () => {
    it("returns create_tab for file within workspace", () => {
      const context: OpenActionContext = {
        filePath: "/workspace/project/src/file.md",
        workspaceRoot: "/workspace/project",
        isWorkspaceMode: true,
        existingTabId: null,
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "create_tab",
        filePath: "/workspace/project/src/file.md",
      });
    });

    it("returns activate_tab when file has existing tab", () => {
      const context: OpenActionContext = {
        filePath: "/workspace/project/src/file.md",
        workspaceRoot: "/workspace/project",
        isWorkspaceMode: true,
        existingTabId: "tab-123",
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "activate_tab",
        tabId: "tab-123",
      });
    });

    it("returns open_workspace_in_new_window for file outside workspace", () => {
      const context: OpenActionContext = {
        filePath: "/other/folder/file.md",
        workspaceRoot: "/workspace/project",
        isWorkspaceMode: true,
        existingTabId: null,
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "open_workspace_in_new_window",
        filePath: "/other/folder/file.md",
        workspaceRoot: "/other/folder",
      });
    });

    it("returns no_op for empty file path", () => {
      const context: OpenActionContext = {
        filePath: "",
        workspaceRoot: "/workspace/project",
        isWorkspaceMode: true,
        existingTabId: null,
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "no_op",
        reason: "empty_path",
      });
    });
  });

  describe("when not in workspace mode", () => {
    it("returns open_workspace_in_new_window for any file", () => {
      const context: OpenActionContext = {
        filePath: "/some/folder/file.md",
        workspaceRoot: null,
        isWorkspaceMode: false,
        existingTabId: null,
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "open_workspace_in_new_window",
        filePath: "/some/folder/file.md",
        workspaceRoot: "/some/folder",
      });
    });

    it("activates existing tab if file already open", () => {
      const context: OpenActionContext = {
        filePath: "/some/folder/file.md",
        workspaceRoot: null,
        isWorkspaceMode: false,
        existingTabId: "tab-456",
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "activate_tab",
        tabId: "tab-456",
      });
    });
  });

  describe("edge cases", () => {
    it("handles Windows-style paths", () => {
      const context: OpenActionContext = {
        filePath: "C:\\Users\\test\\project\\file.md",
        workspaceRoot: "C:\\Users\\test\\project",
        isWorkspaceMode: true,
        existingTabId: null,
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "create_tab",
        filePath: "C:\\Users\\test\\project\\file.md",
      });
    });

    it("handles file at root of workspace", () => {
      const context: OpenActionContext = {
        filePath: "/workspace/project/README.md",
        workspaceRoot: "/workspace/project",
        isWorkspaceMode: true,
        existingTabId: null,
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "create_tab",
        filePath: "/workspace/project/README.md",
      });
    });
  });
});

describe("resolveWorkspaceRootForExternalFile", () => {
  it("returns parent folder for a file path", () => {
    const result = resolveWorkspaceRootForExternalFile("/Users/test/project/file.md");
    expect(result).toBe("/Users/test/project");
  });

  it("returns null for empty path", () => {
    const result = resolveWorkspaceRootForExternalFile("");
    expect(result).toBeNull();
  });

  it("returns null for root-level file", () => {
    const result = resolveWorkspaceRootForExternalFile("/file.md");
    expect(result).toBeNull();
  });

  it("handles Windows-style paths", () => {
    const result = resolveWorkspaceRootForExternalFile("C:\\Users\\test\\file.md");
    expect(result).toBe("C:/Users/test");
  });

  it("handles trailing slashes", () => {
    const result = resolveWorkspaceRootForExternalFile("/Users/test/project/file.md/");
    expect(result).toBe("/Users/test/project");
  });

  it("handles deeply nested paths", () => {
    const result = resolveWorkspaceRootForExternalFile("/a/b/c/d/e/file.md");
    expect(result).toBe("/a/b/c/d/e");
  });
});

describe("resolveMissingFileSaveAction", () => {
  it("returns save_as_required when file is missing and has path", () => {
    const context: MissingFileSaveContext = {
      isMissing: true,
      hasPath: true,
    };

    const result = resolveMissingFileSaveAction(context);

    expect(result).toBe("save_as_required");
  });

  it("returns allow_save when file is not missing", () => {
    const context: MissingFileSaveContext = {
      isMissing: false,
      hasPath: true,
    };

    const result = resolveMissingFileSaveAction(context);

    expect(result).toBe("allow_save");
  });

  it("returns allow_save for new file without path", () => {
    const context: MissingFileSaveContext = {
      isMissing: false,
      hasPath: false,
    };

    const result = resolveMissingFileSaveAction(context);

    expect(result).toBe("allow_save");
  });

  it("returns allow_save for missing file without path (edge case)", () => {
    // This is a theoretical edge case - isMissing implies the file was saved before
    const context: MissingFileSaveContext = {
      isMissing: true,
      hasPath: false,
    };

    const result = resolveMissingFileSaveAction(context);

    // No path means Save As is the only option anyway
    expect(result).toBe("allow_save");
  });
});

describe("resolveExternalChangeAction", () => {
  it("returns auto_reload when document is clean", () => {
    const context: ExternalChangeContext = {
      isDirty: false,
      hasFilePath: true,
    };

    const result = resolveExternalChangeAction(context);

    expect(result).toBe("auto_reload");
  });

  it("returns prompt_user when document is dirty", () => {
    const context: ExternalChangeContext = {
      isDirty: true,
      hasFilePath: true,
    };

    const result = resolveExternalChangeAction(context);

    expect(result).toBe("prompt_user");
  });

  it("returns no_op when document has no file path", () => {
    const context: ExternalChangeContext = {
      isDirty: false,
      hasFilePath: false,
    };

    const result = resolveExternalChangeAction(context);

    expect(result).toBe("no_op");
  });

  it("returns no_op for dirty unsaved document", () => {
    const context: ExternalChangeContext = {
      isDirty: true,
      hasFilePath: false,
    };

    const result = resolveExternalChangeAction(context);

    expect(result).toBe("no_op");
  });
});
