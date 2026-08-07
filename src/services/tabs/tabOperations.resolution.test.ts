// @vitest-environment node
/**
 * closeTabWithDirtyCheck — the close DECISION under concurrency and
 * divergence (WI-2 / WI-5 / WI-6). Own file: useTabOperations.test.ts sits at
 * the test-size limit.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { closeTabWithDirtyCheck } from "./tabOperations";
import { message } from "@tauri-apps/plugin-dialog";
import { saveToPath } from "@/services/persistence/saveToPath";

vi.mock("@/services/persistence/saveToPath", () => ({
  saveToPath: vi.fn(),
}));

vi.mock("@/services/media/orphanAssetCleanup", () => ({
  findOrphanedImages: vi.fn().mockResolvedValue({
    orphanedImages: [], referencedCount: 0, sharedCount: 0, totalInFolder: 0, scanComplete: true,
  }),
  deleteOrphanedImages: vi.fn().mockResolvedValue({ deleted: 0, failed: [] }),
}));

const WINDOW_LABEL = "main";

function resetStores() {
  useTabStore.getState().removeWindow(WINDOW_LABEL);
  const docState = useDocumentStore.getState();
  Object.keys(docState.documents).forEach((id) => docState.removeDocument(id));
}

// WI-2/WI-5/WI-6 — the close decision itself, under concurrency and divergence.
describe("closeTabWithDirtyCheck — resolution", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  // WI-2: a divergent document (kept local content after an external edit) has
  // isDirty=false, but closing it silently discards exactly what the user
  // already chose once to keep.
  it("prompts for a divergent-but-clean document", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/div.md");
    useDocumentStore.getState().initDocument(tabId, "local version", "/tmp/div.md");
    useDocumentStore.getState().markDivergent(tabId);
    expect(useDocumentStore.getState().getDocument(tabId)!.isDirty).toBe(false);

    vi.mocked(message).mockResolvedValueOnce("Cancel");
    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(false);
    expect(message).toHaveBeenCalledTimes(1);
    expect(useTabStore.getState().tabs[WINDOW_LABEL]).toHaveLength(1);
  });

  it("Save on a divergent doc writes the LOCAL version", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/div.md");
    useDocumentStore.getState().initDocument(tabId, "local version", "/tmp/div.md");
    useDocumentStore.getState().markDivergent(tabId);

    vi.mocked(message).mockResolvedValueOnce("Yes");
    vi.mocked(saveToPath).mockImplementationOnce(async (id, _p, content) => {
      useDocumentStore.getState().markSaved(id, content);
      return true;
    });

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(true);
    expect(saveToPath).toHaveBeenCalledWith(tabId, "/tmp/div.md", "local version", "manual");
    expect(useTabStore.getState().tabs[WINDOW_LABEL]).toEqual([]);
  });

  it("Don't Save on a divergent doc closes without writing", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/div.md");
    useDocumentStore.getState().initDocument(tabId, "local version", "/tmp/div.md");
    useDocumentStore.getState().markDivergent(tabId);

    vi.mocked(message).mockResolvedValueOnce("No");
    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(true);
    expect(saveToPath).not.toHaveBeenCalled();
    expect(useTabStore.getState().tabs[WINDOW_LABEL]).toEqual([]);
  });

  // WI-5: an edit landing WHILE the save runs (human or MCP) leaves the doc
  // dirty again — it must get another prompt, not be silently dropped.
  it("re-prompts when an edit lands during the save", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/race.md");
    useDocumentStore.getState().initDocument(tabId, "v1", "/tmp/race.md");
    useDocumentStore.getState().setContent(tabId, "v2");

    vi.mocked(message).mockResolvedValue("Yes");
    vi.mocked(saveToPath)
      .mockImplementationOnce(async (id, _p, content) => {
        // The save lands — and so does a concurrent MCP write.
        useDocumentStore.getState().markSaved(id, content);
        useDocumentStore.getState().setContent(id, "v3 (concurrent)");
        return true;
      })
      .mockImplementationOnce(async (id, _p, content) => {
        useDocumentStore.getState().markSaved(id, content);
        return true;
      });

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(true);
    expect(message).toHaveBeenCalledTimes(2);
    // The second save carried the concurrent edit — nothing was dropped.
    expect(saveToPath).toHaveBeenLastCalledWith(
      tabId, "/tmp/race.md", "v3 (concurrent)", "manual",
    );
  });

  it("refuses to close when the document never comes to rest", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/hostile.md");
    useDocumentStore.getState().initDocument(tabId, "v0", "/tmp/hostile.md");
    useDocumentStore.getState().setContent(tabId, "v1");

    vi.mocked(message).mockResolvedValue("Yes");
    let n = 0;
    vi.mocked(saveToPath).mockImplementation(async (id, _p, content) => {
      useDocumentStore.getState().markSaved(id, content);
      useDocumentStore.getState().setContent(id, `v${++n + 1} (writer keeps going)`);
      return true;
    });

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    // Bounded: refusing loses nothing; silently dropping the newest write would.
    expect(result).toBe(false);
    expect(useTabStore.getState().tabs[WINDOW_LABEL]).toHaveLength(1);
    expect(useDocumentStore.getState().getDocument(tabId)).toBeDefined();
  });

  // WI-5: pinning DURING the dialog is a "keep this around" signal.
  it("honours a pin applied while the prompt was open", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/pin.md");
    useDocumentStore.getState().initDocument(tabId, "v1", "/tmp/pin.md");
    useDocumentStore.getState().setContent(tabId, "v2");

    vi.mocked(message).mockImplementationOnce(async () => {
      useTabStore.getState().togglePin(WINDOW_LABEL, tabId);
      return "No"; // discard — but the pin must still win
    });

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(false);
    expect(useTabStore.getState().tabs[WINDOW_LABEL]).toHaveLength(1);
    expect(useDocumentStore.getState().getDocument(tabId)).toBeDefined();
  });

  // WI-6: a document tab whose document is missing must CLOSE, not report
  // closed while staying on screen.
  it("closes a tab whose document state is missing", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/ghost.md");
    // No initDocument — the file read is still in flight.

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(true);
    expect(useTabStore.getState().tabs[WINDOW_LABEL]).toEqual([]);
  });

  // Save-time normalization (hard-break style) makes markSaved compare the
  // SAVED bytes against the untouched buffer — isDirty stays true with the
  // content safely on disk. Re-prompting looped three identical dialogs and
  // then REFUSED the close (review finding). Byte-identical buffer after a
  // completed save = at rest.
  it("closes after ONE prompt when only save-normalization keeps the doc dirty", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/breaks.md");
    useDocumentStore.getState().initDocument(tabId, "v1", "/tmp/breaks.md");
    useDocumentStore.getState().setContent(tabId, "line  \nnext");

    vi.mocked(message).mockResolvedValue("Yes");
    vi.mocked(saveToPath).mockImplementation(async (id) => {
      // saveToPath normalizes trailing-double-space breaks to backslash form;
      // the saved bytes differ from the buffer, so isDirty SURVIVES the save.
      useDocumentStore.getState().markSaved(id, "line\\\nnext");
      return true;
    });

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(useDocumentStore.getState().documents[tabId]).toBeUndefined();
    expect(result).toBe(true);
    expect(message).toHaveBeenCalledTimes(1);
    expect(useTabStore.getState().tabs[WINDOW_LABEL]).toEqual([]);
  });

  it("still re-prompts when a REAL edit hides behind the normalization artifact", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/breaks.md");
    useDocumentStore.getState().initDocument(tabId, "v1", "/tmp/breaks.md");
    useDocumentStore.getState().setContent(tabId, "line  \nnext");

    vi.mocked(message).mockResolvedValue("Yes");
    vi.mocked(saveToPath)
      .mockImplementationOnce(async (id) => {
        useDocumentStore.getState().markSaved(id, "line\\\nnext");
        // A concurrent MCP write lands during the save — the content CHANGED,
        // so the artifact exemption must not swallow it.
        useDocumentStore.getState().setContent(id, "line  \nnext plus more");
        return true;
      })
      .mockImplementationOnce(async (id, _p, content) => {
        useDocumentStore.getState().markSaved(id, content);
        return true;
      });

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(true);
    expect(message).toHaveBeenCalledTimes(2);
    expect(saveToPath).toHaveBeenLastCalledWith(
      tabId, "/tmp/breaks.md", "line  \nnext plus more", "manual",
    );
  });
});
