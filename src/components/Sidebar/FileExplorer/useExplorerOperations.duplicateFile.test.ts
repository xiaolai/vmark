// duplicateFile must preserve the source file's real extension (the tree
// shows .md, .markdown, .mdx, .txt, .yml, media, …) and copy binary-safely
// via copyFile — never round-tripping content through UTF-8 text reads.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  copyFile: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: mocks.writeTextFile,
  readTextFile: mocks.readTextFile,
  copyFile: mocks.copyFile,
  mkdir: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  exists: mocks.exists,
  stat: vi.fn(),
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
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/stores/tabStore", () => ({ useTabStore: { getState: () => ({ getAllOpenFilePaths: () => [] }) } }));
vi.mock("@/services/persistence/applyPathReconciliation", () => ({ applyPathReconciliation: vi.fn() }));
vi.mock("@/services/dialogs/errorDialog", () => ({
  showError: vi.fn(),
  FileErrors: {
    duplicateFailed: (name: string) => ({ kind: "duplicateFailed", name }),
    tooManyCopies: (name: string) => ({ kind: "tooManyCopies", name }),
  },
}));

import { useExplorerOperations } from "./useExplorerOperations";

function duplicate(path: string) {
  const { result } = renderHook(() => useExplorerOperations());
  return result.current.duplicateFile(path);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exists.mockResolvedValue(false);
  mocks.copyFile.mockResolvedValue(undefined);
});

describe("useExplorerOperations.duplicateFile", () => {
  it("keeps the .md extension (unchanged behavior)", async () => {
    await expect(duplicate("/ws/note.md")).resolves.toBe("/ws/note copy.md");
    expect(mocks.copyFile).toHaveBeenCalledWith("/ws/note.md", "/ws/note copy.md");
  });

  it("keeps the .txt extension instead of coercing to .md", async () => {
    await expect(duplicate("/ws/notes.txt")).resolves.toBe("/ws/notes copy.txt");
    expect(mocks.copyFile).toHaveBeenCalledWith("/ws/notes.txt", "/ws/notes copy.txt");
  });

  it("keeps the .markdown extension intact", async () => {
    await expect(duplicate("/ws/report.markdown")).resolves.toBe(
      "/ws/report copy.markdown",
    );
  });

  it("copies media binary-safely via copyFile (no text round-trip)", async () => {
    await expect(duplicate("/ws/image.png")).resolves.toBe("/ws/image copy.png");
    expect(mocks.copyFile).toHaveBeenCalledWith("/ws/image.png", "/ws/image copy.png");
    expect(mocks.readTextFile).not.toHaveBeenCalled();
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("uniques the copy name when collisions exist", async () => {
    const taken = new Set(["/ws/note copy.md", "/ws/note copy 2.md"]);
    mocks.exists.mockImplementation((p: string) => Promise.resolve(taken.has(p)));
    await expect(duplicate("/ws/note.md")).resolves.toBe("/ws/note copy 3.md");
    expect(mocks.copyFile).toHaveBeenCalledWith("/ws/note.md", "/ws/note copy 3.md");
  });

  it("handles extensionless files", async () => {
    await expect(duplicate("/ws/Makefile")).resolves.toBe("/ws/Makefile copy");
  });

  it("treats dotfiles as extensionless", async () => {
    await expect(duplicate("/ws/.env")).resolves.toBe("/ws/.env copy");
  });

  it("duplicates a root-level file to an absolute path (parent via dirname, not string slicing)", async () => {
    await expect(duplicate("/note.md")).resolves.toBe("/note copy.md");
    expect(mocks.copyFile).toHaveBeenCalledWith("/note.md", "/note copy.md");
  });

  it("returns null when the copy fails", async () => {
    mocks.copyFile.mockRejectedValue(new Error("EACCES"));
    await expect(duplicate("/ws/note.md")).resolves.toBeNull();
  });
});
