/**
 * The last check before an image is trashed (WI-11): does ANY workspace
 * document mention its filename? Fail-closed by design — only a clean
 * "nobody mentions it" clears deletion.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { withoutWorkspaceReferenced } from "./workspaceReferenceCheck";

const img = (n: string) => ({ filename: n, fullPath: `/ws/notes/assets/images/${n}` });
const hits = (...paths: string[]) => ({ results: paths.map((p) => ({ path: p })), complete: true });
const clean = () => hits();

describe("withoutWorkspaceReferenced", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ rootPath: "/ws", isWorkspaceMode: true } as never);
  });

  it("clears a candidate no document mentions", async () => {
    vi.mocked(invoke).mockResolvedValue(clean());
    expect(await withoutWorkspaceReferenced([img("orphan.png")])).toEqual([img("orphan.png")]);
  });

  it("keeps a candidate some document mentions — wherever it is", async () => {
    // A doc in a SIBLING DIRECTORY references it by absolute path; the
    // same-directory scan never read that doc.
    vi.mocked(invoke).mockResolvedValue(hits("/ws/journal/2026.md"));
    expect(await withoutWorkspaceReferenced([img("used.png")])).toEqual([]);
  });

  it("keeps a candidate when the scan was INCOMPLETE, even with zero hits", async () => {
    // The search skips >1 MB files, unreadable files, and bails on its
    // 5 s deadline — silently, for the UI. Zero hits from such a partial
    // scan must NOT read as "verified clean" (review finding): the one
    // document mentioning this image may be exactly the one skipped.
    vi.mocked(invoke).mockResolvedValue({ results: [], complete: false });
    expect(await withoutWorkspaceReferenced([img("maybe.png")])).toEqual([]);
  });

  it.each([undefined, null, {}, { results: [] }, { complete: true }, [] ])(
    "keeps a candidate on a malformed reply (%j)",
    async (wire) => {
      vi.mocked(invoke).mockResolvedValue(wire as never);
      expect(await withoutWorkspaceReferenced([img("maybe.png")])).toEqual([]);
    },
  );

  it("searches for the filename with the markdown extension set", async () => {
    vi.mocked(invoke).mockResolvedValue(clean());
    await withoutWorkspaceReferenced([img("shot-1.png")]);
    expect(invoke).toHaveBeenCalledWith("search_workspace_content_checked", expect.objectContaining({
      rootPath: "/ws",
      query: "shot-1.png",
      markdownOnly: true,
      // An empty list here would match NOTHING and clear everything.
      extensions: expect.arrayContaining([".md"]),
    }));
  });

  it("keeps a candidate when the search fails (fail closed)", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("search unavailable"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await withoutWorkspaceReferenced([img("maybe.png")])).toEqual([]);
    spy.mockRestore();
  });

  it("keeps a filename too short to search (fail closed)", async () => {
    expect(await withoutWorkspaceReferenced([img("ab")])).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("is a pass-through outside workspace mode", async () => {
    useWorkspaceStore.setState({ rootPath: null, isWorkspaceMode: false } as never);
    expect(await withoutWorkspaceReferenced([img("x.png")])).toEqual([img("x.png")]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("judges each candidate independently", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(hits("/ws/doc.md")) // a.png is mentioned
      .mockResolvedValueOnce(clean()); // b.png is not
    const result = await withoutWorkspaceReferenced([img("a.png"), img("b.png")]);
    expect(result).toEqual([img("b.png")]);
  });
});
