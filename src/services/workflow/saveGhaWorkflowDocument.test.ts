// Audit 20260907 (#294): the workbench's save handler owned module loading,
// snapshotting, serialization, disk I/O, store mutation AND the toasts. The
// pipeline is a service now, returning a typed outcome the component maps to
// its notifications. Real stores; only the disk write is a boundary mock.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSaveToPath = vi.fn();
vi.mock("@/services/persistence/saveToPath", () => ({
  saveToPath: (...args: unknown[]) => mockSaveToPath(...args),
}));

// The DIAGNOSIS channel (audit #991). `workflowWarn` is warn-tier, so it reaches
// the production log file a user can attach to a bug report — which is the point:
// the four ways a save can apply nothing are one message to the user and must
// not be one line to whoever has to explain it.
const mockWorkflowWarn = vi.fn();
vi.mock("@/utils/debug", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  workflowWarn: (...args: unknown[]) => mockWorkflowWarn(...args),
}));

import { saveGhaWorkflowDocument } from "./saveGhaWorkflowDocument";
import { useWorkflowStore } from "@/stores/workflowStore";
import { useDocumentStore } from "@/stores/documentStore";

const YAML = ["name: ci", "on: push", "jobs:", "  build:", "    runs-on: ubuntu-latest", ""].join("\n");
const PATH = "/repo/.github/workflows/ci.yml";

function setDocument(content: string, filePath: string | null): void {
  useDocumentStore.setState({
    documents: { "tab-1": { content, filePath } },
    setEditorContent: (id: string, next: string) => {
      useDocumentStore.setState((s: { documents: Record<string, object> }) => ({
        documents: { ...s.documents, [id]: { ...s.documents[id], content: next } },
      }) as never);
    },
  } as never);
}

const rename = { kind: "workflow.set", path: "name", value: "renamed" } as const;

beforeEach(() => {
  mockSaveToPath.mockReset();
  mockWorkflowWarn.mockReset();
  useWorkflowStore.getState().resetEdit();
  setDocument(YAML, PATH);
  useWorkflowStore.getState().bindToDocument(PATH);
});

describe("saveGhaWorkflowDocument", () => {
  it("reports nothing-pending for an empty queue and touches nothing", async () => {
    expect(await saveGhaWorkflowDocument("tab-1")).toBe("nothing-pending");
    expect(mockSaveToPath).not.toHaveBeenCalled();
  });

  it("reports missing-document when the tab has no document", async () => {
    useWorkflowStore.getState().queuePatch(rename);
    expect(await saveGhaWorkflowDocument("tab-none")).toBe("missing-document");
  });

  it("reports nothing-applied when the patches do not change the YAML, keeping the queue", async () => {
    setDocument("not: [valid", PATH);
    useWorkflowStore.getState().queuePatch(rename);
    expect(await saveGhaWorkflowDocument("tab-1")).toBe("nothing-applied");
    expect(mockSaveToPath).not.toHaveBeenCalled();
    expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(1);
  });

  it("writes to disk first and reports write-failed with the queue and document intact", async () => {
    mockSaveToPath.mockResolvedValue(false);
    useWorkflowStore.getState().queuePatch(rename);
    expect(await saveGhaWorkflowDocument("tab-1")).toBe("write-failed");
    expect(mockSaveToPath).toHaveBeenCalledTimes(1);
    expect(useDocumentStore.getState().documents["tab-1"].content).toBe(YAML);
    expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(1);
  });

  it("saved: the document reflects the write and the written patches are cleared", async () => {
    mockSaveToPath.mockResolvedValue(true);
    useWorkflowStore.getState().queuePatch(rename);
    expect(await saveGhaWorkflowDocument("tab-1")).toBe("saved");
    const [tabId, path, next, reason] = mockSaveToPath.mock.calls[0] as [string, string, string, string];
    expect([tabId, path, reason]).toEqual(["tab-1", PATH, "manual"]);
    expect(next).toContain("name: renamed");
    expect(useDocumentStore.getState().documents["tab-1"].content).toContain("name: renamed");
    expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(0);
  });

  it("updated-in-editor: an untitled workflow skips the disk and lands in the editor", async () => {
    setDocument(YAML, null);
    useWorkflowStore.getState().bindToDocument("untitled:tab-1");
    useWorkflowStore.getState().queuePatch(rename);
    expect(await saveGhaWorkflowDocument("tab-1")).toBe("updated-in-editor");
    expect(mockSaveToPath).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().documents["tab-1"].content).toContain("name: renamed");
    expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(0);
  });

  it("saves ITS document's queue even when another document holds the binding", async () => {
    mockSaveToPath.mockResolvedValue(true);
    useWorkflowStore.getState().queuePatch(rename);
    useWorkflowStore.getState().bindToDocument("/repo/other.yml");
    useWorkflowStore.getState().queuePatch({ kind: "workflow.set", path: "name", value: "other" });
    expect(await saveGhaWorkflowDocument("tab-1")).toBe("saved");
    const [, , next] = mockSaveToPath.mock.calls[0] as [string, string, string];
    expect(next).toContain("name: renamed");
    expect(next).not.toContain("other");
    expect(useWorkflowStore.getState().edit.patchesByDocument["/repo/other.yml"]).toHaveLength(1);
  });

  it("keeps a patch queued during the write and does not overwrite text typed meanwhile", async () => {
    useWorkflowStore.getState().queuePatch(rename);
    mockSaveToPath.mockImplementation(async () => {
      useWorkflowStore.getState().queuePatch({ kind: "workflow.set", path: "name", value: "later" });
      useDocumentStore.getState().setEditorContent("tab-1", `${YAML}# typed\n`);
      return true;
    });
    expect(await saveGhaWorkflowDocument("tab-1")).toBe("saved");
    expect(useDocumentStore.getState().documents["tab-1"].content).toBe(`${YAML}# typed\n`);
    expect(useWorkflowStore.getState().edit.pendingPatches).toEqual([
      { kind: "workflow.set", path: "name", value: "later" },
    ]);
  });
});

describe("saveGhaWorkflowDocument — identity and concurrency (audit round 2)", () => {
  // #988 — the commit rebound to whatever the TAB resolves to now, and
  // `workflowDocumentIdFor` is derived from the live document. A tab closed
  // during the write therefore bound the global store to a phantom
  // `untitled:<tab>` id and cleared a queue that had nothing to do with this
  // save; the WRITTEN document's queue was left uncleared.
  it("clears the queue of the document it wrote, even if the tab vanished during the write", async () => {
    let releaseWrite: ((ok: boolean) => void) | undefined;
    mockSaveToPath.mockImplementation(
      () => new Promise((resolve) => { releaseWrite = resolve; }),
    );
    useWorkflowStore.getState().queuePatch(rename);
    const saving = saveGhaWorkflowDocument("tab-1");
    await vi.waitFor(() => expect(mockSaveToPath).toHaveBeenCalledTimes(1));

    // The tab closes while the write is in flight.
    useDocumentStore.setState({ documents: {} } as never);
    releaseWrite?.(true);
    expect(await saving).toBe("saved");

    // The written document's queue is empty, and no phantom id took the binding.
    expect(useWorkflowStore.getState().edit.boundDocumentId).toBe(PATH);
    expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(0);
    expect(useWorkflowStore.getState().edit.patchesByDocument[PATH]).toBeUndefined();
  });

  // #990 — two overlapping saves each captured their own patch snapshot; the
  // first commit changed the content, so the second's `content === before`
  // check failed and it skipped the editor update while still clearing patches
  // that existed only in ITS serialized result.
  it("is single-flight per tab: a concurrent save joins the first instead of racing it", async () => {
    mockSaveToPath.mockResolvedValue(true);
    useWorkflowStore.getState().queuePatch(rename);

    const [a, b] = await Promise.all([
      saveGhaWorkflowDocument("tab-1"),
      saveGhaWorkflowDocument("tab-1"),
    ]);

    expect(a).toBe("saved");
    expect(b).toBe("saved");
    expect(mockSaveToPath).toHaveBeenCalledTimes(1);
    // …and the guard is released, so the next save runs on its own.
    useWorkflowStore.getState().queuePatch({ kind: "workflow.set", path: "name", value: "again" });
    expect(await saveGhaWorkflowDocument("tab-1")).toBe("saved");
    expect(mockSaveToPath).toHaveBeenCalledTimes(2);
  });

  // #1005 — the store has ONE binding slot, so a caller that read its queue and
  // then awaited could serialize whatever another pane bound meanwhile. The
  // document id is asserted rather than assumed.
  it("applyAndSerialize refuses to serialize another document's queue", () => {
    useWorkflowStore.getState().queuePatch(rename);
    const store = useWorkflowStore.getState();
    expect(store.applyAndSerialize(YAML, PATH)).not.toBe(YAML);
    expect(store.applyAndSerialize(YAML, "/some/other.yml")).toBe(YAML);
  });
});

// Audit #991 — string equality against the input conflated a document that will
// NEVER save with an edit that legitimately changes nothing. The user-facing
// outcome is deliberately still one value (the workbench's toast already says
// "did not change the YAML, or it could not be parsed"), but the reason is no
// longer unknowable.
describe("saveGhaWorkflowDocument names WHY nothing was applied", () => {
  it("distinguishes a document that does not parse", async () => {
    setDocument("not: [valid", PATH);
    useWorkflowStore.getState().queuePatch(rename);

    expect(await saveGhaWorkflowDocument("tab-1")).toBe("nothing-applied");
    expect(mockWorkflowWarn).toHaveBeenCalledTimes(1);
    expect(String(mockWorkflowWarn.mock.calls[0]?.[0])).toContain("does not parse");
  });

  it("distinguishes an edit that changes nothing", async () => {
    useWorkflowStore
      .getState()
      .queuePatch({ kind: "workflow.set", path: "name", value: "ci" } as never);

    expect(await saveGhaWorkflowDocument("tab-1")).toBe("nothing-applied");
    expect(String(mockWorkflowWarn.mock.calls[0]?.[0])).toContain("change nothing");
  });

  // The `wrong-document` outcome is NOT reachable through this entry point —
  // `runSave` rebinds to the tab's own document before reading the queue, which
  // is the #296 guarantee — so it is asserted at the store instead
  // (`workflowStore.test.ts`). Left named here so a reader does not go looking.

  it("says nothing on the happy path", async () => {
    mockSaveToPath.mockResolvedValue(true);
    useWorkflowStore.getState().queuePatch(rename);

    expect(await saveGhaWorkflowDocument("tab-1")).toBe("saved");
    expect(mockWorkflowWarn).not.toHaveBeenCalled();
  });
});
