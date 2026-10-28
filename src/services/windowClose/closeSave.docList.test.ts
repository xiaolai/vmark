// WI-RA19.6 — how the combined save dialog lists each document. A file in the
// filesystem root (or a drive root) was listed with a doubled separator
// ("…//notes.md"), because the elided-parent form was built even when there
// was no parent folder to name; and an untitled document's "(new)" suffix was
// an English literal. Each entry is asserted exactly, in list order.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/persistence/saveToPath", () => ({
  saveToPathForClose: vi.fn(async () => true),
}));

import { message } from "@tauri-apps/plugin-dialog";
import { promptSaveForMultipleDocuments } from "./closeSave";

const ctx = (title: string, filePath: string | null) => ({
  windowLabel: "main",
  tabId: title,
  title,
  filePath,
  content: "x",
});

/** The bullet entries of the dialog shown for these documents. */
async function entriesFor(docs: ReturnType<typeof ctx>[]): Promise<string[]> {
  vi.mocked(message).mockResolvedValueOnce("Cancel");
  await promptSaveForMultipleDocuments(docs);
  const text = vi.mocked(message).mock.calls.at(-1)?.[0] as string;
  const list = text.split("\n\n")[1] ?? "";
  return list.split("\n").map((line) => line.replace(/^• /, ""));
}

beforeEach(() => {
  vi.mocked(message).mockReset();
});

describe("combined save dialog document list", () => {
  it.each([
    ["a nested file elides everything above its parent folder", "/Users/me/projects/docs/a.md", "a.md", "…/docs/a.md"],
    ["a root-level file is shown whole, with no doubled separator", "/notes.md", "notes.md", "/notes.md"],
    ["a file one folder below the root is shown whole", "/docs/a.md", "a.md", "/docs/a.md"],
    ["a Windows drive-root file is shown whole", "C:\\notes.md", "notes.md", "C:\\notes.md"],
    ["a nested Windows file keeps its own separator", "C:\\Users\\me\\docs\\a.md", "a.md", "…\\docs\\a.md"],
    ["a CJK folder and file name survive", "/Users/me/文档/笔记.md", "笔记.md", "…/文档/笔记.md"],
    ["a bare relative name is shown as is", "a.md", "a.md", "a.md"],
  ])("%s", async (_label, filePath, title, expected) => {
    const entries = await entriesFor([ctx(title, filePath), ctx("other.md", "/x/y/other.md")]);
    expect(entries[0]).toBe(expected);
    expect(entries[0]).not.toMatch(/\/\/|\\\\/);
  });

  it("never repeats the path inside an entry", async () => {
    const entries = await entriesFor([ctx("a.md", "/Users/me/docs/a.md"), ctx("b.md", "/Users/me/docs/b.md")]);
    expect(entries).toEqual(["…/docs/a.md", "…/docs/b.md"]);
  });

  it("marks an untitled document with the translated (new) suffix", async () => {
    const entries = await entriesFor([ctx("Untitled-1", null), ctx("a.md", "/Users/me/docs/a.md")]);
    expect(entries[0]).toBe("Untitled-1 (new)");
  });
});
