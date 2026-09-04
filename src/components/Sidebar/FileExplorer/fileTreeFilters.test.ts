// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FILE_TREE_ALWAYS_SKIP, shouldIncludeEntry, type FileTreeFilterOptions } from "./fileTreeFilters";
import type { DirectoryEntry } from "./types";

const mdFilter = (name: string, isFolder: boolean) =>
  isFolder || name.endsWith(".md");

const baseOptions: FileTreeFilterOptions = {
  showHidden: false,
  showAllFiles: false,
  excludeFolders: [],
  filter: mdFilter,
};

describe("shouldIncludeEntry", () => {
  it("filters hidden entries when showHidden is false", () => {
    const entry: DirectoryEntry = {
      name: ".secret.md",
      path: "/root/.secret.md",
      isDirectory: false,
      isHidden: true,
    };
    expect(shouldIncludeEntry(entry, baseOptions)).toBe(false);
  });

  it("includes hidden entries when showHidden is true", () => {
    const entry: DirectoryEntry = {
      name: ".secret.md",
      path: "/root/.secret.md",
      isDirectory: false,
      isHidden: true,
    };
    expect(shouldIncludeEntry(entry, { ...baseOptions, showHidden: true })).toBe(true);
  });

  it("skips excluded folders even when showHidden is true", () => {
    const entry: DirectoryEntry = {
      name: ".git",
      path: "/root/.git",
      isDirectory: true,
      isHidden: true,
    };
    expect(
      shouldIncludeEntry(entry, { ...baseOptions, showHidden: true, excludeFolders: [".git"] })
    ).toBe(false);
  });

  it("skips non-markdown files", () => {
    const entry: DirectoryEntry = {
      name: "notes.txt",
      path: "/root/notes.txt",
      isDirectory: false,
      isHidden: false,
    };
    expect(shouldIncludeEntry(entry, baseOptions)).toBe(false);
  });

  it("includes non-markdown files when showAllFiles is true", () => {
    const entry: DirectoryEntry = {
      name: "image.png",
      path: "/root/image.png",
      isDirectory: false,
      isHidden: false,
    };
    expect(shouldIncludeEntry(entry, { ...baseOptions, showAllFiles: true })).toBe(true);
  });

  it("still excludes hidden entries when showAllFiles is true but showHidden is false", () => {
    const entry: DirectoryEntry = {
      name: ".env",
      path: "/root/.env",
      isDirectory: false,
      isHidden: true,
    };
    expect(shouldIncludeEntry(entry, { ...baseOptions, showAllFiles: true })).toBe(false);
  });

  it("still excludes excluded folders when showAllFiles is true", () => {
    const entry: DirectoryEntry = {
      name: "node_modules",
      path: "/root/node_modules",
      isDirectory: true,
      isHidden: false,
    };
    expect(
      shouldIncludeEntry(entry, { ...baseOptions, showAllFiles: true, excludeFolders: ["node_modules"] })
    ).toBe(false);
  });
});

describe("the always-skipped directories (#1357)", () => {
  it("are skipped whatever the workspace config says", () => {
    for (const name of ["node_modules", ".git", "target"]) {
      const entry: DirectoryEntry = { name, path: `/root/${name}`, isDirectory: true, isHidden: name.startsWith(".") };
      expect(shouldIncludeEntry(entry, { ...baseOptions, showHidden: true, showAllFiles: true })).toBe(false);
    }
    // A FILE by one of those names is not a directory and is not affected.
    const file: DirectoryEntry = { name: "dist", path: "/root/dist", isDirectory: false, isHidden: false };
    expect(shouldIncludeEntry(file, { ...baseOptions, showAllFiles: true })).toBe(true);
  });

  it("are the SAME names the workspace search skips (src-tauri content_search_match.rs ALWAYS_SKIP)", () => {
    const rust = readFileSync(new URL("../../../../src-tauri/src/content_search_match.rs", import.meta.url), "utf8");
    const block = /ALWAYS_SKIP: &\[&str\] = &\[([\s\S]*?)\];/.exec(rust);
    expect(block, "ALWAYS_SKIP must still be a literal slice").not.toBeNull();
    const rustNames = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect([...FILE_TREE_ALWAYS_SKIP].sort()).toEqual(rustNames);
  });
});
