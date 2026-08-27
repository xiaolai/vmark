// @vitest-environment node
/**
 * Open routing policy — tests
 *
 * Covers `resolveOpenAction` (where a file opens: activate / new tab / replace
 * the clean untitled tab / new window) and `resolveWorkspaceRootForExternalFile`
 * (which folder an external file brings with it).
 *
 * Split out of `src/utils/openPolicy.test.ts`, which had grown past the
 * file-size gate. The split follows the SOURCE split — `openPolicy/openRouting.ts`
 * — so each policy's tests sit beside the module they exercise.
 */
import { describe, it, expect } from "vitest";
import {
  resolveOpenAction,
  resolveWorkspaceRootForExternalFile,
  type OpenActionContext,
} from "../openPolicy";

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

    // #1330 — this used to assert replace_tab, which was the defect: every
    // in-window action here carries the file's own folder as the new root, so
    // reusing the untitled tab of a WORKSPACE window replaced the sidebar tree
    // the user was looking at, leaving no tab to navigate back from. A lone
    // clean untitled tab describes the TABS; it says nothing about whether the
    // window owns a workspace, and right after File → Open Workspace it does.
    it("opens a new window rather than re-rooting a workspace window", () => {
      const context: OpenActionContext = {
        filePath: "/other/folder/file.md",
        workspaceRoot: "/workspace/project",
        isWorkspaceMode: true,
        existingTabId: null,
        replaceableTab: { tabId: "untitled-tab" },
      };

      const result = resolveOpenAction(context);

      expect(result).toEqual({
        action: "open_workspace_in_new_window",
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

    // #1330 — openInNewTab preserves the empty TAB; it never licensed
    // re-rooting the window. In a workspace window the new window does both.
    it("opens a new window for a file outside a workspace window", () => {
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
        action: "open_workspace_in_new_window",
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

  // #1331 — a window showing the WelcomeScreen has ZERO tabs, so there is no
  // replaceable tab and the routing fell through to "open a new window". Opening
  // a file from the Welcome screen spawned a second window and left the first one
  // empty. An empty window has nothing to preserve: it takes the file.
  describe("with an empty window (WelcomeScreen, no tabs)", () => {
    it("returns create_tab in this window instead of opening a new one", () => {
      const context: OpenActionContext = {
        filePath: "/some/folder/file.md",
        workspaceRoot: null,
        isWorkspaceMode: false,
        existingTabId: null,
        replaceableTab: null,
        windowIsEmpty: true,
      };

      expect(resolveOpenAction(context)).toEqual({
        action: "create_tab",
        filePath: "/some/folder/file.md",
        workspaceRoot: "/some/folder",
      });
    });

    it("still takes the file when openInNewTab is on — there is no tab to preserve", () => {
      const context: OpenActionContext = {
        filePath: "/some/folder/file.md",
        workspaceRoot: null,
        isWorkspaceMode: false,
        existingTabId: null,
        replaceableTab: null,
        openInNewTab: true,
        windowIsEmpty: true,
      };

      expect(resolveOpenAction(context)).toEqual({
        action: "create_tab",
        filePath: "/some/folder/file.md",
        workspaceRoot: "/some/folder",
      });
    });

    // Same ownership rule as the replaceable-tab branch (#1330): every in-window
    // action here carries the file's own folder as the new root, so reusing a
    // workspace window would replace the sidebar tree the user is looking at —
    // and on the WelcomeScreen that tree is the only thing left on screen.
    it("opens a new window rather than re-rooting an empty WORKSPACE window", () => {
      const context: OpenActionContext = {
        filePath: "/other/folder/file.md",
        workspaceRoot: "/workspace/project",
        isWorkspaceMode: true,
        existingTabId: null,
        replaceableTab: null,
        windowIsEmpty: true,
      };

      expect(resolveOpenAction(context)).toEqual({
        action: "open_workspace_in_new_window",
        filePath: "/other/folder/file.md",
        workspaceRoot: "/other/folder",
      });
    });

    it("keeps a file inside the open workspace as a plain new tab", () => {
      const context: OpenActionContext = {
        filePath: "/workspace/project/src/file.md",
        workspaceRoot: "/workspace/project",
        isWorkspaceMode: true,
        existingTabId: null,
        replaceableTab: null,
        windowIsEmpty: true,
      };

      expect(resolveOpenAction(context)).toEqual({
        action: "create_tab",
        filePath: "/workspace/project/src/file.md",
      });
    });

    it("activates the existing tab first — an empty window cannot have one, but the order is the contract", () => {
      const context: OpenActionContext = {
        filePath: "/some/folder/file.md",
        workspaceRoot: null,
        isWorkspaceMode: false,
        existingTabId: "existing-tab",
        replaceableTab: null,
        windowIsEmpty: true,
      };

      expect(resolveOpenAction(context)).toEqual({
        action: "activate_tab",
        tabId: "existing-tab",
      });
    });

    it("refuses an unresolvable root rather than opening an empty tab", () => {
      const context: OpenActionContext = {
        filePath: "file.md",
        workspaceRoot: null,
        isWorkspaceMode: false,
        existingTabId: null,
        replaceableTab: null,
        windowIsEmpty: true,
      };

      expect(resolveOpenAction(context)).toEqual({
        action: "no_op",
        reason: "cannot_resolve_workspace_root",
      });
    });

    // A window with tabs is NOT empty: the flag must not leak into the ordinary
    // path, where a dirty or titled tab still costs something to displace.
    it("leaves a window with tabs on the new-window path", () => {
      const context: OpenActionContext = {
        filePath: "/some/folder/file.md",
        workspaceRoot: null,
        isWorkspaceMode: false,
        existingTabId: null,
        replaceableTab: null,
        windowIsEmpty: false,
      };

      expect(resolveOpenAction(context)).toEqual({
        action: "open_workspace_in_new_window",
        filePath: "/some/folder/file.md",
        workspaceRoot: "/some/folder",
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
