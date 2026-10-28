// WI-RA1A.2 — the save pipeline's MCP door (`saveToPathForMcp`): the same
// pipeline as a human save, with the differences an AI client's write needs
// decided in one place.
//
// Real stores and the real pipeline over the stateful disk fake; only
// `@tauri-apps/*` is mocked. The bridge handlers that call this door are
// covered in services/mcpBridge/v2/__tests__/mcpSavePipeline.test.ts — this
// file pins the pipeline's own contract, for whoever calls it next.
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
import { ROOT, WINDOW, doc, editDoc, openDocInTab, resetTier0 } from "@/test/tier0/harness";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { imeToast } from "@/services/ime/imeToast";
import { resetContextGenerations } from "@/services/workspaces/workspaceContextGeneration";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { saveToPath, saveToPathForMcp } from "./saveToPath";
import { __resetSerializer } from "./serializeByPath";
import { resetSaveTargetClaims } from "./saveTargetClaim";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";
import { cleanupTabState } from "@/services/windowClose/tabCleanup";

const DOC = `${ROOT}/notes.md`;
const BOM = "\u{FEFF}";

function setRailMode(on: boolean): void {
  const s = useSettingsStore.getState();
  useSettingsStore.setState({ general: { ...s.general, workspaceRailMode: on } });
}

function spyOnToasts() {
  return {
    error: vi.spyOn(imeToast, "error").mockImplementation(() => "toast-id"),
    errorDetail: vi.spyOn(imeToast, "errorDetail").mockImplementation(() => "toast-id"),
  };
}

beforeEach(() => {
  resetTier0();
  __resetSerializer();
  resetSaveTargetClaims();
  statefulFs.stubCommand("coherence_capture", () => null);
  statefulFs.stubCommand("coherence_head", () => null);
});

afterEach(() => {
  setRailMode(false);
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  vi.restoreAllMocks();
});

describe("saveToPathForMcp reports how the save ended", () => {
  it("returns the exact text that reached the disk", async () => {
    const tabId = await openDocInTab(DOC, `${BOM}一\r\n二\r\n`);
    editDoc(tabId, "一\n二\n三\n");

    const outcome = await saveToPathForMcp(tabId, DOC, "一\n二\n三\n", "document.write", TEST_ATTRIBUTION);

    expect(outcome).toMatchObject({ ok: true, written: `${BOM}一\r\n二\r\n三\r\n`, journaled: "yes" });
    expect(statefulFs.read(DOC)).toBe(`${BOM}一\r\n二\r\n三\r\n`);
  });

  it("names the vanished folder, marks the document missing, and does not toast", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    const toasts = spyOnToasts();
    statefulFs.failWrites({ code: "not-found", message: "parent missing", detail: { dir: ROOT } });

    const outcome = await saveToPathForMcp(tabId, DOC, "after\n", "workspace.save", TEST_ATTRIBUTION);

    expect(outcome).toEqual({ ok: false, reason: "parent-missing", dir: ROOT });
    expect(doc(tabId).isMissing).toBe(true);
    expect(toasts.error).not.toHaveBeenCalled();
    expect(toasts.errorDetail).not.toHaveBeenCalled();
  });

  it("hands back the raw rejection of a failed write, and does not toast", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    const toasts = spyOnToasts();
    const rejection = { code: "io", message: "disk quota exceeded" };
    statefulFs.failWrites(rejection);

    const outcome = await saveToPathForMcp(tabId, DOC, "after\n", "workspace.save", TEST_ATTRIBUTION);

    expect(outcome.ok).toBe(false);
    // The same object, untouched: the bridge renders a typed error from it.
    expect(outcome).toMatchObject({ reason: "write-failed" });
    expect((outcome as { error: unknown }).error).toBe(rejection);
    expect(toasts.error).not.toHaveBeenCalled();
    expect(toasts.errorDetail).not.toHaveBeenCalled();
  });

  it("names the tabs holding unsaved changes to the same file, and does not toast", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    setRailMode(true);
    useTabStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        "doc-1": [
          { kind: "document", id: "tab-elsewhere", filePath: DOC, title: "notes.md", isPinned: false, formatId: "markdown" },
        ],
      },
    }));
    useDocumentStore.getState().initDocument("tab-elsewhere", "before\n", DOC);
    useDocumentStore.getState().setEditorContent("tab-elsewhere", "their unsaved edit\n");
    const toasts = spyOnToasts();

    const outcome = await saveToPathForMcp(tabId, DOC, "after\n", "document.write", TEST_ATTRIBUTION);

    expect(outcome).toMatchObject({ ok: false, reason: "ownership-conflict" });
    const conflicts = (outcome as { conflicts: Array<{ tabId: string; windowLabel: string }> }).conflicts;
    expect(conflicts.map((c) => [c.tabId, c.windowLabel])).toEqual([["tab-elsewhere", "doc-1"]]);
    expect(statefulFs.writesTo(DOC)).toEqual([]);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("a save queued before its tab closed and reopened under the same id respects the newcomer's unsaved changes", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    setRailMode(true);
    // Hold the per-path queue: the first save's write waits for the gate.
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let writing = 0;
    statefulFs.stubCommand("atomic_write_file", async (args) => {
      writing++;
      await gate;
      statefulFs.externalWrite(String(args.path), String(args.content));
    });
    const first = saveToPath(tabId, DOC, "first\n", "manual");
    await vi.waitFor(() => expect(writing).toBe(1));
    const stale = saveToPathForMcp(tabId, DOC, "stale\n", "document.write", TEST_ATTRIBUTION);
    // The tab closes (its document and save claims go), and a new document opens under the same id with unsaved edits.
    cleanupTabState(tabId);
    useDocumentStore.getState().initDocument(tabId, "first\n", DOC);
    editDoc(tabId, "the newcomer's unsaved edit\n");
    open();

    expect(await first).toBe(true);
    const outcome = await stale;
    expect(outcome).toMatchObject({ ok: false, reason: "ownership-conflict" });
    const conflicts = (outcome as { conflicts: Array<{ tabId: string }> }).conflicts;
    expect(conflicts.map((c) => c.tabId)).toEqual([tabId]);
    expect(statefulFs.read(DOC)).toBe("first\n");
  });

  it("the human door still answers with a boolean and still toasts a failure", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    const toasts = spyOnToasts();

    expect(await saveToPath(tabId, DOC, "after\n", "manual")).toBe(true);

    statefulFs.failWrites(new Error("EACCES"));
    expect(await saveToPath(tabId, DOC, "again\n", "manual")).toBe(false);
    expect(toasts.errorDetail).toHaveBeenCalledTimes(1);
  });
});

describe("what an MCP save does not inherit from a human save", () => {
  it("is recorded as a save, not an autosave", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    editDoc(tabId, "after\n");

    await saveToPathForMcp(tabId, DOC, "after\n", "workspace.save", TEST_ATTRIBUTION);

    expect(doc(tabId).isDirty).toBe(false);
    expect(doc(tabId).lastAutoSave).toBeNull();
  });

  describe("across a workspace boundary", () => {
    function addWorkspace(id: string, rootPath: string): void {
      const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
      if (!root.ok) throw new Error("bad test root");
      useWorkspaceInstancesStore.getState().addWorkspaceInstance(
        createWorkspaceInstance({
          workspaceInstanceId: id,
          root: root.root,
          ownerWindowLabel: WINDOW,
          createdFrom: "open",
        }),
      );
    }

    /** An active tab in workspace A, about to be saved into workspace B. */
    function activeTabInWorkspaceA(): string {
      resetContextGenerations();
      setRailMode(true);
      useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
      addWorkspace("wsi-a", "/repo-a");
      addWorkspace("wsi-b", "/repo-b");
      useWorkspaceInstancesStore.getState().activateWorkspaceInstance(WINDOW, "wsi-a");
      statefulFs.mkdirp("/repo-b");
      const tabId = useTabStore.getState().createTab(WINDOW, "/repo-a/draft.md");
      useDocumentStore.getState().initDocument(tabId, "draft\n", "/repo-a/draft.md");
      useTabStore.getState().setActiveTab(WINDOW, tabId);
      return tabId;
    }

    const visibleWorkspace = () =>
      useWorkspaceInstancesStore.getState().windows[WINDOW].activeWorkspaceInstanceId;

    it("an MCP Save As reclassifies the tab but never switches the visible workspace", async () => {
      const tabId = activeTabInWorkspaceA();

      const outcome = await saveToPathForMcp(tabId, "/repo-b/final.md", "draft\n", "workspace.save_as", TEST_ATTRIBUTION);

      expect(outcome.ok).toBe(true);
      expect(useWorkspaceInstancesStore.getState().instances["wsi-b"].tabIds).toContain(tabId);
      expect(visibleWorkspace()).toBe("wsi-a");
    });

    it("a human Save As takes the visible workspace with it", async () => {
      const tabId = activeTabInWorkspaceA();

      expect(await saveToPath(tabId, "/repo-b/final.md", "draft\n", "manual")).toBe(true);

      expect(visibleWorkspace()).toBe("wsi-b");
    });
  });
});
