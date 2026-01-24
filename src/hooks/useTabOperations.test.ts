import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { closeTabWithDirtyCheck } from "@/hooks/useTabOperations";
import { message, save } from "@tauri-apps/plugin-dialog";
import { saveToPath } from "@/utils/saveToPath";

vi.mock("@/utils/saveToPath", () => ({
  saveToPath: vi.fn(),
}));

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
  });

  it("closes clean tab without prompting", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/tmp/test.md");
    useDocumentStore.getState().initDocument(tabId, "hello", "/tmp/test.md");

    const result = await closeTabWithDirtyCheck(WINDOW_LABEL, tabId);

    expect(result).toBe(true);
    expect(message).not.toHaveBeenCalled();
    expect(useTabStore.getState().tabs[WINDOW_LABEL]?.length ?? 0).toBe(0);
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
    expect(useTabStore.getState().tabs[WINDOW_LABEL]?.length ?? 0).toBe(0);
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
    expect(useTabStore.getState().tabs[WINDOW_LABEL]?.length ?? 0).toBe(0);
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
});
