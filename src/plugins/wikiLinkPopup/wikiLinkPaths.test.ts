/**
 * Tests for wiki link path helpers (extracted from WikiLinkPopupView).
 */

import { describe, it, expect } from "vitest";
import { resolveWikiLinkPath, pathToWikiTarget } from "./wikiLinkPaths";

describe("resolveWikiLinkPath", () => {
  it.each([
    { target: "", root: "/ws", expected: null },
    { target: "note", root: null, expected: null },
    { target: "note", root: "/ws", expected: "/ws/note.md" },
    { target: "dir/note", root: "/ws", expected: "/ws/dir/note.md" },
    { target: "note.md", root: "/ws", expected: "/ws/note.md" },
    { target: "dir/note.md", root: "/ws", expected: "/ws/dir/note.md" },
  ])("target=$target root=$root → $expected", ({ target, root, expected }) => {
    expect(resolveWikiLinkPath(target, root)).toBe(expected);
  });
});

describe("pathToWikiTarget", () => {
  it.each([
    { path: "/x/file.md", root: null, expected: "/x/file.md" },
    { path: "/ws/file.md", root: "/ws", expected: "file" },
    { path: "/ws/dir/file.md", root: "/ws", expected: "dir/file" },
    { path: "/other/file.md", root: "/ws", expected: "/other/file" },
    { path: "/ws/image.png", root: "/ws", expected: "image.png" },
    // Sibling directories that share the root as a string prefix must NOT
    // be treated as inside the workspace (boundary-separator check).
    { path: "/workspace2/file.md", root: "/workspace", expected: "/workspace2/file" },
    { path: "/ws2/dir/file.md", root: "/ws", expected: "/ws2/dir/file" },
    // Trailing-slash workspace root still strips correctly.
    { path: "/ws/file.md", root: "/ws/", expected: "file" },
  ])("path=$path root=$root → $expected", ({ path, root, expected }) => {
    expect(pathToWikiTarget(path, root)).toBe(expected);
  });
});
