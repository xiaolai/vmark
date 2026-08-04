/**
 * Audit 20260804-F9 — the fake disk must not accept impossible filesystem behavior.
 *
 * A fake that succeeds where the real thing fails is worse than no fake: the
 * tests it backs prove the code works against a filesystem that does not
 * exist. Two such holes:
 *
 *   - `remove()` deleted a NON-EMPTY directory and resolved. Real `rmdir`
 *     returns ENOTEMPTY (and Tauri's `remove` needs `{ recursive: true }`), so
 *     any caller relying on the fake's success would hit an error in
 *     production that no test could reproduce.
 *   - `rename()` moved a file into a directory that does not exist. Real
 *     `rename` returns ENOENT — and this fake already models exactly that for
 *     WRITES (`performWrite` rejects on a missing parent), so the two halves
 *     of the same fake disagreed about whether directories have to exist.
 *
 * These are contract tests for the harness itself: the assertions are what the
 * REAL `@tauri-apps/plugin-fs` does.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { FakeDisk } from "./fakeDisk";

let disk: FakeDisk;

beforeEach(() => {
  disk = new FakeDisk();
});

describe("remove()", () => {
  it("rejects removing a directory that still holds a file", async () => {
    disk.seed("/repo/notes.md", "# Notes");

    await expect(disk.remove("/repo")).rejects.toThrow(/not empty/i);
    // And it must not have half-removed anything.
    expect(disk.hasDir("/repo")).toBe(true);
    expect(disk.has("/repo/notes.md")).toBe(true);
  });

  it("rejects removing a directory that still holds a subdirectory", async () => {
    disk.mkdirp("/repo/nested/deep");

    await expect(disk.remove("/repo/nested")).rejects.toThrow(/not empty/i);
    expect(disk.hasDir("/repo/nested")).toBe(true);
  });

  it("removes an empty directory", async () => {
    disk.mkdirp("/repo/empty");

    await expect(disk.remove("/repo/empty")).resolves.toBeUndefined();
    expect(disk.hasDir("/repo/empty")).toBe(false);
    // Its parent is untouched.
    expect(disk.hasDir("/repo")).toBe(true);
  });

  it("removes a directory once its last child is gone", async () => {
    disk.seed("/repo/only.md", "x");

    await disk.remove("/repo/only.md");
    await expect(disk.remove("/repo")).resolves.toBeUndefined();
  });

  it("still removes files and still rejects missing paths", async () => {
    disk.seed("/repo/a.md", "x");

    await expect(disk.remove("/repo/a.md")).resolves.toBeUndefined();
    expect(disk.has("/repo/a.md")).toBe(false);
    await expect(disk.remove("/repo/ghost.md")).rejects.toThrow(/No such file/);
  });

  it("does not treat a sibling with a shared name prefix as a child", async () => {
    // `/repo/data` and `/repo/database` — a naive `startsWith` says the first
    // is non-empty because of the second.
    disk.mkdirp("/repo/data");
    disk.seed("/repo/database/x.md", "x");

    await expect(disk.remove("/repo/data")).resolves.toBeUndefined();
  });
});

describe("rename()", () => {
  it("rejects a rename into a directory that does not exist", async () => {
    disk.seed("/repo/a.md", "x");

    await expect(disk.rename("/repo/a.md", "/repo/missing/a.md")).rejects.toThrow(
      /No such file or directory/,
    );
    // The source survives: a failed rename moves nothing.
    expect(disk.read("/repo/a.md")).toBe("x");
    expect(disk.has("/repo/missing/a.md")).toBe(false);
  });

  it("renames within an existing directory", async () => {
    disk.seed("/repo/a.md", "x");

    await expect(disk.rename("/repo/a.md", "/repo/b.md")).resolves.toBeUndefined();
    expect(disk.has("/repo/a.md")).toBe(false);
    expect(disk.read("/repo/b.md")).toBe("x");
  });

  it("renames across directories when the target parent exists", async () => {
    disk.seed("/repo/a.md", "x");
    disk.mkdirp("/repo/archive");

    await expect(disk.rename("/repo/a.md", "/repo/archive/a.md")).resolves.toBeUndefined();
    expect(disk.read("/repo/archive/a.md")).toBe("x");
  });

  it("preserves mtime across a rename", async () => {
    disk.seed("/repo/a.md", "x", { mtimeMs: 123 });

    await disk.rename("/repo/a.md", "/repo/b.md");

    expect(disk.mtimeOf("/repo/b.md")).toBe(123);
  });

  it("still rejects renaming a file that does not exist", async () => {
    await expect(disk.rename("/repo/ghost.md", "/repo/x.md")).rejects.toThrow(
      /No such file or directory/,
    );
  });

  it("accepts a rename into the root directory", async () => {
    disk.seed("/a.md", "x");

    await expect(disk.rename("/a.md", "/b.md")).resolves.toBeUndefined();
    expect(disk.read("/b.md")).toBe("x");
  });
});
