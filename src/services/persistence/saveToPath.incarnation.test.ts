// A save queued or writing while its tab is closed and an equal tab id is opened again (a tab
// moved out of the window and back keeps its id) belongs to the CLOSED document: it must neither
// borrow the new document's file conventions nor mark the new document saved. And an MCP save
// whose bytes reached the disk consumed its client's reads even when bookkeeping after the write
// threw.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.fsModule();
});
vi.mock("@tauri-apps/api/core", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.coreModule();
});

import { statefulFs } from "@/test/statefulFsFake";
import { ROOT, doc, editDoc, openDocInTab, resetTier0 } from "@/test/tier0/harness";
import { useDocumentStore } from "@/stores/documentStore";
import { detachMcpReads, dropAllMcpConnectionReads, recordMcpRead } from "@/services/coherence/mcpCapture";
import { readInputsOf } from "@/test/mcpReadInputs";
import { saveToPath, saveToPathForMcp } from "./saveToPath";
import { __resetSerializer } from "./serializeByPath";
import { forgetSaveTarget, resetSaveTargetClaims } from "./saveTargetClaim";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";

const DOC = `${ROOT}/notes.md`;
const BOM = "\u{FEFF}";

/** Hold the next `atomic_write_file`; the returned `release` lets it land on the fake disk. */
function holdNextWrite(): { held: () => boolean; release: () => void } {
  let pending: { path: string; content: string; resolve: () => void } | null = null;
  statefulFs.stubCommand("atomic_write_file", (args) =>
    new Promise<void>((resolve) => {
      pending = { path: String(args.path), content: String(args.content), resolve };
    }));
  return {
    held: () => pending !== null,
    release: () => {
      if (!pending) throw new Error("no write is held");
      statefulFs.externalWrite(pending.path, pending.content);
      pending.resolve();
    },
  };
}

/** What tab cleanup does to a closed document's save state. */
function closeTab(tabId: string): void {
  useDocumentStore.getState().removeDocument(tabId);
  forgetSaveTarget(tabId);
}

beforeEach(() => {
  resetTier0();
  __resetSerializer();
  resetSaveTargetClaims();
  dropAllMcpConnectionReads();
  statefulFs.stubCommand("coherence_capture", () => null);
  statefulFs.stubCommand("coherence_head", () => null);
});

afterEach(() => {
  dropAllMcpConnectionReads();
  vi.restoreAllMocks();
});

describe("a save that outlives its document", () => {
  it("a completion after close and reopen under the same tab id leaves the new document unsaved-untouched", async () => {
    const tabId = await openDocInTab(DOC, "first\n");
    editDoc(tabId, "stale\n");
    const write = holdNextWrite();
    const saving = saveToPath(tabId, DOC, "stale\n");
    await vi.waitFor(() => expect(write.held()).toBe(true));

    closeTab(tabId);
    useDocumentStore.getState().initDocument(tabId, "fresh\n", DOC);
    editDoc(tabId, "fresh edit\n");
    write.release();
    await saving;

    expect(doc(tabId).savedContent).toBe("fresh\n");
    expect(doc(tabId).isDirty).toBe(true);
  });

  it("a queued save written after close and reopen keeps the closed document's conventions", async () => {
    const tabId = await openDocInTab(DOC, "a\nb\n");
    const first = holdNextWrite();
    const blocking = saveToPath(tabId, DOC, "a\nb\n");
    await vi.waitFor(() => expect(first.held()).toBe(true));
    // Queued behind the held write, submitted while the LF, BOM-less document is open.
    const queued = saveToPath(tabId, DOC, "a\nb\nc\n");

    closeTab(tabId);
    useDocumentStore.getState().initDocument(tabId, `${BOM}x\r\ny\r\n`, DOC);
    statefulFs.stubCommand("atomic_write_file", (args) => statefulFs.externalWrite(String(args.path), String(args.content)));
    first.release();
    await Promise.all([blocking, queued]);

    expect(statefulFs.read(DOC)).toBe("a\nb\nc\n");
  });

  it("an open document's queued save still uses the conventions current at its turn", async () => {
    const tabId = await openDocInTab(DOC, "a\nb\n");
    const first = holdNextWrite();
    const blocking = saveToPath(tabId, DOC, "a\nb\n");
    await vi.waitFor(() => expect(first.held()).toBe(true));
    const queued = saveToPath(tabId, DOC, "a\nb\nc\n");

    // The file gains a byte-order mark (as a reload would record) while the save waits its turn.
    useDocumentStore.setState((state) => ({
      documents: { ...state.documents, [tabId]: { ...doc(tabId), hasBom: true } },
    }));
    statefulFs.stubCommand("atomic_write_file", (args) => statefulFs.externalWrite(String(args.path), String(args.content)));
    first.release();
    await Promise.all([blocking, queued]);

    expect(statefulFs.read(DOC)).toBe(`${BOM}a\nb\nc\n`);
  });
});

describe("an MCP save whose bytes reached the disk", () => {
  it("consumes its client's reads even when bookkeeping after the write throws", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    recordMcpRead(TEST_ATTRIBUTION.connectionId, `${ROOT}/source.md`, "source");
    useDocumentStore.setState({
      markSaved: () => {
        throw new Error("store update failed");
      },
    });

    await expect(saveToPathForMcp(tabId, DOC, "b\n", "document.write", TEST_ATTRIBUTION)).rejects.toThrow(
      "store update failed",
    );

    expect(statefulFs.read(DOC)).toBe("b\n");
    expect(readInputsOf(detachMcpReads(TEST_ATTRIBUTION.connectionId), ROOT)).toEqual([]);
  });
});
