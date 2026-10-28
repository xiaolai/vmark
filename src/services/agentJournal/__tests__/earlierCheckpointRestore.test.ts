// @vitest-environment node
// WI-AL1.7 — restoring an earlier (pre-journal) checkpoint from the global list: a file checkpoint restores into that file's tab when it is open, opens the file first when it is not, stops when the user cancels the open, and falls back to a new untitled document (naming the path and why) when the file cannot be opened; an untitled checkpoint always restores into a new untitled document; the restore itself is the legacyCheckpoint controlled restore | AL2.2g: the restore prepare is answered with a reply bound to its frozen identity payload
import { describe, it, expect, vi, beforeEach } from "vitest";

const openFileInNewTabCore = vi.hoisted(() => vi.fn());
const createUntitledTab = vi.hoisted(() => vi.fn());
vi.mock("@/services/navigation/fileOpen", () => ({ openFileInNewTabCore }));
vi.mock("@/services/navigation/newFile", () => ({ createUntitledTab }));

// The restore is the real controlled restore over the shared journal wire fake
// (`src/test/globalTestHooks.ts`); its prepare is answered at the IPC
// boundary with a bound reply, as the real restore request parses it.
import { invoke } from "@tauri-apps/api/core";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { answerPrepare } from "@/test/agentJournalWireFake";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { resetJournalBases } from "../documentIdentity";
import type { JournalCheckpoint } from "../checkpointClient";
import type { PrepareInput } from "../journalClient";
import type { PreparedRestore, RestorePrepareInput } from "../historyClient";
import { restoreEarlierCheckpoint } from "../earlierCheckpointRestore";

const WIN = "main";
const RESTORE = "agent_journal_restore_prepare";
const APPLIED = { status: "applied", durable: true, changed: true, resolves: null } as const;
const LEGACY = { from: "legacyCheckpoint", legacyId: "cp-1" } as const;

/** A file checkpoint at `filePath`, or with `null` an untitled one from tab `t-old`. */
function checkpoint(filePath: string | null = "/notes/读书.md"): JournalCheckpoint {
  const rest = { id: "cp-1", timestamp: 1, tool: "document.write", description: "", contentBefore: "old" };
  return filePath === null ? { ...rest, tabId: "t-old", filePath: null } : { ...rest, tabId: null, filePath };
}

/** A tab with a loaded document, as the open and new-file paths leave it. */
function openTab(path: string | null, content = "now"): string {
  const tab = useTabStore.getState().createTab(WIN, path);
  useDocumentStore.getState().initDocument(tab, content, path);
  return tab;
}

/** Every restore prepare the window sent: the tab's key and the restore source. */
const restoreRequests = (): Array<Pick<RestorePrepareInput, "docKey" | "source">> =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === RESTORE)
    .map(([, args]) => {
      const { docKey, source } = JSON.parse((args as { payload: string }).payload) as RestorePrepareInput;
      return { docKey, source };
    });

const content = (tab: string) => useDocumentStore.getState().documents[tab]?.content;

beforeEach(() => {
  fake.reset();
  resetJournalBases();
  openFileInNewTabCore.mockReset();
  createUntitledTab.mockReset().mockImplementation(() => openTab(null, ""));
  useTabStore.setState({ tabs: {}, activeTabId: {} });
  useDocumentStore.setState({ documents: {} });
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    if (command !== RESTORE) return undefined;
    return answerPrepare(args, async ({ source: _source, ...rest }) => {
      const p = await fake.prepareControlledWrite({ ...rest, tool: "history.restore" } as unknown as PrepareInput);
      const prepared: PreparedRestore = { ...p, text: "old", resolves: null };
      return prepared;
    });
  });
});

describe("restoreEarlierCheckpoint", () => {
  it("restores into the file's open tab without opening it again", async () => {
    const tab = openTab("/notes/读书.md");
    const out = await restoreEarlierCheckpoint(checkpoint(), WIN);
    expect(openFileInNewTabCore).not.toHaveBeenCalled();
    expect(restoreRequests()).toEqual([{ docKey: "path:/notes/读书.md", source: LEGACY }]);
    expect(out).toEqual({ status: "restored", tabId: tab, outcome: APPLIED, fallback: null });
    expect(content(tab)).toBe("old");
  });

  it.each(["opened", "deduped"] as const)("opens a closed file first (%s), then restores into it", async (result) => {
    openFileInNewTabCore.mockImplementation(async (_w: string, path: string, o: { onTabCreated: (id: string, e: boolean) => void }) => {
      o.onTabCreated(openTab(path), result === "deduped");
      return result;
    });
    const out = await restoreEarlierCheckpoint(checkpoint("/gone/elsewhere.md"), WIN);
    expect(openFileInNewTabCore).toHaveBeenCalledWith(WIN, "/gone/elsewhere.md", expect.anything());
    expect(restoreRequests()).toEqual([{ docKey: "path:/gone/elsewhere.md", source: LEGACY }]);
    expect(out).toMatchObject({ status: "restored", outcome: APPLIED, fallback: null });
    expect(out.status === "restored" && content(out.tabId)).toBe("old");
  });

  it("stops when the user cancels the open", async () => {
    openFileInNewTabCore.mockResolvedValue("refused");
    const out = await restoreEarlierCheckpoint(checkpoint("/big.md"), WIN);
    expect(out).toEqual({ status: "cancelled" });
    expect(restoreRequests()).toEqual([]);
    expect(createUntitledTab).not.toHaveBeenCalled();
  });

  it.each(["failed", "closed"] as const)("falls back to a new untitled document when the open %s", async (result) => {
    openFileInNewTabCore.mockResolvedValue(result);
    const out = await restoreEarlierCheckpoint(checkpoint("/missing.md"), WIN);
    expect(createUntitledTab).toHaveBeenCalledWith(WIN);
    const tab = createUntitledTab.mock.results[0]?.value as string;
    expect(restoreRequests()).toEqual([{ docKey: expect.stringMatching(/^tab:/), source: LEGACY }]);
    expect(out).toEqual({ status: "restored", tabId: tab, outcome: APPLIED, fallback: { path: "/missing.md", reason: result } });
    expect(content(tab)).toBe("old");
  });

  it("falls back to untitled when the open throws", async () => {
    openFileInNewTabCore.mockRejectedValue(new Error("EACCES"));
    const out = await restoreEarlierCheckpoint(checkpoint("/locked.md"), WIN);
    expect(out).toMatchObject({ status: "restored", outcome: APPLIED, fallback: { path: "/locked.md", reason: "failed" } });
  });

  it("an untitled checkpoint always restores into a new untitled document", async () => {
    const out = await restoreEarlierCheckpoint(checkpoint(null), WIN);
    expect(openFileInNewTabCore).not.toHaveBeenCalled();
    expect(createUntitledTab).toHaveBeenCalledWith(WIN);
    const tab = createUntitledTab.mock.results[0]?.value as string;
    expect(out).toEqual({ status: "restored", tabId: tab, outcome: APPLIED, fallback: null });
    expect(content(tab)).toBe("old");
  });

  it("an empty path is treated as untitled", async () => {
    await restoreEarlierCheckpoint(checkpoint(""), WIN);
    expect(openFileInNewTabCore).not.toHaveBeenCalled();
    expect(createUntitledTab).toHaveBeenCalled();
  });

  it("a refused restore is reported, not thrown, and leaves the tab alone", async () => {
    const tab = openTab("/notes/读书.md");
    fake.refuseNextPrepares("JOURNAL_BUSY");
    const out = await restoreEarlierCheckpoint(checkpoint(), WIN);
    expect(out).toMatchObject({ status: "restored", tabId: tab, outcome: { status: "refused" } });
    expect(content(tab)).toBe("now");
  });

  const tabIds = () => (useTabStore.getState().tabs[WIN] ?? []).map((t) => t.id);

  it("a refused restore removes the untitled document it created for the text", async () => {
    fake.refuseNextPrepares("JOURNAL_BUSY");
    const out = await restoreEarlierCheckpoint(checkpoint(null), WIN);
    expect(out).toMatchObject({ status: "restored", outcome: { status: "refused" } });
    expect(tabIds()).toEqual([]);
  });

  it("a refused fallback restore removes its untitled document too, but never the file's own tab", async () => {
    openFileInNewTabCore.mockResolvedValue("failed");
    fake.refuseNextPrepares("JOURNAL_BUSY");
    await restoreEarlierCheckpoint(checkpoint("/missing.md"), WIN);
    expect(tabIds()).toEqual([]);
    const tab = openTab("/notes/读书.md");
    fake.refuseNextPrepares("JOURNAL_BUSY");
    await restoreEarlierCheckpoint(checkpoint(), WIN);
    expect(tabIds()).toEqual([tab]);
  });

  it("keeps a created untitled document the user typed into before the restore aborted", async () => {
    vi.mocked(invoke).mockImplementationOnce(async () => {
      const [tab] = tabIds();
      useDocumentStore.getState().setEditorContent(tab, "typed");
      throw new Error("not reached");
    });
    const out = await restoreEarlierCheckpoint(checkpoint(null), WIN);
    // The lost reply is retried once with the same payload; the retry is
    // admitted, and the typing it finds aborts the restore as edited.
    expect(out).toMatchObject({ status: "restored", outcome: { status: "aborted", reason: "edited" } });
    expect(tabIds()).toHaveLength(1);
    expect(content(tabIds()[0])).toBe("typed");
  });

  /** The restore prepare runs `during` on the created tab, then fails. */
  const failingWith = (during: (tab: string) => void) =>
    vi.mocked(invoke).mockImplementationOnce(async () => {
      during(tabIds()[0]);
      throw new Error("not reached");
    });

  it("keeps a created document typed into and cleared again: empty is not untouched", async () => {
    failingWith((tab) => {
      useDocumentStore.getState().setEditorContent(tab, "typed");
      useDocumentStore.getState().setEditorContent(tab, "");
    });
    await restoreEarlierCheckpoint(checkpoint(null), WIN);
    expect(tabIds()).toHaveLength(1);
  });

  it("keeps a created document saved to a file (Save As) during the restore, even empty", async () => {
    failingWith((tab) => useDocumentStore.getState().setFilePath(tab, "/saved.md"));
    await restoreEarlierCheckpoint(checkpoint(null), WIN);
    expect(tabIds()).toHaveLength(1);
  });

  it("removes the created tab when its document went missing: no orphan tab", async () => {
    failingWith((tab) => useDocumentStore.getState().removeDocument(tab));
    await restoreEarlierCheckpoint(checkpoint(null), WIN);
    expect(tabIds()).toEqual([]);
  });

  it("a restore that throws still removes the untouched untitled document it created", async () => {
    // The apply throws before it changes the buffer: the restore aborts and rethrows.
    const { setEditorContent } = useDocumentStore.getState();
    useDocumentStore.setState({ setEditorContent: () => { throw new Error("editor gone"); } });
    try {
      await expect(restoreEarlierCheckpoint(checkpoint(null), WIN)).rejects.toThrow("editor gone");
    } finally {
      useDocumentStore.setState({ setEditorContent });
    }
    expect(tabIds()).toEqual([]);
  });
});
