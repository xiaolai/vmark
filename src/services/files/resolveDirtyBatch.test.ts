// @vitest-environment node
/**
 * Tests for resolveDirtyBatch: revalidating a debounced batch of externally
 * changed dirty documents, then routing it to the right dialog.
 *
 * The native dialog, the disk read and the two per-file resolutions (reload,
 * single-file dialog) are boundaries and are mocked; the revalidation and the
 * real bulk resolutions in fileChangeBatch run against the document store.
 * Covers: entries whose tab closed, was saved, or was renamed away are dropped
 * (the rename case would otherwise load a different file's bytes); one
 * surviving entry goes to the single-file dialog; several go to the batch
 * dialog, and each of its three answers (including the localized button label
 * some platforms return instead of Yes/No) resolves only the live entries.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn() }));
vi.mock("@/services/files/readDocumentText", () => ({ readDocumentText: vi.fn() }));
vi.mock("@/services/persistence/reloadFromDisk", () => ({ reloadTabFromDisk: vi.fn() }));
vi.mock("@/services/persistence/resolveDirtyFileChange", () => ({ resolveDirtyFileChange: vi.fn() }));

import { message } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { useDocumentStore } from "@/stores/documentStore";
import { readDocumentText } from "@/services/files/readDocumentText";
import { reloadTabFromDisk } from "@/services/persistence/reloadFromDisk";
import { resolveDirtyFileChange } from "@/services/persistence/resolveDirtyFileChange";
import { resolveDirtyBatch, type PendingDirtyChange } from "./resolveDirtyBatch";

/** A document with unsaved edits at `filePath`. */
function dirty(tabId: string, filePath: string): PendingDirtyChange {
  useDocumentStore.getState().initDocument(tabId, "saved", filePath);
  useDocumentStore.getState().setEditorContent(tabId, "unsaved edit");
  return { tabId, filePath };
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentStore.setState({ documents: {} });
});

describe("resolveDirtyBatch — revalidation", () => {
  it("drops an entry whose tab has closed", async () => {
    await resolveDirtyBatch([{ tabId: "gone", filePath: "/w/a.md" }]);

    expect(resolveDirtyFileChange).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
  });

  it("drops an entry whose document has since been saved", async () => {
    const entry = dirty("t1", "/w/a.md");
    useDocumentStore.getState().setEditorContent("t1", "saved");

    await resolveDirtyBatch([entry]);

    expect(resolveDirtyFileChange).not.toHaveBeenCalled();
  });

  it("drops an entry whose document was renamed away from the queued path", async () => {
    const entry = dirty("t1", "/w/a.md");
    useDocumentStore.getState().setFilePath("t1", "/w/renamed.md");

    await resolveDirtyBatch([entry]);

    expect(resolveDirtyFileChange).not.toHaveBeenCalled();
    expect(reloadTabFromDisk).not.toHaveBeenCalled();
  });

  it("keeps a divergent (not dirty) document", async () => {
    useDocumentStore.getState().initDocument("t1", "saved", "/w/a.md");
    useDocumentStore.getState().markDivergent("t1");

    await resolveDirtyBatch([{ tabId: "t1", filePath: "/w/a.md" }]);

    expect(resolveDirtyFileChange).toHaveBeenCalledWith("t1", "/w/a.md");
  });
});

describe("resolveDirtyBatch — routing", () => {
  it("one live entry goes straight to the single-file dialog", async () => {
    const live = dirty("t1", "/w/a.md");

    await resolveDirtyBatch([live, { tabId: "gone", filePath: "/w/b.md" }]);

    expect(resolveDirtyFileChange).toHaveBeenCalledWith("t1", "/w/a.md");
    expect(message).not.toHaveBeenCalled();
  });

  it("several live entries open the batch dialog naming each file", async () => {
    const batch = [dirty("t1", "/w/a.md"), dirty("t2", "/w/b.md")];
    vi.mocked(message).mockResolvedValue("Cancel");

    await resolveDirtyBatch(batch);

    expect(message).toHaveBeenCalledWith(
      i18n.t("dialog:fileChanged.multipleMessage", { count: 2, fileNames: "a.md, b.md" }),
      expect.objectContaining({ kind: "warning" }),
    );
  });

  it.each([
    ["Yes", "reload"],
    [i18n.t("dialog:fileChanged.buttonReloadAll"), "reload"],
    ["No", "keep"],
    [i18n.t("dialog:fileChanged.buttonKeepAll"), "keep"],
    ["Cancel", "review"],
    [i18n.t("dialog:fileChanged.buttonReviewEach"), "review"],
  ])("answer %j resolves the live entries by %s", async (answer, outcome) => {
    const a = dirty("t1", "/w/a.md");
    const b = dirty("t2", "/w/b.md");
    vi.mocked(message).mockResolvedValue(answer);
    vi.mocked(readDocumentText).mockResolvedValue("disk now");

    await resolveDirtyBatch([a, { tabId: "gone", filePath: "/w/x.md" }, b]);

    const live = [["t1", "/w/a.md"], ["t2", "/w/b.md"]];
    expect(vi.mocked(reloadTabFromDisk).mock.calls).toEqual(outcome === "reload" ? live : []);
    expect(vi.mocked(resolveDirtyFileChange).mock.calls).toEqual(outcome === "review" ? live : []);
    const kept = outcome === "keep";
    const { t1, t2 } = useDocumentStore.getState().documents;
    expect([t1.isDivergent, t2.isDivergent]).toEqual([kept, kept]);
    expect([t1.lastDiskContent, t2.lastDiskContent]).toEqual(
      kept ? ["disk now", "disk now"] : ["saved", "saved"],
    );
    expect(vi.mocked(readDocumentText).mock.calls).toEqual(kept ? [["/w/a.md"], ["/w/b.md"]] : []);
  });
});
