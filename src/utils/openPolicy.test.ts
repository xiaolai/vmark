// @vitest-environment node
/**
 * Open Policy Helpers - Tests
 *
 * TDD tests for pure policy helpers that decide:
 * - Whether to block save for missing files
 * - How to handle external file changes
 * - Whether a post-save file adopts a workspace
 * - Which tab, if any, may be replaced in place
 *
 * Where a file OPENS lives in `openPolicy/openRouting.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  resolveMissingFileSaveAction,
  resolveExternalChangeAction,
  isQueuedConflictStillLive,
  resolvePostSaveWorkspaceAction,
  findReplaceableTab,
  type MissingFileSaveContext,
  type ExternalChangeContext,
  type PostSaveWorkspaceContext,
  type TabInfo,
} from "./openPolicy";

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

describe("isQueuedConflictStillLive", () => {
  const normalize = (path: string) => path.replace(/\\/g, "/");
  const live = {
    document: { filePath: "/ws/a.md", isDirty: true, isDivergent: false },
    queuedPath: "/ws/a.md",
    normalize,
  };

  it("resolves a conflict that is still real", () => {
    expect(isQueuedConflictStillLive(live)).toBe(true);
  });

  it("drops a conflict whose tab was closed", () => {
    expect(isQueuedConflictStillLive({ ...live, document: undefined })).toBe(false);
  });

  it("drops a conflict whose document was saved while it waited", () => {
    // Prompting here asks the user about a conflict that resolved itself.
    expect(isQueuedConflictStillLive({
      ...live,
      document: { ...live.document, isDirty: false },
    })).toBe(false);
  });

  it("keeps a DIVERGENT document, which is unsaved work with a clean flag", () => {
    // "Keep my changes" leaves content the user deliberately retained; the
    // dirty flag is clear but the work is not saved.
    expect(isQueuedConflictStillLive({
      ...live,
      document: { ...live.document, isDirty: false, isDivergent: true },
    })).toBe(true);
  });

  it("drops a conflict whose tab was renamed to another path", () => {
    // The dangerous one: the entry still names the OLD path, so resolving it
    // would pull a different file's bytes into this document.
    expect(isQueuedConflictStillLive({
      ...live,
      document: { ...live.document, filePath: "/ws/renamed.md" },
    })).toBe(false);
  });

  it("drops a conflict whose document lost its path entirely", () => {
    expect(isQueuedConflictStillLive({
      ...live,
      document: { ...live.document, filePath: null },
    })).toBe(false);
  });

  it("compares paths the way the watcher does", () => {
    // Windows separators must not read as a rename.
    expect(isQueuedConflictStillLive({
      document: { filePath: "C:\\ws\\a.md", isDirty: true, isDivergent: false },
      queuedPath: "C:/ws/a.md",
      normalize,
    })).toBe(true);
  });
});
