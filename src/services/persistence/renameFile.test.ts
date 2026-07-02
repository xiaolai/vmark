import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRename = vi.fn();
const mockExists = vi.fn();
const mockReconcile = vi.fn();
const mockApply = vi.fn();
const mockGetAllOpenFilePaths = vi.fn(() => ["/docs/note.md"]);

vi.mock("@tauri-apps/plugin-fs", () => ({
  rename: (...args: unknown[]) => mockRename(...args),
  exists: (...args: unknown[]) => mockExists(...args),
}));

vi.mock("@tauri-apps/api/path", () => ({
  basename: (p: string) => Promise.resolve(p.split("/").pop() ?? ""),
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
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
