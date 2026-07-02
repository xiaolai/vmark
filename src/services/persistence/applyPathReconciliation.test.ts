import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { applyPathReconciliation } from "./applyPathReconciliation";

const WINDOW_MAIN = "main";
const WINDOW_DOC = "doc-1";

function resetStores() {
  const tabState = useTabStore.getState();
  tabState.removeWindow(WINDOW_MAIN);
  tabState.removeWindow(WINDOW_DOC);

  const docState = useDocumentStore.getState();
  Object.keys(docState.documents).forEach((id) => {
    docState.removeDocument(id);
  });
}

describe("applyPathReconciliation", () => {
  beforeEach(() => {
    resetStores();
  });

  it("updates all tabs with matching path across windows", () => {
    const oldPath = "/tmp/shared.md";
    const newPath = "/tmp/renamed.md";

    const tabA = useTabStore.getState().createTab(WINDOW_MAIN, oldPath);
    const tabB = useTabStore.getState().createTab(WINDOW_DOC, oldPath);

    useDocumentStore.getState().initDocument(tabA, "a", oldPath);
    useDocumentStore.getState().initDocument(tabB, "b", oldPath);

    applyPathReconciliation([
      { action: "update_path", oldPath, newPath },
    ]);

    const tabAState = useTabStore.getState().getTabsByWindow(WINDOW_MAIN)[0];
    const tabBState = useTabStore.getState().getTabsByWindow(WINDOW_DOC)[0];

    expect(tabAState.filePath).toBe(newPath);
    expect(tabBState.filePath).toBe(newPath);
    expect(useDocumentStore.getState().getDocument(tabA)?.filePath).toBe(newPath);
    expect(useDocumentStore.getState().getDocument(tabB)?.filePath).toBe(newPath);
  });

  it("marks all matching tabs as missing across windows", () => {
    const oldPath = "/tmp/shared.md";

    const tabA = useTabStore.getState().createTab(WINDOW_MAIN, oldPath);
    const tabB = useTabStore.getState().createTab(WINDOW_DOC, oldPath);

    useDocumentStore.getState().initDocument(tabA, "a", oldPath);
    useDocumentStore.getState().initDocument(tabB, "b", oldPath);

    applyPathReconciliation([
      { action: "mark_missing", oldPath },
    ]);

    expect(useDocumentStore.getState().getDocument(tabA)?.isMissing).toBe(true);
    expect(useDocumentStore.getState().getDocument(tabB)?.isMissing).toBe(true);
  });

  it("skips tabs without filePath for update_path (line 35)", () => {
    // Create a tab without a filePath (new unsaved tab)
    const unsavedTab = useTabStore.getState().createTab(WINDOW_MAIN);
    useDocumentStore.getState().initDocument(unsavedTab, "unsaved", null);

    // Also create a matching tab to confirm it still updates
    const savedTab = useTabStore.getState().createTab(WINDOW_MAIN, "/tmp/file.md");
    useDocumentStore.getState().initDocument(savedTab, "saved", "/tmp/file.md");

    applyPathReconciliation([
      { action: "update_path", oldPath: "/tmp/file.md", newPath: "/tmp/renamed.md" },
    ]);

    // Saved tab should be updated
    expect(useDocumentStore.getState().getDocument(savedTab)?.filePath).toBe("/tmp/renamed.md");
    // Unsaved tab should be untouched
    expect(useDocumentStore.getState().getDocument(unsavedTab)?.filePath).toBeNull();
  });

  it("skips tabs without filePath for mark_missing (line 44)", () => {
    const unsavedTab = useTabStore.getState().createTab(WINDOW_MAIN);
    useDocumentStore.getState().initDocument(unsavedTab, "unsaved", null);

    const savedTab = useTabStore.getState().createTab(WINDOW_MAIN, "/tmp/gone.md");
    useDocumentStore.getState().initDocument(savedTab, "saved", "/tmp/gone.md");

    applyPathReconciliation([
      { action: "mark_missing", oldPath: "/tmp/gone.md" },
    ]);

    expect(useDocumentStore.getState().getDocument(savedTab)?.isMissing).toBe(true);
    expect(useDocumentStore.getState().getDocument(unsavedTab)?.isMissing).toBeFalsy();
  });
});
