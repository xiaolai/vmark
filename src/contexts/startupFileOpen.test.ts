import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOpenFileInNewTabCore = vi.fn(async () => {});
vi.mock("@/hooks/useFileOpen", () => ({
  openFileInNewTabCore: (...args: unknown[]) => mockOpenFileInNewTabCore(...args),
}));

import { loadStartupFileIntoTab, createBlankStartupTab } from "./startupFileOpen";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

const WINDOW = "main";

describe("startupFileOpen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenFileInNewTabCore.mockImplementation(async () => {});
    useTabStore.getState().removeWindow(WINDOW);
    Object.keys(useDocumentStore.getState().documents).forEach((id) =>
      useDocumentStore.getState().removeDocument(id)
    );
  });

  describe("loadStartupFileIntoTab", () => {
    it("delegates the open to the shared core (dedupe + ownership + guards)", async () => {
      // Core creates a tab for the file (simulating a successful open).
      mockOpenFileInNewTabCore.mockImplementation(async (label: string, path: string) => {
        const tabId = useTabStore.getState().createTab(label, path);
        useDocumentStore.getState().initDocument(tabId, "# content", path);
      });

      await loadStartupFileIntoTab(WINDOW, "/docs/a.md");

      expect(mockOpenFileInNewTabCore).toHaveBeenCalledWith(WINDOW, "/docs/a.md");
      const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
      expect(tabs).toHaveLength(1);
      expect(tabs[0].filePath).toBe("/docs/a.md");
    });

    it("does NOT overwrite an already-open dirty tab on a duplicate path", async () => {
      // Open the file once with dirty edits.
      const tabId = useTabStore.getState().createTab(WINDOW, "/docs/dup.md");
      useDocumentStore.getState().initDocument(tabId, "saved", "/docs/dup.md");
      useDocumentStore.getState().setContent(tabId, "DIRTY EDITS");
      expect(useDocumentStore.getState().getDocument(tabId)?.isDirty).toBe(true);

      // The shared core dedupes (creates no new tab, writes nothing) — that is
      // exactly the guard the old inline copy lacked. Simulate that no-op.
      mockOpenFileInNewTabCore.mockImplementation(async () => {});

      await loadStartupFileIntoTab(WINDOW, "/docs/dup.md");

      // The dirty content must survive — not be clobbered with disk content.
      expect(useDocumentStore.getState().getDocument(tabId)?.content).toBe("DIRTY EDITS");
      expect(useTabStore.getState().getTabsByWindow(WINDOW)).toHaveLength(1);
    });

    it("adds a blank untitled tab when the open is refused and the window is empty", async () => {
      // Core refuses (e.g. oversized file) → creates no tab.
      mockOpenFileInNewTabCore.mockImplementation(async () => {});

      await loadStartupFileIntoTab(WINDOW, "/docs/huge.md");

      const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
      expect(tabs).toHaveLength(1);
      expect(tabs[0].filePath).toBeNull();
    });

    it("does NOT add a blank tab when the window already has a tab", async () => {
      const existing = useTabStore.getState().createTab(WINDOW, "/docs/other.md");
      useDocumentStore.getState().initDocument(existing, "x", "/docs/other.md");
      mockOpenFileInNewTabCore.mockImplementation(async () => {});

      await loadStartupFileIntoTab(WINDOW, "/docs/refused.md");

      // Only the pre-existing tab remains; no orphan blank tab.
      const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
      expect(tabs).toHaveLength(1);
      expect(tabs[0].filePath).toBe("/docs/other.md");
    });
  });

  describe("createBlankStartupTab", () => {
    it("creates a single blank untitled tab with an empty document", () => {
      createBlankStartupTab(WINDOW);

      const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
      expect(tabs).toHaveLength(1);
      expect(tabs[0].filePath).toBeNull();
      const doc = useDocumentStore.getState().getDocument(tabs[0].id);
      expect(doc?.content).toBe("");
    });
  });
});
