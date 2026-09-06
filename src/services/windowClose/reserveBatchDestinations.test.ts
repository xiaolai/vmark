// @vitest-environment node
//
// Audit 20260906 F1 — batch Save All silently replaced existing closed files.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { candidateName, reserveBatchDestinations } from "./reserveBatchDestinations";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

/** A fake exclusive-create backed by a set of paths already "on disk". */
function fsWith(existing: string[]) {
  const disk = new Set(existing);
  return (cmd: string, args: { path: string }) => {
    if (cmd !== "create_file_exclusive") throw new Error(`unexpected ${cmd}`);
    if (disk.has(args.path)) return Promise.resolve(false);
    disk.add(args.path);
    return Promise.resolve(true);
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("candidateName", () => {
  it("returns the name unchanged for the first candidate", () => {
    expect(candidateName("Untitled-1.md", 0)).toBe("Untitled-1.md");
  });

  it("puts the suffix before the extension", () => {
    expect(candidateName("Untitled-1.md", 1)).toBe("Untitled-1 2.md");
    expect(candidateName("Untitled-1.md", 2)).toBe("Untitled-1 3.md");
  });

  it("appends to a name with no extension", () => {
    expect(candidateName("notes", 1)).toBe("notes 2");
  });

  it("treats a leading dot as part of the name, not an extension", () => {
    expect(candidateName(".gitignore", 1)).toBe(".gitignore 2");
  });

  it("suffixes only the last extension segment", () => {
    expect(candidateName("archive.tar.gz", 1)).toBe("archive.tar 2.gz");
  });
});

describe("reserveBatchDestinations", () => {
  it("uses the plain name when the folder is empty", async () => {
    mockInvoke.mockImplementation(fsWith([]));

    const paths = await reserveBatchDestinations("/docs", ["Untitled-1.md"]);

    expect(paths).toEqual(["/docs/Untitled-1.md"]);
  });

  // The reported defect: a file the user never opened is replaced outright.
  it("never returns a path that already exists on disk", async () => {
    mockInvoke.mockImplementation(fsWith(["/docs/Untitled-1.md"]));

    const paths = await reserveBatchDestinations("/docs", ["Untitled-1.md"]);

    expect(paths).toEqual(["/docs/Untitled-1 2.md"]);
  });

  it("skips past a run of existing files", async () => {
    mockInvoke.mockImplementation(
      fsWith(["/docs/Untitled-1.md", "/docs/Untitled-1 2.md", "/docs/Untitled-1 3.md"]),
    );

    const paths = await reserveBatchDestinations("/docs", ["Untitled-1.md"]);

    expect(paths).toEqual(["/docs/Untitled-1 4.md"]);
  });

  // Two recovered/transferred tabs can carry the same title; sanitization can
  // also collapse two distinct titles onto one name.
  it("gives two docs with identical titles distinct destinations", async () => {
    mockInvoke.mockImplementation(fsWith([]));

    const paths = await reserveBatchDestinations("/docs", [
      "Untitled-1.md",
      "Untitled-1.md",
      "Untitled-1.md",
    ]);

    expect(paths).toEqual([
      "/docs/Untitled-1.md",
      "/docs/Untitled-1 2.md",
      "/docs/Untitled-1 3.md",
    ]);
    expect(new Set(paths).size).toBe(3);
  });

  it("combines on-disk and within-batch collisions", async () => {
    mockInvoke.mockImplementation(fsWith(["/docs/Note.md"]));

    const paths = await reserveBatchDestinations("/docs", ["Note.md", "Note.md"]);

    expect(paths).toEqual(["/docs/Note 2.md", "/docs/Note 3.md"]);
  });

  it("reserves each destination before returning, so nothing is left unclaimed", async () => {
    mockInvoke.mockImplementation(fsWith([]));

    await reserveBatchDestinations("/docs", ["A.md", "B.md"]);

    const claimed = mockInvoke.mock.calls
      .filter(([cmd]) => cmd === "create_file_exclusive")
      .map(([, args]) => (args as { path: string }).path);
    expect(claimed).toEqual(["/docs/A.md", "/docs/B.md"]);
  });

  it("preserves the order of the input names", async () => {
    mockInvoke.mockImplementation(fsWith([]));

    const paths = await reserveBatchDestinations("/docs", ["c.md", "a.md", "b.md"]);

    expect(paths).toEqual(["/docs/c.md", "/docs/a.md", "/docs/b.md"]);
  });

  it("returns an empty list for an empty batch without touching the backend", async () => {
    mockInvoke.mockImplementation(fsWith([]));

    expect(await reserveBatchDestinations("/docs", [])).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  // A reservation that cannot be made must not fall through to an overwrite.
  it("propagates a backend failure instead of returning a path", async () => {
    mockInvoke.mockRejectedValue(new Error("permission denied"));

    await expect(
      reserveBatchDestinations("/docs", ["Untitled-1.md"]),
    ).rejects.toThrow("permission denied");
  });

  it("throws rather than looping forever when every candidate is taken", async () => {
    mockInvoke.mockResolvedValue(false);

    await expect(
      reserveBatchDestinations("/docs", ["Untitled-1.md"]),
    ).rejects.toThrow(/Could not reserve a free filename/);
  });

  it("handles Unicode and spaces in titles", async () => {
    mockInvoke.mockImplementation(fsWith(["/docs/中文 笔记.md"]));

    const paths = await reserveBatchDestinations("/docs", ["中文 笔记.md"]);

    expect(paths).toEqual(["/docs/中文 笔记 2.md"]);
  });
});
