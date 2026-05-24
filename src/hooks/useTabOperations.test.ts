import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { closeTabWithDirtyCheck, closeTabsWithDirtyCheck } from "@/hooks/useTabOperations";
import { message, save, ask } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { invoke } from "@tauri-apps/api/core";
import { saveToPath } from "@/services/persistence/saveToPath";
import { isMacPlatform } from "@/utils/shortcutMatch";

vi.mock("@/services/persistence/saveToPath", () => ({
  saveToPath: vi.fn(),
}));

vi.mock("@/utils/orphanAssetCleanup", () => ({
  findOrphanedImages: vi.fn().mockResolvedValue({ orphanedImages: [], referencedImages: [] }),
  deleteOrphanedImages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/workspaceSession", () => ({
  persistWorkspaceSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/utils/shortcutMatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/shortcutMatch")>();
  return { ...actual, isMacPlatform: vi.fn(() => true) };
});

const WINDOW_LABEL = "main";

function resetStores() {
  const tabState = useTabStore.getState();
  tabState.removeWindow(WINDOW_LABEL);

  const docState = useDocumentStore.getState();
  Object.keys(docState.documents).forEach((id) => {
    docState.removeDocument(id);
  });
}

describe("closeTabWithDirtyCheck", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    vi.mocked(isMacPlatform).mockReturnValue(true);
  });

  it("closes clean tab without prompting", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/test.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/test.md");

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(true);
    expect(message).not.toHaveBeenCalled();
    // Closing the last tab closes the window on macOS
    expect(useTabStore.getState().tabs[WINDOW_LABEL]).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("close_window", { label: WINDOW_LABEL });
    expect(useDocumentStore.getState().getDocument(tabId)).toBeUndefined();
  });

  it("keeps dirty tab open when user cancels", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/dirty.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/dirty.md");
    useDocumentStore.getState().setContent(tabId, "changed");

    // message() returns 'Cancel' when user clicks Cancel or dismisses
    vi.mocked(message).mockResolvedValueOnce("Cancel");

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(false);
    expect(useTabStore.getState().tabs[WINDOW_LABEL]?.length ?? 0).toBe(1);
    expect(useDocumentStore.getState().getDocument(tabId)).toBeDefined();
  });

  it("closes dirty tab without saving when user chooses Don't Save", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/dirty.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/dirty.md");
    useDocumentStore.getState().setContent(tabId, "changed");

    // message() returns 'No' when user clicks "Don't Save"
    vi.mocked(message).mockResolvedValueOnce("No");

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(true);
    expect(saveToPath).not.toHaveBeenCalled();
    // Closing the last tab closes the window on macOS
    expect(useTabStore.getState().tabs[WINDOW_LABEL]).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("close_window", { label: WINDOW_LABEL });
  });

  it("closes dirty tab when dialog returns custom button label (Don't Save)", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/dirty.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/dirty.md");
    useDocumentStore.getState().setContent(tabId, "changed");

    vi.mocked(message).mockResolvedValueOnce("Don't Save");

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(true);
    expect(saveToPath).not.toHaveBeenCalled();
    // Closing the last tab closes the window on macOS
    expect(useTabStore.getState().tabs[WINDOW_LABEL]).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("close_window", { label: WINDOW_LABEL });
  });

  it("saves and closes dirty tab when user chooses Save and file has path", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/dirty.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/dirty.md");
    useDocumentStore.getState().setContent(tabId, "changed");

    // message() returns 'Yes' when user clicks "Save"
    vi.mocked(message).mockResolvedValueOnce("Yes");
    vi.mocked(saveToPath).mockResolvedValueOnce(true);

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(true);
    expect(saveToPath).toHaveBeenCalledWith(tabId, "/tmp/dirty.md", "changed", "manual");
    // Closing the last tab closes the window on macOS
    expect(useTabStore.getState().tabs[WINDOW_LABEL]).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("close_window", { label: WINDOW_LABEL });
  });

  it("cancels close if user chooses Save but cancels Save dialog", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, null);
    useDocumentStore.getState().initDocument(tabId, "hello", null);
    useDocumentStore.getState().setContent(tabId, "changed");

    vi.mocked(message).mockResolvedValueOnce("Yes");
    vi.mocked(save).mockResolvedValueOnce(null);

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(false);
    expect(useTabStore.getState().tabs[WINDOW_LABEL]?.length ?? 0).toBe(1);
  });

  it("deduplicates concurrent close calls for the same tab (re-entry guard)", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/dirty.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/dirty.md");
    useDocumentStore.getState().setContent(tabId, "changed");

    // Make message() hang until we resolve it manually
    let resolveDialog!: (value: string) => void;
    vi.mocked(message).mockImplementationOnce(
      () => new Promise((resolve) => { resolveDialog = resolve; })
    );

    // Fire two concurrent close calls for the same tab
    const call1 = closeTabWithDirtyCheck(WINDOW_LABEL, tabId);
    const call2 = closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    // Second call returns immediately (re-entry guard)
    expect(await call2).toBe(true);

    // message() only called once (not twice)
    expect(message).toHaveBeenCalledTimes(1);

    // Resolve the dialog so call1 completes
    resolveDialog("No");
    expect(await call1).toBe(true);
  });

  it("creates untitled tab instead of closing window on non-macOS", async () => {
    vi.mocked(isMacPlatform).mockReturnValue(false);

    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/test.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/test.md");

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(true);
    // Window should NOT be closed on non-macOS
    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
    // A new untitled tab should have been created
    const tabs = useTabStore.getState().tabs[WINDOW_LABEL] ?? [];
    expect(tabs.length).toBe(1);
    expect(tabs[0].filePath).toBeNull();
  });

  it("returns true when tab doesn't exist (already closed)", async () => {
    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, "nonexistent-tab");
    expect(result).toBe(true);
    expect(message).not.toHaveBeenCalled();
  });

  it("does not close window when other tabs remain", async () => {
    const tabId1 = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/a.md");
    const tabId2 = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/b.md");
    useDocumentStore.getState().initDocument(tabId1, "a", "/tmp/a.md");
    useDocumentStore.getState().initDocument(tabId2, "b", "/tmp/b.md");

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId1);

    expect(result).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
    // Other tab should still exist
    const tabs = useTabStore.getState().tabs[WINDOW_LABEL] ?? [];
    expect(tabs.length).toBe(1);
    expect(tabs[0].id).toBe(tabId2);
  });

  it("removes document from store on close", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/test.md");
    useDocumentStore.getState().initDocument(tabId, "content", "/tmp/test.md");

    await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(useDocumentStore.getState().getDocument(tabId)).toBeUndefined();
  });

  // Regression for pinned-tab data loss: tabStore.closeTab() refuses
  // pinned tabs (shows an "Unpin before closing" toast). Without an
  // explicit short-circuit here, cleanupTabState() still wiped the
  // document state and the dirty-prompt path could still run for a tab
  // that would never actually close. The tab stayed visible in the UI
  // but with no document behind it.
  it("refuses to close a pinned tab and keeps the document intact", async () => {
    const tabId1 = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/pinned.md");
    // Add a second tab so closeWindowIfEmpty would otherwise attempt to
    // close the window — verifying we don't hit that path on a refused close.
    const tabId2 = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/other.md");
    useDocumentStore.getState().initDocument(tabId1, "hello", "/tmp/pinned.md");
    useDocumentStore.getState().initDocument(tabId2, "world", "/tmp/other.md");
    useTabStore.getState().togglePin(WINDOW_LABEL, tabId1);

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId1);

    expect(result).toBe(false);
    // Tab is still in the window.
    const tabs = useTabStore.getState().tabs[WINDOW_LABEL] ?? [];
    expect(tabs.some((t) => t.id === tabId1)).toBe(true);
    // Document state survived — this is the data-loss bug being guarded.
    expect(useDocumentStore.getState().getDocument(tabId1)).toBeDefined();
    // No save prompt, no window close.
    expect(message).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
  });

  it("refuses to close a pinned + dirty tab WITHOUT running the save prompt", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/pinned-dirty.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/pinned-dirty.md");
    useDocumentStore.getState().setContent(tabId, "changed");
    useTabStore.getState().togglePin(WINDOW_LABEL, tabId);

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(false);
    // The dirty prompt must not appear — close is going to be refused either way.
    expect(message).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().getDocument(tabId)).toBeDefined();
  });
});

describe("closeTabsWithDirtyCheck", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    vi.mocked(isMacPlatform).mockReturnValue(true);
  });

  it("closes all clean tabs successfully", async () => {
    const tabId1 = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/a.md");
    const tabId2 = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/b.md");
    useDocumentStore.getState().initDocument(tabId1, "a", "/tmp/a.md");
    useDocumentStore.getState().initDocument(tabId2, "b", "/tmp/b.md");

    const result = await closeTabsWithDirtyCheck(WINDOW_LABEL, [tabId1, tabId2]);

    expect(result).toBe(true);
    expect(useDocumentStore.getState().getDocument(tabId1)).toBeUndefined();
    expect(useDocumentStore.getState().getDocument(tabId2)).toBeUndefined();
  });

  it("stops and returns false when user cancels one tab", async () => {
    const tabId1 = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/a.md");
    const tabId2 = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/b.md");
    useDocumentStore.getState().initDocument(tabId1, "a", "/tmp/a.md");
    useDocumentStore.getState().initDocument(tabId2, "b", "/tmp/b.md");
    useDocumentStore.getState().setContent(tabId1, "dirty");

    // User cancels on first dirty tab
    vi.mocked(message).mockResolvedValueOnce("Cancel");

    const result = await closeTabsWithDirtyCheck(WINDOW_LABEL, [tabId1, tabId2]);

    expect(result).toBe(false);
    // Second tab should not have been processed
    expect(useDocumentStore.getState().getDocument(tabId2)).toBeDefined();
  });

  it("returns true for empty tab list", async () => {
    const result = await closeTabsWithDirtyCheck(WINDOW_LABEL, []);
    expect(result).toBe(true);
  });
});

describe("closeTabWithDirtyCheck — orphan cleanup", () => {
  beforeEach(async () => {
    resetStores();
    vi.clearAllMocks();
    vi.mocked(isMacPlatform).mockReturnValue(true);

    // Reset orphan mock defaults
    const { findOrphanedImages } = await import("@/utils/orphanAssetCleanup");
    vi.mocked(findOrphanedImages).mockResolvedValue({ orphanedImages: [], referencedImages: [] });
  });

  it("runs orphan cleanup for clean tab with cleanupOrphansOnClose enabled", async () => {
    const { useSettingsStore } = await import("@/stores/settingsStore");
    useSettingsStore.setState({ image: { cleanupOrphansOnClose: true } } as never);

    const { findOrphanedImages, deleteOrphanedImages } = await import("@/utils/orphanAssetCleanup");
    vi.mocked(findOrphanedImages).mockResolvedValue({
      orphanedImages: ["/tmp/assets/orphan.png"],
      referencedImages: [],
    });

    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/test.md");
    useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/other.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/test.md");
    const otherTabId = useTabStore.getState().tabs[WINDOW_LABEL]![1].id;
    useDocumentStore.getState().initDocument(otherTabId, "other", "/tmp/other.md");

    await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(findOrphanedImages).toHaveBeenCalledWith("/tmp/test.md", "hello");
    expect(deleteOrphanedImages).toHaveBeenCalledWith(["/tmp/assets/orphan.png"]);
  });

  it("silently handles orphan cleanup errors", async () => {
    const { useSettingsStore } = await import("@/stores/settingsStore");
    useSettingsStore.setState({ image: { cleanupOrphansOnClose: true } } as never);

    const { findOrphanedImages } = await import("@/utils/orphanAssetCleanup");
    vi.mocked(findOrphanedImages).mockRejectedValue(new Error("fs error"));

    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/test.md");
    useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/other.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/test.md");
    const otherTabId = useTabStore.getState().tabs[WINDOW_LABEL]![1].id;
    useDocumentStore.getState().initDocument(otherTabId, "other", "/tmp/other.md");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(true);
    errorSpy.mockRestore();
  });

  it("skips orphan cleanup when cleanupOrphansOnClose is disabled", async () => {
    const { useSettingsStore } = await import("@/stores/settingsStore");
    useSettingsStore.setState({ image: { cleanupOrphansOnClose: false } } as never);

    const { findOrphanedImages } = await import("@/utils/orphanAssetCleanup");

    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/test.md");
    useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/other.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/test.md");
    const otherTabId = useTabStore.getState().tabs[WINDOW_LABEL]![1].id;
    useDocumentStore.getState().initDocument(otherTabId, "other", "/tmp/other.md");

    await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(findOrphanedImages).not.toHaveBeenCalled();
  });

  it("skips orphan cleanup for unsaved tab (no filePath)", async () => {
    const { useSettingsStore } = await import("@/stores/settingsStore");
    useSettingsStore.setState({ image: { cleanupOrphansOnClose: true } } as never);

    const { findOrphanedImages } = await import("@/utils/orphanAssetCleanup");

    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, null);
    useDocumentStore.getState().initDocument(tabId, "hello", null);

    await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(findOrphanedImages).not.toHaveBeenCalled();
  });

  it("runs orphan cleanup after save for dirty tab (saved path)", async () => {
    const { useSettingsStore } = await import("@/stores/settingsStore");
    useSettingsStore.setState({ image: { cleanupOrphansOnClose: true } } as never);

    const { findOrphanedImages } = await import("@/utils/orphanAssetCleanup");
    vi.mocked(findOrphanedImages).mockResolvedValue({
      orphanedImages: [],
      referencedImages: [],
    });

    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/dirty.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/dirty.md");
    useDocumentStore.getState().setContent(tabId, "changed");

    vi.mocked(message).mockResolvedValueOnce("Yes");
    vi.mocked(saveToPath).mockResolvedValueOnce(true);

    await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(findOrphanedImages).toHaveBeenCalled();
  });

  it("handles savedDoc being null after save (line 134 false branch)", async () => {
    const { useSettingsStore } = await import("@/stores/settingsStore");
    useSettingsStore.setState({ image: { cleanupOrphansOnClose: true } } as never);

    const { findOrphanedImages } = await import("@/utils/orphanAssetCleanup");

    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/dirty.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/dirty.md");
    useDocumentStore.getState().setContent(tabId, "changed");

    vi.mocked(message).mockResolvedValueOnce("Yes");
    vi.mocked(saveToPath).mockImplementationOnce(async (id) => {
      // Remove the document before returning so savedDoc lookup returns null
      useDocumentStore.getState().removeDocument(id);
      return true;
    });

    await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    // findOrphanedImages should NOT be called since savedDoc is null
    expect(findOrphanedImages).not.toHaveBeenCalled();
  });

  it("does NOT run orphan cleanup when dirty tab is discarded", async () => {
    const { useSettingsStore } = await import("@/stores/settingsStore");
    useSettingsStore.setState({ image: { cleanupOrphansOnClose: true } } as never);

    const { findOrphanedImages } = await import("@/utils/orphanAssetCleanup");

    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/dirty.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/dirty.md");
    useDocumentStore.getState().setContent(tabId, "changed");

    vi.mocked(message).mockResolvedValueOnce("No");

    await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(findOrphanedImages).not.toHaveBeenCalled();
  });
});

// Confirmation before closing the only remaining tab while a workspace is
// open. The warning prevents an accidental Cmd+W on the last document from
// either closing the workspace window (macOS) or replacing the workspace
// view with a blank untitled tab (Win/Linux) without the user realising it.
describe("closeTabWithDirtyCheck — last-tab-in-workspace warning", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    vi.mocked(isMacPlatform).mockReturnValue(true);
    // Default ask() to "user clicked Cancel" so any unintended fire is
    // visible as the close returning false. Each test that should
    // proceed overrides with mockResolvedValueOnce(true).
    vi.mocked(ask).mockResolvedValue(false);
    // Reset workspace state — closeWorkspace() clears rootPath/config and
    // sets isWorkspaceMode to false.
    useWorkspaceStore.getState().closeWorkspace();
  });

  it("prompts and proceeds when user confirms (workspace open, last tab)", async () => {
    useWorkspaceStore.getState().openWorkspace("/tmp/workspace");
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/workspace/a.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/workspace/a.md");

    vi.mocked(ask).mockResolvedValueOnce(true);

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(ask).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
    expect(useDocumentStore.getState().getDocument(tabId)).toBeUndefined();
  });

  it("aborts when user cancels the prompt (workspace open, last tab)", async () => {
    useWorkspaceStore.getState().openWorkspace("/tmp/workspace");
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/workspace/a.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/workspace/a.md");

    vi.mocked(ask).mockResolvedValueOnce(false);

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(ask).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
    expect(useDocumentStore.getState().getDocument(tabId)).toBeDefined();
    expect(useTabStore.getState().tabs[WINDOW_LABEL]?.length ?? 0).toBe(1);
  });

  it("does not prompt when not the last tab (workspace open, two tabs)", async () => {
    useWorkspaceStore.getState().openWorkspace("/tmp/workspace");
    const tabId1 = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/workspace/a.md");
    const tabId2 = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/workspace/b.md");
    useDocumentStore.getState().initDocument(tabId1, "a", "/tmp/workspace/a.md");
    useDocumentStore.getState().initDocument(tabId2, "b", "/tmp/workspace/b.md");

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId1);

    expect(ask).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("does not prompt when no workspace is open (free-standing window)", async () => {
    // No workspace open — the beforeEach already called closeWorkspace().
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/a.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/a.md");

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(ask).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("does not prompt for batch closes (skipLastTabWarning flag)", async () => {
    useWorkspaceStore.getState().openWorkspace("/tmp/workspace");
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/workspace/a.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/workspace/a.md");

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId, {
      skipLastTabWarning: true,
    });

    expect(ask).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("closeTabsWithDirtyCheck skips the warning on its final iteration", async () => {
    // Regression: batch-close paths (Close Others / To Right / All
    // Unpinned) reach a state where one tab remains in the loop. Without
    // the skip flag they would surface a confirmation dialog mid-batch.
    useWorkspaceStore.getState().openWorkspace("/tmp/workspace");
    const tabId1 = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/workspace/a.md");
    const tabId2 = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/workspace/b.md");
    useDocumentStore.getState().initDocument(tabId1, "a", "/tmp/workspace/a.md");
    useDocumentStore.getState().initDocument(tabId2, "b", "/tmp/workspace/b.md");

    const result = await closeTabsWithDirtyCheck(WINDOW_LABEL, [tabId1, tabId2]);

    expect(ask).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });
});
