// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOpenFileInNewTabCore = vi.fn(async () => {});
vi.mock("@/services/navigation/fileOpen", () => ({
  openFileInNewTabCore: (...args: unknown[]) => mockOpenFileInNewTabCore(...args),
}));

import {
  loadStartupFileIntoTab,
  loadStartupFilesIntoTabs,
  createBlankStartupTab,
  parseStartupFilesParam,
} from "./startupFileOpen";
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
      // Core refuses (e.g. oversized file) → creates no tab. The fallback now
      // lives on the BATCH entry point, not on the per-file one.
      mockOpenFileInNewTabCore.mockImplementation(async () => "refused");

      await loadStartupFilesIntoTabs(WINDOW, ["/docs/huge.md"]);

      const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
      expect(tabs).toHaveLength(1);
      expect(tabs[0].filePath).toBeNull();
    });

    it("does NOT add a blank tab when the window already has a tab", async () => {
      const existing = useTabStore.getState().createTab(WINDOW, "/docs/other.md");
      useDocumentStore.getState().initDocument(existing, "x", "/docs/other.md");
      mockOpenFileInNewTabCore.mockImplementation(async () => "refused");

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

/**
 * The fallback used to run per file and decide from a tab COUNT taken after an
 * await. Three separate defects came out of that one mistake — all of them
 * invisible, because every one produced a plausible-looking window.
 */
describe("loadStartupFilesIntoTabs — outcomes, not counts", () => {
  // Own cleanup: this block sits outside the suite above, so it does not
  // inherit its beforeEach and tabs would otherwise accumulate across cases.
  beforeEach(() => {
    vi.clearAllMocks();
    useTabStore.getState().removeWindow(WINDOW);
    Object.keys(useDocumentStore.getState().documents).forEach((id) =>
      useDocumentStore.getState().removeDocument(id)
    );
  });

  it("does not leave an orphan when an earlier path fails and a later one opens", async () => {
    // The count version created a blank tab for the failure, then the success
    // opened beside it — producing exactly the orphan the count was meant to
    // prevent.
    mockOpenFileInNewTabCore.mockImplementation(async (label: string, path: string) => {
      if (path.includes("bad")) return "failed";
      useTabStore.getState().createTab(label, path);
      return "opened";
    });

    await loadStartupFilesIntoTabs(WINDOW, ["/docs/bad.md", "/docs/good.md"]);

    const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].filePath).toBe("/docs/good.md");
  });

  it("respects a tab the user closed mid-read instead of resurrecting it", async () => {
    // `closed` and `failed` are identical in a tab count, so the old fallback
    // re-created a tab the user had deliberately shut — defeating
    // openFileInNewTabCore's own close-during-read guard.
    mockOpenFileInNewTabCore.mockImplementation(async () => "closed");

    await loadStartupFilesIntoTabs(WINDOW, ["/docs/a.md"]);

    expect(useTabStore.getState().getTabsByWindow(WINDOW)).toHaveLength(0);
  });

  it("keeps opening the rest of the batch when one path throws", async () => {
    // A rejection used to propagate out of the caller's loop and abandon every
    // remaining launch argument.
    mockOpenFileInNewTabCore.mockImplementation(async (label: string, path: string) => {
      if (path.includes("throws")) throw new Error("native dialog exploded");
      useTabStore.getState().createTab(label, path);
      return "opened";
    });

    await loadStartupFilesIntoTabs(WINDOW, ["/docs/throws.md", "/docs/after.md"]);

    const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
    expect(tabs.map((t) => t.filePath)).toEqual(["/docs/after.md"]);
  });

  it("creates nothing when asked for nothing (workspace mode has no blank tab)", async () => {
    await loadStartupFilesIntoTabs(WINDOW, []);
    expect(useTabStore.getState().getTabsByWindow(WINDOW)).toHaveLength(0);
    expect(mockOpenFileInNewTabCore).not.toHaveBeenCalled();
  });

  it("still falls back when every path genuinely failed", async () => {
    mockOpenFileInNewTabCore.mockImplementation(async () => "failed");
    await loadStartupFilesIntoTabs(WINDOW, ["/docs/a.md", "/docs/b.md"]);
    const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].filePath).toBeNull();
  });
});

/**
 * The production parser had NO direct tests. `WindowContext.test.tsx` mocked
 * the module with a hand-written copy of this logic, so the orchestration
 * tests exercised the copy and stayed green no matter what the real parser
 * did — the copy could drift arbitrarily and nothing would say so.
 */
describe("parseStartupFilesParam", () => {
  it.each([
    ["null param", null, null],
    ["empty string", "", null],
    ["not JSON", "not-json", null],
    ["JSON but not an array", '{"a":1}', null],
    ["array of strings", '["/a.md","/b.md"]', ["/a.md", "/b.md"]],
    ["mixed types keeps only strings", '["/a.md",7,null,{"x":1},"/b.md"]', ["/a.md", "/b.md"]],
    ["empty strings are rejected", '["","/a.md",""]', ["/a.md"]],
    ["all-empty array yields an empty list", '["",""]', []],
    ["empty array", "[]", []],
  ])("%s", (_name, input, expected) => {
    expect(parseStartupFilesParam(input as string | null)).toEqual(expected);
  });
});
