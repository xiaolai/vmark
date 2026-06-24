import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceInstance,
  createWorkspaceRootIdentity,
  disambiguateWorkspaceDisplayNames,
  generateUUID,
  normalizeWorkspacePathForIdentity,
} from "../workspaceIdentity";

describe("workspace identity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a POSIX root identity with a display name", () => {
    const result = createWorkspaceRootIdentity("/Users/xiaolai/Projects/VMark", {
      platform: "macos",
    });

    expect(result).toEqual({
      ok: true,
      root: {
        rootId: "path:macos:/Users/xiaolai/Projects/VMark",
        rootPath: "/Users/xiaolai/Projects/VMark",
        displayName: "VMark",
        platformIdentity: "/Users/xiaolai/Projects/VMark",
        canonicalization: "fallback",
      },
    });
  });

  it("uses a canonical path for identity while preserving the requested path", () => {
    const result = createWorkspaceRootIdentity("/repo-link/vmark", {
      canonicalPath: "/Volumes/Data/vmark",
      platform: "macos",
    });

    expect(result.ok && result.root.rootPath).toBe("/repo-link/vmark");
    expect(result.ok && result.root.rootId).toBe("path:macos:/Volumes/Data/vmark");
    expect(result.ok && result.root.canonicalization).toBe("canonical");
  });

  it("returns a typed error for empty root paths", () => {
    expect(createWorkspaceRootIdentity("   ", { platform: "macos" })).toEqual({
      ok: false,
      error: "emptyRootPath",
    });
  });

  it("preserves CJK and RTL display names", () => {
    expect(
      createWorkspaceRootIdentity("/Users/xiaolai/项目/שלום", { platform: "macos" })
    ).toMatchObject({
      ok: true,
      root: { displayName: "שלום" },
    });
  });

  it("normalizes Windows drive and case identity", () => {
    const normalized = normalizeWorkspacePathForIdentity("c:/Users/XiaoLai/Repo/", "windows");
    expect(normalized).toEqual({
      normalizedPath: "C:\\Users\\XiaoLai\\Repo",
      platformIdentity: "c:\\users\\xiaolai\\repo",
    });
  });

  it("normalizes Windows UNC roots without losing the leading server marker", () => {
    expect(normalizeWorkspacePathForIdentity("//Server/Share//Repo/", "windows")).toEqual({
      normalizedPath: "\\\\Server\\Share\\Repo",
      platformIdentity: "\\\\server\\share\\repo",
    });
  });

  it("keeps Windows drive roots as displayable roots", () => {
    expect(normalizeWorkspacePathForIdentity("c:", "windows")).toEqual({
      normalizedPath: "C:\\",
      platformIdentity: "c:\\",
    });
    expect(normalizeWorkspacePathForIdentity("D:\\", "windows")).toEqual({
      normalizedPath: "D:\\",
      platformIdentity: "d:\\",
    });

    expect(createWorkspaceRootIdentity("c:/", { platform: "windows" })).toMatchObject({
      ok: true,
      root: { rootPath: "C:\\", displayName: "C:\\" },
    });
  });

  it("derives Windows display names from non-root paths", () => {
    expect(createWorkspaceRootIdentity("c:/Users/xiaolai/Repo", { platform: "windows" }))
      .toMatchObject({
        ok: true,
        root: { rootPath: "C:\\Users\\xiaolai\\Repo", displayName: "Repo" },
      });
  });

  it("keeps the POSIX root as its own display name", () => {
    expect(createWorkspaceRootIdentity("/", { platform: "macos" })).toMatchObject({
      ok: true,
      root: { rootPath: "/", displayName: "/" },
    });
  });

  it("keeps POSIX identity case-sensitive", () => {
    expect(normalizeWorkspacePathForIdentity("/Users/Me/Repo", "macos")).toEqual({
      normalizedPath: "/Users/Me/Repo",
      platformIdentity: "/Users/Me/Repo",
    });
  });

  it("falls back to manual UUID generation when web crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);

    expect(generateUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("disambiguates duplicate root display names deterministically", () => {
    const names = disambiguateWorkspaceDisplayNames([
      { workspaceInstanceId: "wsi-a", rootId: "path:macos:/repo", displayName: "Repo" },
      { workspaceInstanceId: "wsi-b", rootId: "path:macos:/repo", displayName: "Repo" },
      { workspaceInstanceId: "wsi-c", rootId: "path:macos:/other/repo", displayName: "Repo" },
    ]);

    expect(names).toEqual({
      "wsi-a": "Repo",
      "wsi-b": "Repo 2",
      "wsi-c": "Repo 3",
    });
  });

  it("creates an instance without coupling identity to window labels", () => {
    const rootResult = createWorkspaceRootIdentity("/Users/xiaolai/VMark", {
      platform: "macos",
    });
    if (!rootResult.ok) throw new Error("expected root");

    expect(
      createWorkspaceInstance({
        workspaceInstanceId: "wsi-test",
        root: rootResult.root,
        ownerWindowLabel: "main",
        createdFrom: "open",
      })
    ).toMatchObject({
      workspaceInstanceId: "wsi-test",
      kind: "workspace",
      rootId: "path:macos:/Users/xiaolai/VMark",
      ownerWindowLabel: "main",
      createdFrom: "open",
      tabIds: [],
      closedTabIds: [],
      activeTabId: null,
    });
  });

  it("creates explicit loose and placeholder rootless instances", () => {
    expect(
      createWorkspaceInstance({
        workspaceInstanceId: "wsi-loose",
        root: null,
        ownerWindowLabel: "main",
        createdFrom: "open",
        kind: "loose",
      })
    ).toMatchObject({
      kind: "loose",
      rootId: null,
      rootPath: null,
      displayName: "Loose Files",
    });

    expect(
      createWorkspaceInstance({
        workspaceInstanceId: "wsi-placeholder",
        root: null,
        ownerWindowLabel: "main",
        createdFrom: "placeholder",
      })
    ).toMatchObject({
      kind: "placeholder",
      rootId: null,
      rootPath: null,
      displayName: "Untitled",
    });
  });
});
