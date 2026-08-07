import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRename = vi.fn();
const mockExists = vi.fn();
const mockStat = vi.fn();
const mockReconcile = vi.fn();
const mockApply = vi.fn();
const mockGetAllOpenFilePaths = vi.fn(() => ["/docs/note.md"]);

vi.mock("@tauri-apps/plugin-fs", () => ({
  rename: (...args: unknown[]) => mockRename(...args),
  exists: (...args: unknown[]) => mockExists(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

vi.mock("@tauri-apps/api/path", () => ({
  basename: (p: string) => Promise.resolve(p.split("/").pop() ?? ""),
  // Faithful to the real join: empty segments are dropped (join("", "x")
  // yields the RELATIVE "x") and duplicate separators collapse.
  join: (...parts: string[]) =>
    Promise.resolve(
      parts
        .filter((p) => p !== "")
        .join("/")
        .replace(/\/{2,}/g, "/"),
    ),
  dirname: (p: string) => {
    const i = p.lastIndexOf("/");
    return Promise.resolve(i <= 0 ? "/" : p.slice(0, i));
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: { getState: () => ({ getAllOpenFilePaths: mockGetAllOpenFilePaths }) },
}));

vi.mock("@/utils/pathReconciliation", () => ({
  reconcilePathChange: (...args: unknown[]) => mockReconcile(...args),
}));

vi.mock("./applyPathReconciliation", () => ({
  applyPathReconciliation: (...args: unknown[]) => mockApply(...args),
}));

import { renameFile } from "./renameFile";

beforeEach(() => {
  vi.clearAllMocks();
  mockExists.mockResolvedValue(false);
  mockStat.mockResolvedValue({ isDirectory: false });
  mockRename.mockResolvedValue(undefined);
  mockReconcile.mockReturnValue([{ action: "update_path", oldPath: "/docs/note.md", newPath: "/docs/renamed.md" }]);
});

describe("renameFile", () => {
  it("renames a file and reconciles open tabs", async () => {
    const result = await renameFile("/docs/note.md", "renamed.md");
    expect(result).toEqual({ status: "renamed", newPath: "/docs/renamed.md" });
    expect(mockRename).toHaveBeenCalledWith("/docs/note.md", "/docs/renamed.md");
    expect(mockReconcile).toHaveBeenCalledWith({
      changeType: "rename",
      oldPath: "/docs/note.md",
      newPath: "/docs/renamed.md",
      openFilePaths: ["/docs/note.md"],
    });
    expect(mockApply).toHaveBeenCalledOnce();
  });

  it("appends .md when renaming a file without an extension in the new name", async () => {
    const result = await renameFile("/docs/note.md", "renamed");
    expect(result).toEqual({ status: "renamed", newPath: "/docs/renamed.md" });
    expect(mockRename).toHaveBeenCalledWith("/docs/note.md", "/docs/renamed.md");
  });

  it("returns unchanged (no write) when the name is identical", async () => {
    const result = await renameFile("/docs/note.md", "note.md");
    expect(result).toEqual({ status: "unchanged", path: "/docs/note.md" });
    expect(mockRename).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("refuses to overwrite an existing target", async () => {
    mockExists.mockResolvedValue(true);
    const result = await renameFile("/docs/note.md", "taken.md");
    expect(result).toEqual({ status: "exists", name: "taken.md", isFile: true });
    expect(mockRename).not.toHaveBeenCalled();
  });

  it("returns error when the rename call throws", async () => {
    const boom = new Error("EACCES");
    mockRename.mockRejectedValue(boom);
    const result = await renameFile("/docs/note.md", "renamed.md");
    expect(result).toEqual({ status: "error", error: boom });
    expect(mockApply).not.toHaveBeenCalled();
  });
});

describe("renameFile — extension preservation", () => {
  it("preserves .txt when the new name omits an extension", async () => {
    const result = await renameFile("/docs/notes.txt", "notes2");
    expect(result).toEqual({ status: "renamed", newPath: "/docs/notes2.txt" });
    expect(mockRename).toHaveBeenCalledWith("/docs/notes.txt", "/docs/notes2.txt");
  });

  it("preserves .yaml when the new name omits an extension", async () => {
    const result = await renameFile("/docs/config.yaml", "config2");
    expect(result).toEqual({ status: "renamed", newPath: "/docs/config2.yaml" });
  });

  it("respects an explicitly typed extension over the original one", async () => {
    const result = await renameFile("/docs/notes.txt", "notes2.yaml");
    expect(result).toEqual({ status: "renamed", newPath: "/docs/notes2.yaml" });
    expect(mockRename).toHaveBeenCalledWith("/docs/notes.txt", "/docs/notes2.yaml");
  });

  it("returns unchanged when typing the extensionless name of a .md file", async () => {
    const result = await renameFile("/docs/foo.md", "foo");
    expect(result).toEqual({ status: "unchanged", path: "/docs/foo.md" });
    expect(mockRename).not.toHaveBeenCalled();
  });

  it("keeps extensionless files extensionless", async () => {
    const result = await renameFile("/docs/Makefile", "Makefile2");
    expect(result).toEqual({ status: "renamed", newPath: "/docs/Makefile2" });
  });

  it("treats dotfiles as having no extension (no suffix appended)", async () => {
    const result = await renameFile("/docs/.gitignore", ".npmignore");
    expect(result).toEqual({ status: "renamed", newPath: "/docs/.npmignore" });
  });

  // #1224 — re-attaching is right only when the editor HID the extension, so
  // the user was editing a stem. Once the editor shows `notes.md`, deleting
  // the suffix is a deliberate rename, and re-attaching silently discards it:
  // the file does not change and the UI reports success.
  describe("preserveExtension: false — the editor showed the full name", () => {
    it("drops the extension when the user deletes it", async () => {
      const result = await renameFile("/docs/foo.md", "foo", {
        preserveExtension: false,
      });
      expect(result).toEqual({ status: "renamed", newPath: "/docs/foo" });
      expect(mockRename).toHaveBeenCalledWith("/docs/foo.md", "/docs/foo");
    });

    it("still honours an explicitly typed extension", async () => {
      const result = await renameFile("/docs/notes.txt", "notes2.yaml", {
        preserveExtension: false,
      });
      expect(result).toEqual({ status: "renamed", newPath: "/docs/notes2.yaml" });
    });

    it("leaves folders alone — they never had an extension to preserve", async () => {
      mockStat.mockResolvedValue({ isDirectory: true });
      const result = await renameFile("/docs/v2.0-drafts", "v3.0-drafts", {
        preserveExtension: false,
      });
      expect(result).toEqual({ status: "renamed", newPath: "/docs/v3.0-drafts" });
    });
  });
});

describe("renameFile — root-level paths", () => {
  it("renames a file directly under the filesystem root (parent via dirname, not string slicing)", async () => {
    const result = await renameFile("/note.md", "renamed.md");
    expect(result).toEqual({ status: "renamed", newPath: "/renamed.md" });
    expect(mockRename).toHaveBeenCalledWith("/note.md", "/renamed.md");
  });
});

describe("renameFile — name validation", () => {
  it.each([
    ["an empty name", ""],
    ["a whitespace-only name", "   "],
    ["a forward slash", "notes/evil.md"],
    ["a backslash", "notes\\evil.md"],
    ["a NUL byte", "notes\0.md"],
    ["a bare dot", "."],
    ["a bare dot-dot", ".."],
    ["parent-directory traversal", "../evil"],
  ])("rejects %s without touching the filesystem", async (_label, name) => {
    const result = await renameFile("/docs/note.md", name);
    expect(result.status).toBe("error");
    expect(mockRename).not.toHaveBeenCalled();
    expect(mockExists).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("still renames normally after validation (control)", async () => {
    const result = await renameFile("/docs/note.md", "fine.md");
    expect(result).toEqual({ status: "renamed", newPath: "/docs/fine.md" });
  });
});

describe("renameFile — folder handling", () => {
  it("renames a folder whose name contains a dot without appending an extension", async () => {
    mockStat.mockResolvedValue({ isDirectory: true });
    const result = await renameFile("/ws/v2.0-drafts", "v3-drafts");
    expect(result).toEqual({ status: "renamed", newPath: "/ws/v3-drafts" });
    expect(mockRename).toHaveBeenCalledWith("/ws/v2.0-drafts", "/ws/v3-drafts");
  });

  it("honors an explicit isFolder flag without a filesystem stat", async () => {
    const result = await renameFile("/ws/v2.0-drafts", "v3-drafts", { isFolder: true });
    expect(result).toEqual({ status: "renamed", newPath: "/ws/v3-drafts" });
    expect(mockStat).not.toHaveBeenCalled();
  });

  it("honors an explicit isFolder:false flag without a filesystem stat", async () => {
    const result = await renameFile("/docs/notes.txt", "notes2", { isFolder: false });
    expect(result).toEqual({ status: "renamed", newPath: "/docs/notes2.txt" });
    expect(mockStat).not.toHaveBeenCalled();
  });

  it("reports an existing target with isFile:false for folders", async () => {
    mockExists.mockResolvedValue(true);
    const result = await renameFile("/ws/v2.0-drafts", "taken", { isFolder: true });
    expect(result).toEqual({ status: "exists", name: "taken", isFile: false });
    expect(mockRename).not.toHaveBeenCalled();
  });
});
