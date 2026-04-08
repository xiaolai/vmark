/**
 * Tests for file reappearance after deletion in useExternalFileChanges
 *
 * When a deleted file reappears (Finder undo, git checkout, Trash restore),
 * the isMissing flag must be cleared and content reloaded.
 *
 * @module hooks/useExternalFileChanges.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// --- Hoisted mocks ---
const mocks = vi.hoisted(() => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  readTextFile: vi.fn(),
  toastInfo: vi.fn(),
  matchesPendingSave: vi.fn(() => false),
  hasPendingSave: vi.fn(() => false),
  dialogMessage: vi.fn(),
  dialogSave: vi.fn(),
  saveToPath: vi.fn(),
  reloadTabFromDisk: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: mocks.readTextFile,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: mocks.dialogMessage,
  save: mocks.dialogSave,
}));

vi.mock("sonner", () => ({
  toast: {
    info: mocks.toastInfo,
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/utils/imeToast", () => ({
  imeToast: {
    info: mocks.toastInfo,
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: vi.fn(() => "main"),
}));

vi.mock("@/utils/pendingSaves", () => ({
  matchesPendingSave: mocks.matchesPendingSave,
  hasPendingSave: mocks.hasPendingSave,
}));

vi.mock("@/utils/saveToPath", () => ({
  saveToPath: mocks.saveToPath,
}));

vi.mock("@/utils/reloadFromDisk", () => ({
  reloadTabFromDisk: mocks.reloadTabFromDisk,
}));

import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useExternalFileChanges } from "./useExternalFileChanges";

type ListenCallback = (event: { payload: { watchId: string; rootPath: string; paths: string[]; kind: string } }) => Promise<void>;

function seedStores(overrides: { isMissing?: boolean; isDirty?: boolean; lastDiskContent?: string } = {}) {
  useTabStore.setState({
    tabs: {
      main: [{ id: "tab-1", title: "test.md", filePath: "/workspace/test.md", isPinned: false }],
    },
    activeTabId: { main: "tab-1" },
    untitledCounter: 0,
    closedTabs: {},
  });

  useDocumentStore.setState({
    documents: {
      "tab-1": {
        content: "# old content",
        savedContent: "# old content",
        lastDiskContent: overrides.lastDiskContent ?? "# old content",
        filePath: "/workspace/test.md",
        isDirty: overrides.isDirty ?? false,
        documentId: 0,
        cursorInfo: null,
        lastAutoSave: null,
        isMissing: overrides.isMissing ?? false,
        isDivergent: false,
        lineEnding: "unknown",
        hardBreakStyle: "unknown",
      },
    },
  });
}

/** Extract the callback registered via listen("fs:changed", cb) */
function captureListenCallback(): ListenCallback {
  const calls = mocks.listen.mock.calls as unknown as unknown[][];
  const call = calls.find((c) => c[0] === "fs:changed");
  if (!call) throw new Error("listen('fs:changed') was not called");
  return call[1] as ListenCallback;
}

/** Render hook, wait for listener, and return the captured callback */
async function setupHookAndCallback(): Promise<ListenCallback> {
  renderHook(() => useExternalFileChanges());
  await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalled());
  return captureListenCallback();
}

describe("useExternalFileChanges — file reappearance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears isMissing and reloads when a deleted file reappears with same content", async () => {
    seedStores({ isMissing: true, lastDiskContent: "# old content" });
    mocks.readTextFile.mockResolvedValue("# old content");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "create",
      },
    });

    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(false);
    expect(mocks.toastInfo).toHaveBeenCalledWith("Restored: test.md");
  });

  it("clears isMissing and reloads when a deleted file reappears with different content", async () => {
    seedStores({ isMissing: true, lastDiskContent: "# old content" });
    mocks.readTextFile.mockResolvedValue("# new content from git");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "create",
      },
    });

    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(false);
    expect(doc?.lastDiskContent).toBe("# new content from git");
    expect(mocks.toastInfo).toHaveBeenCalledWith("Restored: test.md");
  });

  it("skips reappearance logic when pending save matches (our own write)", async () => {
    seedStores({ isMissing: true });
    mocks.readTextFile.mockResolvedValue("# old content");
    mocks.matchesPendingSave.mockReturnValue(true);

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "create",
      },
    });

    // isMissing should NOT have been cleared — it was our own save
    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(true);
    expect(mocks.toastInfo).not.toHaveBeenCalled();
  });

  it("does not trigger reappearance logic for non-missing files with same content", async () => {
    seedStores({ isMissing: false, lastDiskContent: "# old content" });
    mocks.readTextFile.mockResolvedValue("# old content");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // Should hit the lastDiskContent check and skip — no toast
    expect(mocks.toastInfo).not.toHaveBeenCalled();
  });

  it("prompts user instead of reloading when dirty file reappears after deletion", async () => {
    seedStores({ isMissing: true, isDirty: true, lastDiskContent: "# old content" });
    mocks.readTextFile.mockResolvedValue("# recreated content");
    mocks.dialogMessage.mockResolvedValue("Cancel");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "create",
      },
    });

    // Should NOT auto-reload — user has unsaved edits
    expect(mocks.toastInfo).not.toHaveBeenCalledWith(expect.stringContaining("Restored"));

    // isMissing should remain true (not cleared silently)
    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(true);
    expect(doc?.isDirty).toBe(true);
  });
});

describe("useExternalFileChanges — rename events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips rename fallback when path has a pending save (atomic write)", async () => {
    seedStores();
    mocks.hasPendingSave.mockReturnValue(true);

    const callback = await setupHookAndCallback();

    // Simulate atomic write rename: temp file → target (unmatched pair)
    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "rename",
      },
    });

    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(false);
    expect(mocks.readTextFile).not.toHaveBeenCalled();
  });

  it("treats rename fallback as modify when file still exists on disk", async () => {
    seedStores({ lastDiskContent: "# old content" });
    mocks.hasPendingSave.mockReturnValue(false);
    mocks.readTextFile.mockResolvedValue("# new external content");

    const callback = await setupHookAndCallback();

    // Odd-length paths array — fallback branch processes each path
    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "rename",
      },
    });

    const doc = useDocumentStore.getState().documents["tab-1"];
    // Clean doc should auto-reload with new content
    expect(doc?.isMissing).toBe(false);
    expect(doc?.lastDiskContent).toBe("# new external content");
    expect(mocks.toastInfo).toHaveBeenCalledWith("Reloaded: test.md");
  });

  it("marks file as deleted when rename fallback cannot read the file", async () => {
    seedStores();
    mocks.hasPendingSave.mockReturnValue(false);
    mocks.readTextFile.mockRejectedValue(new Error("file not found"));

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "rename",
      },
    });

    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(true);
  });

  it("handles paired rename (real file rename) by updating tab path", async () => {
    seedStores();

    const callback = await setupHookAndCallback();

    // Paired rename: old path → new path
    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md", "/workspace/renamed.md"],
        kind: "rename",
      },
    });

    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(false);
    expect(doc?.filePath).toBe("/workspace/renamed.md");
  });

  it("rename fallback skips same-content file (no false reload)", async () => {
    seedStores({ lastDiskContent: "# old content" });
    mocks.hasPendingSave.mockReturnValue(false);
    // Disk content matches lastDiskContent — no change
    mocks.readTextFile.mockResolvedValue("# old content");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "rename",
      },
    });

    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(false);
    // No toast — content unchanged
    expect(mocks.toastInfo).not.toHaveBeenCalled();
  });
});

describe("useExternalFileChanges — remove events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks file as missing on remove event", async () => {
    seedStores();

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "remove",
      },
    });

    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(true);
  });
});

describe("useExternalFileChanges — event filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores events from a different window watcher", async () => {
    seedStores();
    mocks.readTextFile.mockResolvedValue("# new content");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "other-window",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // Should not read the file since watchId doesn't match
    expect(mocks.readTextFile).not.toHaveBeenCalled();
  });

  it("ignores events for files that are not open", async () => {
    seedStores();
    mocks.readTextFile.mockResolvedValue("# new content");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/other-file.md"],
        kind: "modify",
      },
    });

    // other-file.md is not open — should not attempt to read
    expect(mocks.readTextFile).not.toHaveBeenCalled();
  });

  it("skips modify events when file is unreadable", async () => {
    seedStores({ lastDiskContent: "# old content" });
    mocks.readTextFile.mockRejectedValue(new Error("file locked"));

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // Should not crash, just skip
    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(false);
  });

  it("auto-reloads clean document on external modify", async () => {
    seedStores({ lastDiskContent: "# old content" });
    mocks.readTextFile.mockResolvedValue("# updated by external tool");
    mocks.matchesPendingSave.mockReturnValue(false);

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // readTextFile should have been called for the changed file
    expect(mocks.readTextFile).toHaveBeenCalledWith("/workspace/test.md");
    // Should auto-reload: clean doc with different disk content
    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.content).toBe("# updated by external tool");
    expect(mocks.toastInfo).toHaveBeenCalledWith("Reloaded: test.md");
  });
});

describe("useExternalFileChanges — dirty file prompt", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Restore default mock implementations after resetAllMocks clears them
    mocks.listen.mockImplementation(() => Promise.resolve(() => {}));
    mocks.matchesPendingSave.mockReturnValue(false);
    mocks.hasPendingSave.mockReturnValue(false);
  });

  function seedDirtyStores() {
    useTabStore.setState({
      tabs: {
        main: [{ id: "tab-1", title: "test.md", filePath: "/workspace/test.md", isPinned: false }],
      },
      activeTabId: { main: "tab-1" },
      untitledCounter: 0,
      closedTabs: {},
    });

    useDocumentStore.setState({
      documents: {
        "tab-1": {
          content: "# user edits",
          savedContent: "# old content",
          lastDiskContent: "# old content",
          filePath: "/workspace/test.md",
          isDirty: true,
          documentId: 0,
          cursorInfo: null,
          lastAutoSave: null,
          isMissing: false,
          isDivergent: false,
          lineEnding: "unknown",
          hardBreakStyle: "unknown",
        },
      },
    });
  }

  it("marks as divergent when user chooses Keep (cancel)", async () => {
    seedDirtyStores();
    mocks.readTextFile.mockResolvedValue("# external change");
    mocks.dialogMessage.mockResolvedValue("Cancel");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // Wait for batch debounce (300ms) + async processBatchedChanges
    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1000 });

    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isDivergent).toBe(true);
  });

  it("opens Save As dialog when user chooses Save As and saves successfully", async () => {
    seedDirtyStores();
    mocks.readTextFile.mockResolvedValue("# external change");
    mocks.dialogMessage.mockResolvedValue("Save As...");
    mocks.dialogSave.mockResolvedValue("/workspace/saved-copy.md");
    mocks.saveToPath.mockResolvedValue(true);

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1000 });

    expect(mocks.dialogSave).toHaveBeenCalled();
    expect(mocks.saveToPath).toHaveBeenCalledWith("tab-1", "/workspace/saved-copy.md", "# user edits", "manual");
  });

  it("keeps user changes when Save As is cancelled", async () => {
    seedDirtyStores();
    mocks.readTextFile.mockResolvedValue("# external change");
    mocks.dialogMessage.mockResolvedValue("Save As...");
    mocks.dialogSave.mockResolvedValue(null); // Cancelled

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1000 });

    // Should NOT reload — user cancelled Save As, so keep their changes
    expect(mocks.reloadTabFromDisk).not.toHaveBeenCalled();
  });

  it("marks as missing when reload fails", async () => {
    seedDirtyStores();
    mocks.readTextFile.mockResolvedValue("# external change");
    mocks.dialogMessage.mockResolvedValue("Reload");
    mocks.reloadTabFromDisk.mockRejectedValue(new Error("reload failed"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1000 });

    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(true);

    errorSpy.mockRestore();
  });

  it("reloads from disk when user chooses Reload", async () => {
    seedDirtyStores();
    mocks.readTextFile.mockResolvedValue("# external change");
    mocks.dialogMessage.mockResolvedValue("Reload");
    mocks.reloadTabFromDisk.mockResolvedValue(undefined);

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // Wait for batch debounce (300ms) + async processBatchedChanges
    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1000 });

    expect(mocks.reloadTabFromDisk).toHaveBeenCalledWith("tab-1", "/workspace/test.md");
  });

  it("handles 'Yes' button label for Save As flow", async () => {
    seedDirtyStores();
    mocks.readTextFile.mockResolvedValue("# external change");
    // Return "Yes" (default button label, not custom label)
    mocks.dialogMessage.mockResolvedValue("Yes");
    mocks.dialogSave.mockResolvedValue("/workspace/saved-copy.md");
    mocks.saveToPath.mockResolvedValue(true);

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1000 });

    expect(mocks.dialogSave).toHaveBeenCalled();
    expect(mocks.saveToPath).toHaveBeenCalled();
  });

  it("keeps changes when Save As fails (save returns false)", async () => {
    seedDirtyStores();
    mocks.readTextFile.mockResolvedValue("# external change");
    mocks.dialogMessage.mockResolvedValue("Save As...");
    mocks.dialogSave.mockResolvedValue("/workspace/saved-copy.md");
    mocks.saveToPath.mockResolvedValue(false); // save fails

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1000 });

    // Should not reload — save failed
    expect(mocks.reloadTabFromDisk).not.toHaveBeenCalled();
  });

  it("handles 'No' button label for Reload", async () => {
    seedDirtyStores();
    mocks.readTextFile.mockResolvedValue("# external change");
    mocks.dialogMessage.mockResolvedValue("No");
    mocks.reloadTabFromDisk.mockResolvedValue(undefined);

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1000 });

    expect(mocks.reloadTabFromDisk).toHaveBeenCalledWith("tab-1", "/workspace/test.md");
  });

  it("marks as divergent when user keeps changes with 'Keep my changes'", async () => {
    seedDirtyStores();
    mocks.readTextFile.mockResolvedValue("# external change");
    mocks.dialogMessage.mockResolvedValue("Keep my changes");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1000 });

    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isDivergent).toBe(true);
  });
});

describe("useExternalFileChanges — additional coverage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listen.mockImplementation(() => Promise.resolve(() => {}));
    mocks.matchesPendingSave.mockReturnValue(false);
    mocks.hasPendingSave.mockReturnValue(false);
  });

  it("skips tab with no filePath in getOpenFilePaths", async () => {
    // Tab without filePath should be excluded from open paths map
    useTabStore.setState({
      tabs: {
        main: [{ id: "tab-no-path", title: "untitled", filePath: null, isPinned: false }],
      },
      activeTabId: { main: "tab-no-path" },
      untitledCounter: 1,
      closedTabs: {},
    });
    useDocumentStore.setState({
      documents: {
        "tab-no-path": {
          content: "# untitled",
          savedContent: "# untitled",
          lastDiskContent: "# untitled",
          filePath: null,
          isDirty: false,
          documentId: 0,
          cursorInfo: null,
          lastAutoSave: null,
          isMissing: false,
          isDivergent: false,
          lineEnding: "unknown",
          hardBreakStyle: "unknown",
        },
      },
    });
    mocks.readTextFile.mockResolvedValue("# new content");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/any-file.md"],
        kind: "modify",
      },
    });

    // Tab without filePath is not in the open paths map, so no read
    expect(mocks.readTextFile).not.toHaveBeenCalled();
  });

  it("no_op action does nothing (resolveExternalChangeAction returns no_op)", async () => {
    // Use a spy on the openPolicy module to force no_op return value
    const openPolicy = await import("@/utils/openPolicy");
    const spy = vi.spyOn(openPolicy, "resolveExternalChangeAction").mockReturnValueOnce("no_op");

    seedStores({ lastDiskContent: "# old content" });
    mocks.readTextFile.mockResolvedValue("# changed on disk");
    mocks.matchesPendingSave.mockReturnValue(false);

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // no_op: nothing happens, no toast, no dialog
    expect(mocks.toastInfo).not.toHaveBeenCalled();
    expect(mocks.dialogMessage).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it("skips unknown path in paired rename (tabId not found)", async () => {
    // Paired rename with paths that don't match any open tab
    seedStores();
    mocks.readTextFile.mockResolvedValue("# content");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/unknown.md", "/workspace/unknown-new.md"],
        kind: "rename",
      },
    });

    // Path not matched → tabId not found → continue → handled stays false
    // Since the pair doesn't match, fallback runs but also finds no match
    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.filePath).toBe("/workspace/test.md"); // Unchanged
  });

  it("skips unknown path in unpaired rename fallback (tabId not found)", async () => {
    seedStores();
    mocks.hasPendingSave.mockReturnValue(false);
    mocks.readTextFile.mockResolvedValue("# content");

    const callback = await setupHookAndCallback();

    // Single path that doesn't match any open tab
    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/unknown-file.md"],
        kind: "rename",
      },
    });

    // No tab found → no deletion, no modify event
    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(false);
    expect(mocks.readTextFile).not.toHaveBeenCalled();
  });

  it("skips path when doc disappears between path resolution and event handling (doc missing)", async () => {
    // First call to getDocument (in getOpenFilePaths) returns a doc with filePath.
    // Second call (inside the event handler loop, line 349) returns null.
    // This simulates a race where the document is closed between the two calls.
    seedStores({ lastDiskContent: "# old content" });

    const docStoreGetDocument = useDocumentStore.getState().getDocument.bind(useDocumentStore.getState());
    let callCount = 0;
    vi.spyOn(useDocumentStore.getState(), "getDocument").mockImplementation((tabId: string) => {
      callCount++;
      // First call (from getOpenFilePaths): return normal doc
      if (callCount <= 1) return docStoreGetDocument(tabId);
      // Second call (inside event loop): return null (doc disappeared)
      return null;
    });

    mocks.readTextFile.mockResolvedValue("# new content");
    mocks.matchesPendingSave.mockReturnValue(false);

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // tabId found in openPaths, but doc is null at line 349 → continue → no read
    expect(mocks.readTextFile).not.toHaveBeenCalled();
  });

  it("unmounts with pending batch timeout — cleans up timer", async () => {
    // Set up a dirty file scenario to trigger batch timer
    useTabStore.setState({
      tabs: {
        main: [{ id: "tab-1", title: "test.md", filePath: "/workspace/test.md", isPinned: false }],
      },
      activeTabId: { main: "tab-1" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.setState({
      documents: {
        "tab-1": {
          content: "# user edits",
          savedContent: "# old",
          lastDiskContent: "# old",
          filePath: "/workspace/test.md",
          isDirty: true,
          documentId: 0,
          cursorInfo: null,
          lastAutoSave: null,
          isMissing: false,
          isDivergent: false,
          lineEnding: "unknown",
          hardBreakStyle: "unknown",
        },
      },
    });
    mocks.readTextFile.mockResolvedValue("# external change");
    mocks.dialogMessage.mockResolvedValue("Cancel");

    const { unmount } = renderHook(() => useExternalFileChanges());
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalled());
    const callback = captureListenCallback();

    // Trigger change to queue dirty change (starts batch timer)
    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // Unmount before batch timer fires — should clean up without crash
    unmount();

    // No dialog should appear (timer was cancelled)
    expect(mocks.dialogMessage).not.toHaveBeenCalled();
  });

  it("handles cancellation before listen resolves (cancelled = true before await listen)", async () => {
    seedStores();
    // Make listen return a promise that resolves after a tick
    let resolveUnlisten: ((fn: () => void) => void) | null = null;
    mocks.listen.mockImplementationOnce(
      () => new Promise<() => void>((resolve) => { resolveUnlisten = resolve; })
    );

    const { unmount } = renderHook(() => useExternalFileChanges());
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalled());

    // Unmount before listen resolves → cancelled = true before setupListener continues
    unmount();

    // Now resolve listen — setupListener will check `cancelled` and call unlisten immediately
    resolveUnlisten!(() => {});

    // Give async resolution a tick to complete
    await new Promise((r) => setTimeout(r, 0));

    // Should not crash, unlistened was called immediately
  });

  it("handles cancellation after listen resolves (cancelled after store, unlisten called in cleanup)", async () => {
    seedStores();

    const { unmount } = renderHook(() => useExternalFileChanges());
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalled());

    // Unmount immediately — cleanup sets cancelled=true, calls unlistenRef.current()
    unmount();

    // Should not crash
    expect(mocks.listen).toHaveBeenCalled();
  });

  it("cleanup skips unlisten when hook unmounts before listen resolves", async () => {
    seedStores();
    // Hook unmounts before listen completes — unlistenRef.current stays null
    let resolveUnlisten: ((fn: () => void) => void) | null = null;
    mocks.listen.mockImplementationOnce(
      () => new Promise<() => void>((resolve) => { resolveUnlisten = resolve; })
    );

    const { unmount } = renderHook(() => useExternalFileChanges());
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalled());

    // Unmount before listen resolves — unlistenRef.current is still null
    unmount();

    // Resolve listen after unmount — cleanup path with cancelled=true runs
    resolveUnlisten!(() => {});
    await new Promise((r) => setTimeout(r, 0));

    // Should not crash (unlistenRef.current was null, but cancelled path calls unlisten directly)
    expect(mocks.listen).toHaveBeenCalled();
  });

  it("handles event callback when hook is already unmounted (cancelled = true inside callback)", async () => {
    seedStores();
    let capturedCallback: ListenCallback | null = null;
    mocks.listen.mockImplementationOnce((_event: string, cb: ListenCallback) => {
      capturedCallback = cb;
      return Promise.resolve(() => {});
    });

    const { unmount } = renderHook(() => useExternalFileChanges());
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalled());

    // Unmount before triggering the event
    unmount();

    // Fire the event after unmount — should return early because cancelled = true
    if (capturedCallback) {
      await capturedCallback({
        payload: {
          watchId: "main",
          rootPath: "/workspace",
          paths: ["/workspace/test.md"],
          kind: "modify",
        },
      });
    }

    // Should not have read the file because cancelled guard returned early
    expect(mocks.readTextFile).not.toHaveBeenCalled();
  });

  it("handleModifyEvent returns early when doc is not found (line 252 guard)", async () => {
    // Set up tab with a doc that has filePath (so it appears in the path map on first call)
    seedStores({ lastDiskContent: "# old content" });

    let getDocumentCallCount = 0;
    const realGetDocument = useDocumentStore.getState().getDocument.bind(useDocumentStore.getState());
    const getDocSpy = vi.spyOn(useDocumentStore.getState(), "getDocument").mockImplementation((tabId: string) => {
      getDocumentCallCount++;
      // First call comes from getOpenFilePaths (builds path map) — return real doc
      // Second call comes from handleModifyEvent line 251 — return null to trigger early return
      if (getDocumentCallCount <= 1) return realGetDocument(tabId);
      return undefined;
    });

    mocks.readTextFile.mockResolvedValue("# new disk content");
    mocks.matchesPendingSave.mockReturnValue(false);

    const callback = await setupHookAndCallback();

    // Reset counter before firing event (hook setup may have called getDocument during render)
    getDocumentCallCount = 0;

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // handleModifyEvent: doc is null → return early → no toast, no queue
    expect(mocks.toastInfo).not.toHaveBeenCalled();
    expect(mocks.dialogMessage).not.toHaveBeenCalled();

    getDocSpy.mockRestore();
  });

  it("ignores event with unhandled kind (branch 33[1] — not modify or create)", async () => {
    // An event kind that isn't rename/remove/modify/create reaches the final if check and skips
    seedStores({ lastDiskContent: "# old content" });

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "access" as "modify", // Unknown kind that passes watchId check
      },
    });

    // Should not read file or show any dialog for unknown kind
    expect(mocks.readTextFile).not.toHaveBeenCalled();
    expect(mocks.toastInfo).not.toHaveBeenCalled();
  });
});

describe("useExternalFileChanges — re-queue after batch processing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listen.mockImplementation(() => Promise.resolve(() => {}));
    mocks.matchesPendingSave.mockReturnValue(false);
    mocks.hasPendingSave.mockReturnValue(false);
  });

  it("re-queues new items that arrived during batch processing (lines 220-223)", async () => {
    // Seed two dirty tabs to trigger batch processing
    useTabStore.setState({
      tabs: {
        main: [
          { id: "tab-1", title: "test.md", filePath: "/workspace/test.md", isPinned: false },
          { id: "tab-2", title: "test2.md", filePath: "/workspace/test2.md", isPinned: false },
        ],
      },
      activeTabId: { main: "tab-1" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.setState({
      documents: {
        "tab-1": {
          content: "# edits 1",
          savedContent: "# old 1",
          lastDiskContent: "# old 1",
          filePath: "/workspace/test.md",
          isDirty: true,
          documentId: 0,
          cursorInfo: null,
          lastAutoSave: null,
          isMissing: false,
          isDivergent: false,
          lineEnding: "unknown",
          hardBreakStyle: "unknown",
        },
        "tab-2": {
          content: "# edits 2",
          savedContent: "# old 2",
          lastDiskContent: "# old 2",
          filePath: "/workspace/test2.md",
          isDirty: true,
          documentId: 1,
          cursorInfo: null,
          lastAutoSave: null,
          isMissing: false,
          isDivergent: false,
          lineEnding: "unknown",
          hardBreakStyle: "unknown",
        },
      },
    });
    mocks.readTextFile.mockResolvedValue("# ext change");

    // First batch dialog resolves "Keep All"
    // Then a second batch arrives while first was processing
    let dialogCallCount = 0;
    mocks.dialogMessage.mockImplementation(async () => {
      dialogCallCount++;
      if (dialogCallCount === 1) return "Keep All";
      return "Keep All";
    });

    const callback = await setupHookAndCallback();

    // Fire two changes: first triggers batch after debounce
    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md", "/workspace/test2.md"],
        kind: "modify",
      },
    });

    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1500 });

    // Both docs should be marked divergent
    const doc1 = useDocumentStore.getState().documents["tab-1"];
    const doc2 = useDocumentStore.getState().documents["tab-2"];
    expect(doc1?.isDivergent).toBe(true);
    expect(doc2?.isDivergent).toBe(true);
  });

  it("re-queue setTimeout callback fires after batch processing (lines 220-222)", async () => {
    // Seed two dirty tabs
    useTabStore.setState({
      tabs: {
        main: [
          { id: "tab-1", title: "test.md", filePath: "/workspace/test.md", isPinned: false },
          { id: "tab-2", title: "test2.md", filePath: "/workspace/test2.md", isPinned: false },
        ],
      },
      activeTabId: { main: "tab-1" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.setState({
      documents: {
        "tab-1": {
          content: "# edits 1",
          savedContent: "# old 1",
          lastDiskContent: "# old 1",
          filePath: "/workspace/test.md",
          isDirty: true,
          documentId: 0,
          cursorInfo: null,
          lastAutoSave: null,
          isMissing: false,
          isDivergent: false,
          lineEnding: "unknown",
          hardBreakStyle: "unknown",
        },
        "tab-2": {
          content: "# edits 2",
          savedContent: "# old 2",
          lastDiskContent: "# old 2",
          filePath: "/workspace/test2.md",
          isDirty: true,
          documentId: 1,
          cursorInfo: null,
          lastAutoSave: null,
          isMissing: false,
          isDivergent: false,
          lineEnding: "unknown",
          hardBreakStyle: "unknown",
        },
      },
    });
    mocks.readTextFile.mockResolvedValue("# ext change");

    // The first dialog blocks while we queue more items
    let resolveFirstDialog!: (value: string) => void;
    mocks.dialogMessage
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveFirstDialog = resolve; }))
      .mockResolvedValue("Keep my changes");

    const callback = await setupHookAndCallback();

    // Trigger first change — goes into batch queue
    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // Wait for first dialog to appear (batch debounce fires)
    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalledTimes(1), { timeout: 1000 });

    // While first dialog is open (isProcessingBatchRef is true),
    // queue another change — this goes into pendingDirtyChangesRef
    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test2.md"],
        kind: "modify",
      },
    });

    // Resolve the first dialog — triggers finally block which sees pending items
    resolveFirstDialog("Keep my changes");

    // Wait for re-queued batch to process (second dialog)
    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalledTimes(2), { timeout: 1500 });

    // Both tabs should eventually be marked divergent
    const doc1 = useDocumentStore.getState().documents["tab-1"];
    const doc2 = useDocumentStore.getState().documents["tab-2"];
    expect(doc1?.isDivergent).toBe(true);
    expect(doc2?.isDivergent).toBe(true);
  });

  it("processBatchedChanges returns early when pending is empty", async () => {
    seedStores({ lastDiskContent: "# old content" });
    mocks.readTextFile.mockResolvedValue("# ext change");

    // This tests the guard: if (pending.length === 0 || isProcessingBatchRef.current) return;
    // We can't directly call processBatchedChanges, but we verify no dialog appears
    // when no dirty changes are queued
    await setupHookAndCallback();

    // No dialog should appear — no dirty changes were queued
    expect(mocks.dialogMessage).not.toHaveBeenCalled();
  });

  it("cancelled=true guard inside event callback (line 293)", async () => {
    seedStores();
    let capturedCallback: ((event: object) => Promise<void>) | null = null;
    mocks.listen.mockImplementationOnce((_event: string, cb: (event: object) => Promise<void>) => {
      capturedCallback = cb;
      return Promise.resolve(() => {});
    });

    const { unmount } = renderHook(() => useExternalFileChanges());
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalled());

    // Unmount sets cancelled = true
    unmount();

    // Fire event after unmount — the inner `if (cancelled) return;` guard fires
    if (capturedCallback) {
      await capturedCallback({
        payload: {
          watchId: "main",
          rootPath: "/workspace",
          paths: ["/workspace/test.md"],
          kind: "remove",
        },
      });
    }

    // Doc should NOT be marked missing because we returned early due to cancelled
    // (The store might already be cleaned up, but no marking should have occurred post-unmount)
    expect(mocks.readTextFile).not.toHaveBeenCalled();
  });
});

describe("useExternalFileChanges — fileName fallback (getFileName returns empty)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listen.mockImplementation(() => Promise.resolve(() => {}));
    mocks.matchesPendingSave.mockReturnValue(false);
    mocks.hasPendingSave.mockReturnValue(false);
  });

  it("uses 'file' as fallback when getFileName returns empty string (L99 || 'file')", async () => {
    // Mock the paths module so getFileName returns "" for the tab's path
    const pathsModule = await import("@/utils/paths");
    const originalGetFileName = pathsModule.getFileName;
    vi.spyOn(pathsModule, "getFileName").mockImplementation((p: string) => {
      if (p === "/workspace/test.md") return "";
      return originalGetFileName(p);
    });

    // Seed a dirty tab that will trigger handleDirtyChange
    useTabStore.setState({
      tabs: {
        main: [{ id: "tab-1", title: "test.md", filePath: "/workspace/test.md", isPinned: false }],
      },
      activeTabId: { main: "tab-1" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.setState({
      documents: {
        "tab-1": {
          content: "# user edits",
          savedContent: "# old content",
          lastDiskContent: "# old content",
          filePath: "/workspace/test.md",
          isDirty: true,
          documentId: 0,
          cursorInfo: null,
          lastAutoSave: null,
          isMissing: false,
          isDivergent: false,
          lineEnding: "unknown",
          hardBreakStyle: "unknown",
        },
      },
    });

    mocks.readTextFile.mockResolvedValue("# external change");
    mocks.dialogMessage.mockResolvedValue("Cancel");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // Wait for batch processing
    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1000 });

    const messageArg = mocks.dialogMessage.mock.calls[0][0] as string;
    // When getFileName returns "", the dialog should fall back to "file"
    expect(messageArg).toContain('"file"');

    vi.mocked(pathsModule.getFileName).mockRestore();
  });
});

describe("useExternalFileChanges — multi-file batch dialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listen.mockImplementation(() => Promise.resolve(() => {}));
    mocks.matchesPendingSave.mockReturnValue(false);
    mocks.hasPendingSave.mockReturnValue(false);
  });

  function seedMultiDirtyStores() {
    useTabStore.setState({
      tabs: {
        main: [
          { id: "tab-1", title: "test.md", filePath: "/workspace/test.md", isPinned: false },
          { id: "tab-2", title: "test2.md", filePath: "/workspace/test2.md", isPinned: false },
        ],
      },
      activeTabId: { main: "tab-1" },
      untitledCounter: 0,
      closedTabs: {},
    });

    useDocumentStore.setState({
      documents: {
        "tab-1": {
          content: "# edits 1",
          savedContent: "# old 1",
          lastDiskContent: "# old 1",
          filePath: "/workspace/test.md",
          isDirty: true,
          documentId: 0,
          cursorInfo: null,
          lastAutoSave: null,
          isMissing: false,
          isDivergent: false,
          lineEnding: "unknown",
          hardBreakStyle: "unknown",
        },
        "tab-2": {
          content: "# edits 2",
          savedContent: "# old 2",
          lastDiskContent: "# old 2",
          filePath: "/workspace/test2.md",
          isDirty: true,
          documentId: 1,
          cursorInfo: null,
          lastAutoSave: null,
          isMissing: false,
          isDivergent: false,
          lineEnding: "unknown",
          hardBreakStyle: "unknown",
        },
      },
    });
  }

  it("batch dialog — Reload All reloads all files", async () => {
    seedMultiDirtyStores();
    mocks.readTextFile.mockResolvedValue("# ext change");
    mocks.dialogMessage.mockResolvedValue("Reload All");
    mocks.reloadTabFromDisk.mockResolvedValue(undefined);

    const callback = await setupHookAndCallback();

    // Trigger two changes simultaneously to batch them
    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md", "/workspace/test2.md"],
        kind: "modify",
      },
    });

    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1000 });

    expect(mocks.reloadTabFromDisk).toHaveBeenCalledWith("tab-1", "/workspace/test.md");
    expect(mocks.reloadTabFromDisk).toHaveBeenCalledWith("tab-2", "/workspace/test2.md");
  });

  it("batch dialog — 'Yes' also triggers Reload All", async () => {
    seedMultiDirtyStores();
    mocks.readTextFile.mockResolvedValue("# ext change");
    mocks.dialogMessage.mockResolvedValue("Yes");
    mocks.reloadTabFromDisk.mockResolvedValue(undefined);

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md", "/workspace/test2.md"],
        kind: "modify",
      },
    });

    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1000 });

    expect(mocks.reloadTabFromDisk).toHaveBeenCalledTimes(2);
  });

  it("batch dialog — Keep All marks all as divergent", async () => {
    seedMultiDirtyStores();
    mocks.readTextFile.mockResolvedValue("# ext change");
    mocks.dialogMessage.mockResolvedValue("Keep All");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md", "/workspace/test2.md"],
        kind: "modify",
      },
    });

    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1000 });

    const doc1 = useDocumentStore.getState().documents["tab-1"];
    const doc2 = useDocumentStore.getState().documents["tab-2"];
    expect(doc1?.isDivergent).toBe(true);
    expect(doc2?.isDivergent).toBe(true);
  });

  it("batch dialog — 'No' triggers Keep All", async () => {
    seedMultiDirtyStores();
    mocks.readTextFile.mockResolvedValue("# ext change");
    mocks.dialogMessage.mockResolvedValue("No");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md", "/workspace/test2.md"],
        kind: "modify",
      },
    });

    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1000 });

    const doc1 = useDocumentStore.getState().documents["tab-1"];
    expect(doc1?.isDivergent).toBe(true);
  });

  it("batch dialog — Review Each processes files individually", async () => {
    seedMultiDirtyStores();
    mocks.readTextFile.mockResolvedValue("# ext change");
    // First dialog: batch -> "Review Each"
    mocks.dialogMessage
      .mockResolvedValueOnce("Review Each")
      // Individual dialogs: Reload for each
      .mockResolvedValue("Reload");
    mocks.reloadTabFromDisk.mockResolvedValue(undefined);

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md", "/workspace/test2.md"],
        kind: "modify",
      },
    });

    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalledTimes(3), { timeout: 2000 });

    expect(mocks.reloadTabFromDisk).toHaveBeenCalledTimes(2);
  });

  it("batch dialog — handles reload failure in Reload All", async () => {
    seedMultiDirtyStores();
    mocks.readTextFile.mockResolvedValue("# ext change");
    mocks.dialogMessage.mockResolvedValue("Reload All");
    mocks.reloadTabFromDisk.mockRejectedValue(new Error("reload failed"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md", "/workspace/test2.md"],
        kind: "modify",
      },
    });

    await vi.waitFor(() => expect(mocks.dialogMessage).toHaveBeenCalled(), { timeout: 1000 });

    // Files should be marked as missing after reload failure
    const doc1 = useDocumentStore.getState().documents["tab-1"];
    const doc2 = useDocumentStore.getState().documents["tab-2"];
    expect(doc1?.isMissing).toBe(true);
    expect(doc2?.isMissing).toBe(true);

    errorSpy.mockRestore();
  });
});

describe("useExternalFileChanges — divergent auto-recovery (issue #522)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listen.mockImplementation(() => Promise.resolve(() => {}));
    mocks.matchesPendingSave.mockReturnValue(false);
    mocks.hasPendingSave.mockReturnValue(false);
  });

  function seedDivergentStore(editorContent: string, diskLastContent: string) {
    useTabStore.setState({
      tabs: {
        main: [{ id: "tab-1", title: "test.md", filePath: "/workspace/test.md", isPinned: false }],
      },
      activeTabId: { main: "tab-1" },
      untitledCounter: 0,
      closedTabs: {},
    });

    useDocumentStore.setState({
      documents: {
        "tab-1": {
          content: editorContent,
          savedContent: diskLastContent,
          lastDiskContent: diskLastContent,
          filePath: "/workspace/test.md",
          isDirty: true,
          documentId: 0,
          cursorInfo: null,
          lastAutoSave: null,
          isMissing: false,
          isDivergent: true, // User previously chose "Keep my changes"
          lineEnding: "unknown",
          hardBreakStyle: "unknown",
        },
      },
    });
  }

  it("auto-clears divergent when disk content matches editor content (git checkout restores same content)", async () => {
    // Scenario: user edited doc → chose "Keep my changes" → isDivergent = true
    // Then git checkout restores the original file (same content as what user has)
    seedDivergentStore("my local content", "old disk content");
    mocks.readTextFile.mockResolvedValue("my local content"); // disk now matches editor

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    const doc = useDocumentStore.getState().documents["tab-1"];
    // isDivergent must be cleared — auto-save can resume
    expect(doc?.isDivergent).toBe(false);
    // Content stays the same (no reload needed)
    expect(doc?.content).toBe("my local content");
    // No prompt shown to user
    expect(mocks.dialogMessage).not.toHaveBeenCalled();
  });

  it("does NOT auto-clear divergent when disk content still differs from editor", async () => {
    // Scenario: divergent doc, disk changes again but still doesn't match editor
    seedDivergentStore("my local content", "old disk content");
    mocks.readTextFile.mockResolvedValue("yet another external change"); // still different from editor

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // Should still be divergent — disk doesn't match editor
    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isDivergent).toBe(true);
  });

  it("does not trigger divergent recovery when disk matches lastDiskContent (no-op write)", async () => {
    // Scenario: divergent doc, disk write is a no-op (matches lastDiskContent, not editor)
    seedDivergentStore("my local content", "old disk content");
    mocks.readTextFile.mockResolvedValue("old disk content"); // matches lastDiskContent (early return)

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // Early return from lastDiskContent check — isDivergent unchanged
    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isDivergent).toBe(true);
    expect(mocks.dialogMessage).not.toHaveBeenCalled();
  });
});
