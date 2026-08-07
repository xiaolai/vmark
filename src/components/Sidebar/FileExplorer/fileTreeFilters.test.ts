import { describe, it, expect } from "vitest";
import {
  shouldIncludeEntry,
  fileTreeDisplayName,
  type FileTreeFilterOptions,
} from "./fileTreeFilters";
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

// #1224 — `requirements.txt` displayed as `requirements` read as a broken
// listing rather than a formatting choice.
describe("fileTreeDisplayName", () => {
  const opts = { showExtensions: true, showAllFiles: false };

  it("shows the name on disk when extensions are shown", () => {
    expect(fileTreeDisplayName("requirements.txt", opts)).toBe("requirements.txt");
    expect(fileTreeDisplayName("README.md", opts)).toBe("README.md");
  });

  it("hides a supported extension when the user opts out", () => {
    expect(fileTreeDisplayName("README.md", { ...opts, showExtensions: false }))
      .toBe("README");
  });

  it("keeps a non-markdown name intact with all files shown, extensions hidden", () => {
    // Legacy behavior: with all files listed, only markdown loses its suffix —
    // a bare "data" next to "data.json" would be unreadable.
    expect(
      fileTreeDisplayName("data.json", { showExtensions: false, showAllFiles: true }),
    ).toBe("data.json");
    expect(
      fileTreeDisplayName("README.md", { showExtensions: false, showAllFiles: true }),
    ).toBe("README");
  });
});
