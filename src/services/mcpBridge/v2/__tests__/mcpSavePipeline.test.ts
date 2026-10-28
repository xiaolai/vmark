// WI-RA1A.2 — the three MCP disk writes (document.write, workspace.save,
// workspace.save_as) go through the app's save pipeline, not around it.
//
// Real handlers, real stores, real `saveToPath` pipeline; `@tauri-apps/*` is
// the only mocked boundary, behind the stateful disk fake. Every assertion is
// about what ended up on disk and in the document, because that is where the
// defect lived: each handler called plugin-fs `writeTextFile` itself, so an
// MCP write lost the file's line endings and BOM, was not serialized against
// other saves of the same file, could be re-pointed by a late autosave, took
// no history snapshot, and was not atomic.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () =>
  (await import("./bridgeWriteGate")).gatedFsModule(),
);
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./bridgeWriteGate")).gatedCoreModule(),
);

import { statefulFs } from "@/test/statefulFsFake";
import { ROOT, WINDOW, doc, editDoc, newUntitledTab, openDocInTab, settle } from "@/test/tier0/harness";
import { tabFilePath, useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getSnapshots, loadSnapshot } from "@/services/history/historyOperations";
import { saveToPath } from "@/services/persistence/saveToPath";
import { imeToast } from "@/services/ime/imeToast";
import { hasPendingSave, matchesPendingSave, PENDING_SAVE_GRACE_MS } from "@/utils/pendingSaves";
import { handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { handleWorkspaceSave } from "@/services/mcpBridge/v2/workspaceSave";
import { handleWorkspaceSaveAs } from "@/services/mcpBridge/v2/workspaceSaveAs";
import { captures, resetBridge, responseTo, structuredErrorOf } from "./bridgeDiskHarness";
import { writeGate } from "./bridgeWriteGate";
import { TEST_ATTRIBUTION, TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";
import { mcpCoherenceAgent } from "@/services/coherence/mcpActor";

const DOC = `${ROOT}/notes.md`;
const NEW = `${ROOT}/renamed.md`;
const BOM = "\u{FEFF}";
/** A CRLF file with a BOM and CJK text; no hard breaks, math or tables. */
const CRLF_BOM_ORIGINAL = `${BOM}# 标题\r\n\r\n正文\r\n`;
/** What the editor (and an MCP client) sees: LF-only, BOM-free. */
const EDITED_LF = "# 标题\n\n正文\n新增一行\n";
const EDITED_ON_DISK = `${BOM}# 标题\r\n\r\n正文\r\n新增一行\r\n`;

interface WriteData {
  revision: string;
  saved: boolean;
  save_skipped?: string;
  save_error?: string;
}

function writeData(id: string): WriteData {
  const r = responseTo(id);
  expect(r.success).toBe(true);
  return r.data as WriteData;
}

function tabOf(tabId: string) {
  const tab = useTabStore.getState().findTabById(tabId);
  if (!tab) throw new Error(`no tab ${tabId}`);
  return tab;
}

/**
 * The three ways an MCP client puts a tab's content on disk. Each returns the
 * path the bytes should have landed at.
 */
const WRITE_PATHS = [
  {
    tool: "document.write",
    async run(tabId: string, id: string): Promise<string> {
      await handleDocumentWrite(id, { tabId, content: EDITED_LF }, TEST_WRITE_CONTEXT);
      return DOC;
    },
  },
  {
    tool: "workspace.save",
    async run(tabId: string, id: string): Promise<string> {
      editDoc(tabId, EDITED_LF);
      await handleWorkspaceSave(id, { tabId }, TEST_WRITE_CONTEXT);
      return DOC;
    },
  },
  {
    tool: "workspace.save_as",
    async run(tabId: string, id: string): Promise<string> {
      editDoc(tabId, EDITED_LF);
      await handleWorkspaceSaveAs(id, { tabId, filePath: NEW }, TEST_WRITE_CONTEXT);
      return NEW;
    },
  },
] as const;

beforeEach(() => {
  resetBridge();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(WRITE_PATHS)("$tool goes through the save pipeline", ({ tool, run }) => {
  it("keeps the file's CRLF line endings and BOM on disk", async () => {
    const tabId = await openDocInTab(DOC, CRLF_BOM_ORIGINAL);

    const target = await run(tabId, "req-eol");

    expect(responseTo("req-eol").success).toBe(true);
    expect(statefulFs.read(target)).toBe(EDITED_ON_DISK);
  });

  it("leaves the document clean, with one snapshot per text domain", async () => {
    const tabId = await openDocInTab(DOC, CRLF_BOM_ORIGINAL);

    await run(tabId, "req-clean");

    const record = doc(tabId);
    expect(record.isDirty).toBe(false);
    // Editor domain: LF, BOM-free. Disk domain: the bytes actually written.
    expect(record.content).toBe(EDITED_LF);
    expect(record.savedContent).toBe(EDITED_LF);
    expect(record.lastDiskContent).toBe(EDITED_ON_DISK);
    expect(record.lineEnding).toBe("crlf");
    expect(record.hasBom).toBe(true);
  });

  it("writes atomically: no plugin-fs writeTextFile touches the document", async () => {
    const tabId = await openDocInTab(DOC, CRLF_BOM_ORIGINAL);

    const target = await run(tabId, "req-atomic");

    expect(statefulFs.writesTo(target)).toEqual([
      { path: target, content: EDITED_ON_DISK, via: "atomic_write_file" },
    ]);
  });

  it("records a history snapshot of the bytes written", async () => {
    const tabId = await openDocInTab(DOC, CRLF_BOM_ORIGINAL);

    const target = await run(tabId, "req-history");

    const snapshots = await getSnapshots(target);
    expect(snapshots).toHaveLength(1);
    // Filed as the AI client's save, not the user's — and, like a manual
    // save, never merged away or size-skipped as an autosave would be.
    expect(snapshots[0].type).toBe("mcp");
    // The snapshot FILE holds the bytes written, BOM included. Read the file:
    // loadSnapshot decodes through the plugin's text read, which drops the BOM
    // (harmless there — a restore re-applies the file's own convention).
    const snapshotFile = statefulFs.paths().find((p) => p.endsWith(`/${snapshots[0].id}.md`));
    expect(statefulFs.read(snapshotFile ?? "<no snapshot file>")).toBe(EDITED_ON_DISK);
    expect(await loadSnapshot(target, snapshots[0].id)).toBe(EDITED_ON_DISK.slice(BOM.length));
  });

  it("captures the write exactly once, as an MCP write naming its tool", async () => {
    const tabId = await openDocInTab(DOC, CRLF_BOM_ORIGINAL);

    const target = await run(tabId, "req-capture");
    await settle();

    expect(captures).toHaveLength(1);
    expect(captures[0].request).toMatchObject({
      path: target.slice(ROOT.length + 1),
      // The exact bytes on disk — not the editor-domain text.
      content: EDITED_ON_DISK,
      confidence: "inferred",
      agent: mcpCoherenceAgent(TEST_ATTRIBUTION),
      intent: { kind: "mcp-document-write", summary: tool },
    });
  });

  it("keeps the watcher's echo of its own write recognisable for the grace window", async () => {
    vi.useFakeTimers();
    const tabId = await openDocInTab(DOC, CRLF_BOM_ORIGINAL);

    const target = await run(tabId, "req-pending");

    // Registered with the bytes written, so the echo matches by content.
    expect(matchesPendingSave(target, EDITED_ON_DISK)).toBe(true);
    await vi.advanceTimersByTimeAsync(PENDING_SAVE_GRACE_MS - 1);
    expect(hasPendingSave(target)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(hasPendingSave(target)).toBe(false);
  });

  it("does not add the file to the human's recent files", async () => {
    const tabId = await openDocInTab(DOC, CRLF_BOM_ORIGINAL);
    useRecentFilesStore.setState({ files: [] });

    await run(tabId, "req-recent");

    expect(useRecentFilesStore.getState().files).toEqual([]);
  });

  it("a failed write stays quiet in the UI and leaves the document dirty and the disk untouched", async () => {
    const tabId = await openDocInTab(DOC, CRLF_BOM_ORIGINAL);
    const errorToast = vi.spyOn(imeToast, "error");
    const errorDetailToast = vi.spyOn(imeToast, "errorDetail");
    statefulFs.failWrites(new Error("EACCES: permission denied"));

    await run(tabId, "req-fail");

    // The client is told; the human is not also interrupted by a toast.
    expect(errorToast).not.toHaveBeenCalled();
    expect(errorDetailToast).not.toHaveBeenCalled();
    expect(statefulFs.read(DOC)).toBe(CRLF_BOM_ORIGINAL);
    expect(statefulFs.has(NEW)).toBe(false);
    expect(doc(tabId).isDirty).toBe(true);
    expect(doc(tabId).content).toBe(EDITED_LF);
    expect(doc(tabId).filePath).toBe(DOC);
    // A failed write left nothing to echo: nothing stays registered.
    expect(hasPendingSave(DOC)).toBe(false);
    expect(hasPendingSave(NEW)).toBe(false);
    await settle();
    expect(captures).toEqual([]);
  });
});

describe("document.write reports why a save did not happen", () => {
  it("a client sending CRLF text does not leave the document dirty", async () => {
    const tabId = await openDocInTab(DOC, CRLF_BOM_ORIGINAL);

    await handleDocumentWrite("req-crlf", {
      tabId,
      content: "# 标题\r\n\r\n正文\r\n新增一行\r\n",
    }, TEST_WRITE_CONTEXT);

    expect(writeData("req-crlf").saved).toBe(true);
    expect(doc(tabId).isDirty).toBe(false);
    expect(doc(tabId).content).toBe(EDITED_LF);
    expect(statefulFs.read(DOC)).toBe(EDITED_ON_DISK);
  });

  it("a rejected write surfaces the OS message as save_error, not save_skipped", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    statefulFs.failWrites(new Error("EACCES: permission denied"));

    await handleDocumentWrite("req-eacces", { tabId, content: "after\n" }, TEST_WRITE_CONTEXT);

    const data = writeData("req-eacces");
    expect(data.saved).toBe(false);
    expect(data.save_error).toContain("EACCES");
    expect(data.save_skipped).toBeUndefined();
    // The buffer keeps the client's content: re-writing it would lose intent.
    expect(doc(tabId).content).toBe("after\n");
  });

  it("a typed rejection is rendered as its message, never as [object Object]", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    statefulFs.failWrites({ code: "io", message: "disk quota exceeded" });

    await handleDocumentWrite("req-typed", { tabId, content: "after\n" }, TEST_WRITE_CONTEXT);

    expect(writeData("req-typed").save_error).toBe("disk quota exceeded");
  });

  it("a vanished parent folder names the folder and marks the document missing", async () => {
    const tabId = await openDocInTab(`${ROOT}/sub/deep.md`, "before\n");
    statefulFs.failWrites({
      code: "not-found",
      message: "parent missing",
      detail: { dir: `${ROOT}/sub` },
    });

    await handleDocumentWrite("req-gone", { tabId, content: "after\n" }, TEST_WRITE_CONTEXT);

    const data = writeData("req-gone");
    expect(data.saved).toBe(false);
    expect(data.save_error).toContain(`${ROOT}/sub`);
    expect(data.save_error).toContain("save_as");
    // The human's next Save is routed to Save As by this flag.
    expect(doc(tabId).isMissing).toBe(true);
  });

  it("a path the guard refuses is not written, and the refusal is the save_error", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    statefulFs.stubCommand("mcp_bridge_check_path", () => {
      throw new Error("path resolves outside the allowed roots");
    });

    await handleDocumentWrite("req-guard", { tabId, content: "after\n" }, TEST_WRITE_CONTEXT);

    const data = writeData("req-guard");
    expect(data.saved).toBe(false);
    expect(data.save_error).toBe("path resolves outside the allowed roots");
    expect(statefulFs.writesTo(DOC)).toEqual([]);
    expect(doc(tabId).content).toBe("after\n");
  });

  it("save:false leaves the disk alone and the document dirty", async () => {
    const tabId = await openDocInTab(DOC, "before\n");

    await handleDocumentWrite("req-optout", { tabId, content: "after\n", save: false }, TEST_WRITE_CONTEXT);

    const data = writeData("req-optout");
    expect(data).toMatchObject({ saved: false, save_skipped: "opt_out" });
    expect(data.save_error).toBeUndefined();
    expect(statefulFs.writesTo(DOC)).toEqual([]);
    expect(doc(tabId).isDirty).toBe(true);
  });

  it("an untitled tab is not saved and says so", async () => {
    const tabId = newUntitledTab();

    await handleDocumentWrite("req-untitled", { tabId, content: "draft\n" }, TEST_WRITE_CONTEXT);

    const data = writeData("req-untitled");
    expect(data).toMatchObject({ saved: false, save_skipped: "untitled" });
    expect(data.save_error).toBeUndefined();
    expect(statefulFs.writes.filter((w) => w.content === "draft\n")).toEqual([]);
    expect(doc(tabId).content).toBe("draft\n");
  });

  it("an empty document is a real save", async () => {
    const tabId = await openDocInTab(DOC, "before\n");

    await handleDocumentWrite("req-empty", { tabId, content: "" }, TEST_WRITE_CONTEXT);

    expect(writeData("req-empty").saved).toBe(true);
    expect(statefulFs.read(DOC)).toBe("");
    expect(doc(tabId).isDirty).toBe(false);
  });
});

describe("workspace.save and save_as report why a save did not happen", () => {
  it("save: a rejected write is an error reply carrying the OS message", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    editDoc(tabId, "after\n");
    statefulFs.failWrites(new Error("EACCES: permission denied"));

    await handleWorkspaceSave("req-s-fail", { tabId }, TEST_WRITE_CONTEXT);

    const r = responseTo("req-s-fail");
    expect(r.success).toBe(false);
    expect(r.error).toContain("EACCES");
  });

  it("save: a typed rejection keeps its machine-readable token", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    editDoc(tabId, "after\n");
    statefulFs.failWrites({ code: "permission-denied", message: "read-only volume" });

    await handleWorkspaceSave("req-s-typed", { tabId }, TEST_WRITE_CONTEXT);

    const r = responseTo("req-s-typed");
    expect(r.success).toBe(false);
    expect(r.error).toBe("PERMISSION_DENIED: read-only volume");
    expect(r.data).toMatchObject({ code: "permission-denied", token: "PERMISSION_DENIED" });
  });

  it("save: a vanished parent folder is INVALID_PATH pointing at save_as", async () => {
    const tabId = await openDocInTab(`${ROOT}/sub/deep.md`, "before\n");
    editDoc(tabId, "after\n");
    statefulFs.failWrites({
      code: "not-found",
      message: "parent missing",
      detail: { dir: `${ROOT}/sub` },
    });

    await handleWorkspaceSave("req-s-gone", { tabId }, TEST_WRITE_CONTEXT);

    const err = structuredErrorOf(responseTo("req-s-gone"));
    expect(err).toMatchObject({ error: "INVALID_PATH" });
    expect(err?.message).toContain(`${ROOT}/sub`);
    expect(err?.message).toContain("save_as");
  });

  it("save: a path the guard refuses is INVALID_PATH and nothing is written", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    editDoc(tabId, "after\n");
    statefulFs.stubCommand("mcp_bridge_check_path", () => {
      throw new Error("path resolves outside the allowed roots");
    });

    await handleWorkspaceSave("req-s-guard", { tabId }, TEST_WRITE_CONTEXT);

    expect(structuredErrorOf(responseTo("req-s-guard"))).toEqual({
      error: "INVALID_PATH",
      message: "path resolves outside the allowed roots",
    });
    expect(statefulFs.writesTo(DOC)).toEqual([]);
    expect(doc(tabId).isDirty).toBe(true);
  });

  it("save: an untitled tab is INVALID_PATH pointing at save_as", async () => {
    const tabId = newUntitledTab();
    editDoc(tabId, "draft\n");

    await handleWorkspaceSave("req-s-untitled", { tabId }, TEST_WRITE_CONTEXT);

    expect(structuredErrorOf(responseTo("req-s-untitled"))).toMatchObject({
      error: "INVALID_PATH",
    });
    expect(statefulFs.writes.filter((w) => w.content === "draft\n")).toEqual([]);
  });

  it("save: replies with the path and the document's current revision", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    editDoc(tabId, "after\n");

    await handleWorkspaceSave("req-s-ok", {}, TEST_WRITE_CONTEXT);

    const r = responseTo("req-s-ok");
    expect(r.success).toBe(true);
    expect(r.data).toEqual({
      filePath: DOC,
      revision: useRevisionStore.getState().getRevision(tabId),
      journaled: "yes",
    });
  });

  it("save_as: a rejected write does not re-point the tab or the document", async () => {
    const tabId = newUntitledTab();
    editDoc(tabId, "draft\n");
    statefulFs.failWrites(new Error("disk full"));

    await handleWorkspaceSaveAs("req-as-fail", { tabId, filePath: NEW }, TEST_WRITE_CONTEXT);

    const r = responseTo("req-as-fail");
    expect(r.success).toBe(false);
    expect(r.error).toContain("disk full");
    expect(doc(tabId).filePath).toBeNull();
    expect(tabFilePath(tabOf(tabId))).toBeNull();
    expect(doc(tabId).isDirty).toBe(true);
  });

  it("save_as: names an untitled document, its tab and its title from the new path", async () => {
    const tabId = newUntitledTab();
    editDoc(tabId, "初稿\n");

    await handleWorkspaceSaveAs("req-as-ok", { tabId, filePath: NEW }, TEST_WRITE_CONTEXT);

    const r = responseTo("req-as-ok");
    expect(r.success).toBe(true);
    expect(r.data).toEqual({
      revision: useRevisionStore.getState().getRevision(tabId),
      journaled: "yes",
    });
    expect(statefulFs.read(NEW)).toBe("初稿\n");
    expect(doc(tabId).filePath).toBe(NEW);
    expect(doc(tabId).isDirty).toBe(false);
    expect(tabFilePath(tabOf(tabId))).toBe(NEW);
    expect(tabOf(tabId).title).toBe("renamed.md");
  });
});

describe("a file another tab holds unsaved changes to", () => {
  /** A second window's tab on the same file, with unsaved writable edits. */
  function openDirtyCopyElsewhere(path: string): void {
    const s = useSettingsStore.getState();
    useSettingsStore.setState({ general: { ...s.general, workspaceRailMode: true } });
    useTabStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        "doc-1": [
          { kind: "document", id: "tab-elsewhere", filePath: path, title: "notes.md", isPinned: false, formatId: "markdown" },
        ],
      },
    }));
    useDocumentStore.getState().initDocument("tab-elsewhere", "before\n", path);
    useDocumentStore.getState().setEditorContent("tab-elsewhere", "their unsaved edit\n");
  }

  afterEach(() => {
    const s = useSettingsStore.getState();
    useSettingsStore.setState({ general: { ...s.general, workspaceRailMode: false } });
  });

  it("document.write keeps the buffer, writes nothing, and says who holds the file", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    openDirtyCopyElsewhere(DOC);
    const errorToast = vi.spyOn(imeToast, "error");

    await handleDocumentWrite("req-owned", { tabId, content: "after\n" }, TEST_WRITE_CONTEXT);

    const data = writeData("req-owned");
    expect(data.saved).toBe(false);
    expect(data.save_error).toContain("unsaved changes to this file");
    // By the identifiers session.get_state exposes, so the client can act.
    expect(data.save_error).toContain("tab tab-elsewhere in window doc-1");
    expect(statefulFs.writesTo(DOC)).toEqual([]);
    expect(doc(tabId).content).toBe("after\n");
    expect(doc(tabId).isDirty).toBe(true);
    // The human save toasts this conflict; an MCP save reports it instead.
    expect(errorToast).not.toHaveBeenCalled();
  });

  it("workspace.save is refused with the same reason", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    editDoc(tabId, "after\n");
    openDirtyCopyElsewhere(DOC);

    await handleWorkspaceSave("req-s-owned", { tabId }, TEST_WRITE_CONTEXT);

    const err = structuredErrorOf(responseTo("req-s-owned"));
    expect(err?.error).toBe("INTERNAL");
    expect(err?.message).toContain("unsaved changes to this file");
    expect(statefulFs.writesTo(DOC)).toEqual([]);
  });
});

describe("MCP writes are ordered with every other save", () => {
  it("a document.write issued while another's save is in flight is written after it", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    writeGate.hold(DOC);

    // The second request arrives once the first is applied and recorded and
    // only its save is in flight. (Two writes racing through the journal's
    // prepare are refused JOURNAL_BUSY instead: documentWriteJournal.test.tsx.)
    const first = handleDocumentWrite("req-a", { tabId, content: "A\n" }, TEST_WRITE_CONTEXT);
    await vi.waitFor(() => expect(writeGate.waitingAt(DOC)).toBe(1));
    const second = handleDocumentWrite("req-b", { tabId, content: "B\n" }, TEST_WRITE_CONTEXT);
    await settle();

    // Unserialized, both writes are in flight here and whichever the disk
    // finishes last wins — which need not be the one requested last.
    expect(writeGate.waitingAt(DOC)).toBe(1);

    writeGate.releaseOne(DOC);
    // The second write starts only once the first save has fully finished.
    await vi.waitFor(() => expect(writeGate.waitingAt(DOC)).toBe(1));
    expect(statefulFs.read(DOC)).toBe("A\n");

    writeGate.releaseOne(DOC);
    await Promise.all([first, second]);

    expect(statefulFs.writesTo(DOC).map((w) => w.content)).toEqual(["A\n", "B\n"]);
    expect(statefulFs.read(DOC)).toBe("B\n");
    expect(doc(tabId).content).toBe("B\n");
    expect(doc(tabId).isDirty).toBe(false);
    expect(writeData("req-a").saved).toBe(true);
    expect(writeData("req-b").saved).toBe(true);
  });

  it("an MCP write waits for an autosave of the same file that is already in flight", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    editDoc(tabId, "typed\n");
    writeGate.hold(DOC);

    const autosave = saveToPath(tabId, DOC, "typed\n", "auto");
    const write = handleDocumentWrite("req-after-auto", { tabId, content: "from the client\n" }, TEST_WRITE_CONTEXT);
    await settle();

    expect(writeGate.waitingAt(DOC)).toBe(1);

    writeGate.open(DOC);
    await Promise.all([autosave, write]);

    expect(statefulFs.writesTo(DOC).map((w) => w.content)).toEqual(["typed\n", "from the client\n"]);
    expect(doc(tabId).isDirty).toBe(false);
  });

  it("save_as racing an in-flight autosave ends on the new path", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    editDoc(tabId, "typed\n");
    writeGate.hold(DOC);

    // The autosave to the OLD path is submitted first and is slow.
    const autosave = saveToPath(tabId, DOC, "typed\n", "auto");
    await settle();
    expect(writeGate.waitingAt(DOC)).toBe(1);

    await handleWorkspaceSaveAs("req-race", { tabId, filePath: NEW }, TEST_WRITE_CONTEXT);
    expect(responseTo("req-race").success).toBe(true);
    expect(doc(tabId).filePath).toBe(NEW);

    // The autosave lands AFTER the Save As completed.
    writeGate.open(DOC);
    await autosave;

    expect(doc(tabId).filePath).toBe(NEW);
    expect(tabFilePath(tabOf(tabId))).toBe(NEW);
    expect(tabOf(tabId).title).toBe("renamed.md");
    expect(doc(tabId).savedContent).toBe("typed\n");
    expect(doc(tabId).lastDiskContent).toBe(statefulFs.read(NEW));
    expect(doc(tabId).isDirty).toBe(false);
  });

  it("of two save_as calls, the one requested last names the document", async () => {
    const tabId = newUntitledTab();
    editDoc(tabId, "draft\n");
    const first = `${ROOT}/first.md`;
    const second = `${ROOT}/second.md`;
    writeGate.hold(first);

    const slow = handleWorkspaceSaveAs("req-first", { tabId, filePath: first }, TEST_WRITE_CONTEXT);
    await settle();
    await handleWorkspaceSaveAs("req-second", { tabId, filePath: second }, TEST_WRITE_CONTEXT);
    writeGate.open(first);
    await slow;

    expect(doc(tabId).filePath).toBe(second);
    expect(tabFilePath(tabOf(tabId))).toBe(second);
    expect(useTabStore.getState().activeTabId[WINDOW]).toBe(tabId);
  });
});
