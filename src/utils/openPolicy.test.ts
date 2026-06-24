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
  resolvePostSaveWorkspaceAction,
  findReplaceableTab,
  type OpenActionContext,
  type MissingFileSaveContext,
  type ExternalChangeContext,
  type PostSaveWorkspaceContext,
  type TabInfo,
} from "./openPolicy";

describe("resolveOpenAction", () => {
  describe("when in workspace mode", () => {
    it("returns create_tab for file within workspace", () => {
      const context: OpenActionContext = {
        filePath: "/workspace/project/src/file.md",
        workspaceRoot: "/workspace/project",
        isWorkspaceMode: true,
        existingTabId: null,
        replaceableTab: null,
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
        replaceableTab: null,
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
        replaceableTab: null,
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
        replaceableTab: null,
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "no_op",
        reason: "empty_path",
      });
    });
  });

  describe("when not in workspace mode", () => {
    it("opens a root-level file in a new window rooted at the POSIX root", () => {
      // /file.md is a valid path; its containing folder is "/" — it must open,
      // not silently no_op (regression guard for the root-level drop bug).
      const context: OpenActionContext = {
        filePath: "/file.md",
        workspaceRoot: null,
        isWorkspaceMode: false,
        existingTabId: null,
        replaceableTab: null,
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "open_workspace_in_new_window",
        filePath: "/file.md",
        workspaceRoot: "/",
      });
    });

    it("returns open_workspace_in_new_window for any file without replaceable tab", () => {
      const context: OpenActionContext = {
        filePath: "/some/folder/file.md",
        workspaceRoot: null,
        isWorkspaceMode: false,
        existingTabId: null,
        replaceableTab: null,
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
        replaceableTab: null,
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "activate_tab",
        tabId: "tab-456",
      });
    });
  });

  describe("with replaceable tab (clean untitled)", () => {
    it("returns replace_tab when not in workspace mode and replaceable tab exists", () => {
      const context: OpenActionContext = {
        filePath: "/some/folder/file.md",
        workspaceRoot: null,
        isWorkspaceMode: false,
        existingTabId: null,
        replaceableTab: { tabId: "untitled-tab" },
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "replace_tab",
        tabId: "untitled-tab",
        filePath: "/some/folder/file.md",
        workspaceRoot: "/some/folder",
      });
    });

    it("returns replace_tab when file is outside workspace and replaceable tab exists", () => {
      const context: OpenActionContext = {
        filePath: "/other/folder/file.md",
        workspaceRoot: "/workspace/project",
        isWorkspaceMode: true,
        existingTabId: null,
        replaceableTab: { tabId: "untitled-tab" },
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "replace_tab",
        tabId: "untitled-tab",
        filePath: "/other/folder/file.md",
        workspaceRoot: "/other/folder",
      });
    });

    it("still returns create_tab for file within workspace even with replaceable tab", () => {
      const context: OpenActionContext = {
        filePath: "/workspace/project/src/file.md",
        workspaceRoot: "/workspace/project",
        isWorkspaceMode: true,
        existingTabId: null,
        replaceableTab: { tabId: "untitled-tab" },
      };

      const result = resolveOpenAction(context);

      // Within workspace, create a new tab (don't replace)
      expect(result).toEqual({
        action: "create_tab",
        filePath: "/workspace/project/src/file.md",
      });
    });

    it("still returns activate_tab when file already open even with replaceable tab", () => {
      const context: OpenActionContext = {
        filePath: "/some/folder/file.md",
        workspaceRoot: null,
        isWorkspaceMode: false,
        existingTabId: "existing-tab",
        replaceableTab: { tabId: "untitled-tab" },
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "activate_tab",
        tabId: "existing-tab",
      });
    });
  });

  // fix(#946) — openInNewTab opt-in: open existing files in a new tab instead
  // of replacing the clean untitled tab.
  describe("with openInNewTab enabled", () => {
    it("returns create_tab (with resolved workspaceRoot) instead of replace_tab when a replaceable tab exists", () => {
      const context: OpenActionContext = {
        filePath: "/some/folder/file.md",
        workspaceRoot: null,
        isWorkspaceMode: false,
        existingTabId: null,
        replaceableTab: { tabId: "untitled-tab" },
        openInNewTab: true,
      };

      const result = resolveOpenAction(context);

      // The external file's own folder must travel with the action so the caller
      // can apply workspace ownership instead of attaching it to the wrong root.
      expect(result).toEqual({
        action: "create_tab",
        filePath: "/some/folder/file.md",
        workspaceRoot: "/some/folder",
      });
    });

    it("returns create_tab (with resolved workspaceRoot) for file outside workspace when a replaceable tab exists", () => {
      const context: OpenActionContext = {
        filePath: "/other/folder/file.md",
        workspaceRoot: "/workspace/project",
        isWorkspaceMode: true,
        existingTabId: null,
        replaceableTab: { tabId: "untitled-tab" },
        openInNewTab: true,
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "create_tab",
        filePath: "/other/folder/file.md",
        workspaceRoot: "/other/folder",
      });
    });

    it("still activates an existing tab even with openInNewTab", () => {
      const context: OpenActionContext = {
        filePath: "/some/folder/file.md",
        workspaceRoot: null,
        isWorkspaceMode: false,
        existingTabId: "existing-tab",
        replaceableTab: { tabId: "untitled-tab" },
        openInNewTab: true,
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "activate_tab",
        tabId: "existing-tab",
      });
    });

    it("opens a new window when no replaceable tab exists and not in workspace", () => {
      const context: OpenActionContext = {
        filePath: "/some/folder/file.md",
        workspaceRoot: null,
        isWorkspaceMode: false,
        existingTabId: null,
        replaceableTab: null,
        openInNewTab: true,
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "open_workspace_in_new_window",
        filePath: "/some/folder/file.md",
        workspaceRoot: "/some/folder",
      });
    });

    it("defaults to current behavior (replace_tab) when openInNewTab is omitted", () => {
      const context: OpenActionContext = {
        filePath: "/some/folder/file.md",
        workspaceRoot: null,
        isWorkspaceMode: false,
        existingTabId: null,
        replaceableTab: { tabId: "untitled-tab" },
      };

      const result = resolveOpenAction(context);

      expect(result.action).toBe("replace_tab");
    });
  });

  describe("edge cases", () => {
    it("handles Windows-style paths", () => {
      const context: OpenActionContext = {
        filePath: "C:\\Users\\test\\project\\file.md",
        workspaceRoot: "C:\\Users\\test\\project",
        isWorkspaceMode: true,
        existingTabId: null,
        replaceableTab: null,
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
        replaceableTab: null,
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

  it("returns the POSIX root for a root-level file", () => {
    // "/file.md" is a valid path; its containing folder is "/", not null.
    const result = resolveWorkspaceRootForExternalFile("/file.md");
    expect(result).toBe("/");
  });

  it("handles Windows-style paths", () => {
    const result = resolveWorkspaceRootForExternalFile("C:\\Users\\test\\file.md");
    expect(result).toBe("c:/Users/test");
  });

  it("returns null for Windows root-level file", () => {
    const result = resolveWorkspaceRootForExternalFile("C:\\file.md");
    expect(result).toBeNull();
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

describe("resolvePostSaveWorkspaceAction", () => {
  describe("when not in workspace mode", () => {
    it("returns open_workspace when previously untitled file is saved", () => {
      const context: PostSaveWorkspaceContext = {
        isWorkspaceMode: false,
        hadPathBeforeSave: false,
        savedFilePath: "/Users/test/project/file.md",
      };

      const result = resolvePostSaveWorkspaceAction(context);

      expect(result).toEqual({
        action: "open_workspace",
        workspaceRoot: "/Users/test/project",
      });
    });

    it("returns no_op when file was already saved (has path)", () => {
      const context: PostSaveWorkspaceContext = {
        isWorkspaceMode: false,
        hadPathBeforeSave: true,
        savedFilePath: "/Users/test/project/file.md",
      };

      const result = resolvePostSaveWorkspaceAction(context);

      expect(result).toEqual({ action: "no_op" });
    });

    it("returns no_op for empty saved path", () => {
      const context: PostSaveWorkspaceContext = {
        isWorkspaceMode: false,
        hadPathBeforeSave: false,
        savedFilePath: "",
      };

      const result = resolvePostSaveWorkspaceAction(context);

      expect(result).toEqual({ action: "no_op" });
    });
  });

  describe("when in workspace mode", () => {
    it("returns no_op regardless of path state", () => {
      const context: PostSaveWorkspaceContext = {
        isWorkspaceMode: true,
        hadPathBeforeSave: false,
        savedFilePath: "/workspace/project/file.md",
      };

      const result = resolvePostSaveWorkspaceAction(context);

      expect(result).toEqual({ action: "no_op" });
    });
  });

  describe("edge cases", () => {
    it("handles Windows paths", () => {
      const context: PostSaveWorkspaceContext = {
        isWorkspaceMode: false,
        hadPathBeforeSave: false,
        savedFilePath: "C:\\Users\\test\\project\\file.md",
      };

      const result = resolvePostSaveWorkspaceAction(context);

      expect(result).toEqual({
        action: "open_workspace",
        workspaceRoot: "c:/Users/test/project",
      });
    });

    it("opens the POSIX root as a workspace for a root-level saved file", () => {
      const context: PostSaveWorkspaceContext = {
        isWorkspaceMode: false,
        hadPathBeforeSave: false,
        savedFilePath: "/file.md",
      };

      const result = resolvePostSaveWorkspaceAction(context);

      expect(result).toEqual({ action: "open_workspace", workspaceRoot: "/" });
    });
  });
});

describe("findReplaceableTab", () => {
  it("returns tabId for single clean untitled tab", () => {
    const tabs: TabInfo[] = [{ id: "tab-1", filePath: null, isDirty: false }];

    const result = findReplaceableTab(tabs);

    expect(result).toEqual({ tabId: "tab-1" });
  });

  it("returns null for multiple tabs", () => {
    const tabs: TabInfo[] = [
      { id: "tab-1", filePath: null, isDirty: false },
      { id: "tab-2", filePath: "/file.md", isDirty: false },
    ];

    const result = findReplaceableTab(tabs);

    expect(result).toBeNull();
  });

  it("returns null for empty tabs list", () => {
    const tabs: TabInfo[] = [];

    const result = findReplaceableTab(tabs);

    expect(result).toBeNull();
  });

  it("returns null for single tab with file path", () => {
    const tabs: TabInfo[] = [{ id: "tab-1", filePath: "/file.md", isDirty: false }];

    const result = findReplaceableTab(tabs);

    expect(result).toBeNull();
  });

  it("returns null for single dirty untitled tab", () => {
    const tabs: TabInfo[] = [{ id: "tab-1", filePath: null, isDirty: true }];

    const result = findReplaceableTab(tabs);

    expect(result).toBeNull();
  });

  it("returns null for single dirty tab with file path", () => {
    const tabs: TabInfo[] = [{ id: "tab-1", filePath: "/file.md", isDirty: true }];

    const result = findReplaceableTab(tabs);

    expect(result).toBeNull();
  });
});
