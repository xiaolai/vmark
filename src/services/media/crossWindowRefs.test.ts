// @vitest-environment node
/**
 * The cross-window bridge (WI-9): another window's unsaved buffer can be the
 * SOLE reference to an image this window is about to trash. Fail-closed at
 * every joint — only a complete answer from every window clears deletion.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "@/stores/documentStore";
import { collectRemoteLiveRefs, localLiveRefKeys } from "./crossWindowRefs";

function resetDocs() {
  const store = useDocumentStore.getState();
  Object.keys(store.documents).forEach((id) => store.removeDocument(id));
}

describe("collectRemoteLiveRefs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes a complete answer through", async () => {
    vi.mocked(invoke).mockResolvedValue({ complete: true, refs: ["assets/images/x.png"] });
    const result = await collectRemoteLiveRefs("main");
    expect(result.complete).toBe(true);
    expect(result.keys.has("assets/images/x.png")).toBe(true);
  });

  it("keeps an incomplete answer incomplete", async () => {
    vi.mocked(invoke).mockResolvedValue({ complete: false, refs: ["assets/images/x.png"] });
    const result = await collectRemoteLiveRefs("main");
    expect(result.complete).toBe(false);
    // Partial refs still protect — they only ever ADD protection.
    expect(result.keys.has("assets/images/x.png")).toBe(true);
  });

  it("fails closed when the command rejects", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("no such command"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await collectRemoteLiveRefs("main")).complete).toBe(false);
    spy.mockRestore();
  });

  it.each([undefined, null, {}, { complete: "yes", refs: [] }, { complete: true }])(
    "fails closed on a malformed reply (%j)",
    async (wire) => {
      vi.mocked(invoke).mockResolvedValue(wire as never);
      expect((await collectRemoteLiveRefs("main")).complete).toBe(false);
    },
  );
});

describe("localLiveRefKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDocs();
  });

  it("extracts reference keys from every open document's buffer", () => {
    useDocumentStore.getState().initDocument("t1", "![](./assets/images/a.png)", "/w/a.md");
    useDocumentStore.getState().initDocument("t2", "![](./assets/images/b.png)", "/w/b.md");
    const keys = localLiveRefKeys();
    expect(keys).toContain("assets/images/a.png");
    expect(keys).toContain("assets/images/b.png");
  });

  it("reads the UNSAVED buffer — that is the whole point", () => {
    useDocumentStore.getState().initDocument("t1", "saved", "/w/a.md");
    useDocumentStore.getState().setContent("t1", "![](./assets/images/pasted.png)");
    expect(localLiveRefKeys()).toContain("assets/images/pasted.png");
  });

  it("includes untitled documents — their buffers exist nowhere on disk", () => {
    // A never-saved buffer holding an absolute reference is invisible to every
    // OTHER evidence source (disk scan, workspace search). Dropping it here
    // deleted an image an open window still displayed (review finding).
    useDocumentStore.getState().initDocument("t1", "![](/w/assets/images/x.png)", null);
    expect(localLiveRefKeys()).toContain("/w/assets/images/x.png");
  });
});
