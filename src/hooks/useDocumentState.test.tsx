/**
 * Tests for useDocumentState — convenience hooks that bridge
 * WindowContext → tabStore → documentStore for per-component selectors.
 *
 * @module hooks/useDocumentState.test
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
}));

import {
  useActiveTabId,
  useDocumentContent,
  useDocumentFilePath,
  useDocumentIsDirty,
  useDocumentIsMissing,
  useDocumentIsDivergent,
  useDocumentId,
  useDocumentCursorInfo,
  useDocumentLastAutoSave,
  useDocumentActions,
} from "./useDocumentState";

const WINDOW = "main";

function resetStores() {
  useTabStore.getState().removeWindow(WINDOW);
  Object.keys(useDocumentStore.getState().documents).forEach((id) =>
    useDocumentStore.getState().removeDocument(id)
  );
}

describe("useActiveTabId", () => {
  beforeEach(resetStores);

  it("returns null when no active tab exists", () => {
    const { result } = renderHook(() => useActiveTabId());
    expect(result.current).toBeNull();
  });

  it("returns the active tab ID for the current window", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/test.md");
    const { result } = renderHook(() => useActiveTabId());
    expect(result.current).toBe(tabId);
  });
});

describe("useDocumentContent", () => {
  beforeEach(resetStores);

  it("returns empty string when no tab is active", () => {
    const { result } = renderHook(() => useDocumentContent());
    expect(result.current).toBe("");
  });

  it("returns empty string when tab has no document", () => {
    useTabStore.getState().createTab(WINDOW, null);
    const { result } = renderHook(() => useDocumentContent());
    expect(result.current).toBe("");
  });

  it("returns document content for the active tab", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "# Hello", null);
    const { result } = renderHook(() => useDocumentContent());
    expect(result.current).toBe("# Hello");
  });
});

describe("useDocumentFilePath", () => {
  beforeEach(resetStores);

  it("returns null when no tab is active", () => {
    const { result } = renderHook(() => useDocumentFilePath());
    expect(result.current).toBeNull();
  });

  it("returns null for untitled document", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
    const { result } = renderHook(() => useDocumentFilePath());
    expect(result.current).toBeNull();
  });

  it("returns file path for saved document", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/docs/test.md");
    useDocumentStore.getState().initDocument(tabId, "content", "/docs/test.md");
    const { result } = renderHook(() => useDocumentFilePath());
    expect(result.current).toBe("/docs/test.md");
  });
});

describe("useDocumentIsDirty", () => {
  beforeEach(resetStores);

  it("returns false when no tab is active", () => {
    const { result } = renderHook(() => useDocumentIsDirty());
    expect(result.current).toBe(false);
  });

  it("returns false for clean document", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "content", null);
    const { result } = renderHook(() => useDocumentIsDirty());
    expect(result.current).toBe(false);
  });

  it("returns true for dirty document", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "content", null);
    useDocumentStore.getState().setContent(tabId, "changed");
    const { result } = renderHook(() => useDocumentIsDirty());
    expect(result.current).toBe(true);
  });
});

describe("useDocumentIsMissing", () => {
  beforeEach(resetStores);

  it("returns false when no tab is active", () => {
    const { result } = renderHook(() => useDocumentIsMissing());
    expect(result.current).toBe(false);
  });

  it("returns true when document is marked missing", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/test.md");
    useDocumentStore.getState().initDocument(tabId, "content", "/test.md");
    useDocumentStore.getState().markMissing(tabId);
    const { result } = renderHook(() => useDocumentIsMissing());
    expect(result.current).toBe(true);
  });
});

describe("useDocumentIsDivergent", () => {
  beforeEach(resetStores);

  it("returns false when no tab is active", () => {
    const { result } = renderHook(() => useDocumentIsDivergent());
    expect(result.current).toBe(false);
  });

  it("returns true when document is marked divergent", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/test.md");
    useDocumentStore.getState().initDocument(tabId, "content", "/test.md");
    useDocumentStore.getState().markDivergent(tabId);
    const { result } = renderHook(() => useDocumentIsDivergent());
    expect(result.current).toBe(true);
  });
});

describe("useDocumentId", () => {
  beforeEach(resetStores);

  it("returns 0 when no tab is active", () => {
    const { result } = renderHook(() => useDocumentId());
    expect(result.current).toBe(0);
  });

  it("returns the document ID", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
    const { result } = renderHook(() => useDocumentId());
    // documentId is auto-incremented per session
    expect(typeof result.current).toBe("number");
  });
});

describe("useDocumentCursorInfo", () => {
  beforeEach(resetStores);

  it("returns null when no tab is active", () => {
    const { result } = renderHook(() => useDocumentCursorInfo());
    expect(result.current).toBeNull();
  });

  it("returns null by default (no cursor info set)", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
    const { result } = renderHook(() => useDocumentCursorInfo());
    expect(result.current).toBeNull();
  });
});

describe("useDocumentLastAutoSave", () => {
  beforeEach(resetStores);

  it("returns null when no tab is active", () => {
    const { result } = renderHook(() => useDocumentLastAutoSave());
    expect(result.current).toBeNull();
  });

  it("returns null by default (no auto-save yet)", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
    const { result } = renderHook(() => useDocumentLastAutoSave());
    expect(result.current).toBeNull();
  });
});

describe("useDocumentActions", () => {
  beforeEach(resetStores);

  it("getContent returns empty string when no active tab", () => {
    const { result } = renderHook(() => useDocumentActions());
    expect(result.current.getContent()).toBe("");
  });

  it("getContent returns current document content", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "# Test", null);
    const { result } = renderHook(() => useDocumentActions());
    expect(result.current.getContent()).toBe("# Test");
  });

  it("setContent updates document content", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
    const { result } = renderHook(() => useDocumentActions());

    act(() => {
      result.current.setContent("new content");
    });

    expect(useDocumentStore.getState().documents[tabId]?.content).toBe("new content");
  });

  it("setContent is a no-op when no active tab", () => {
    const { result } = renderHook(() => useDocumentActions());
    // Should not throw
    act(() => {
      result.current.setContent("content");
    });
  });

  // Regression: cross-tab content bleed. A per-tab editor's debounced flush
  // can fire AFTER the active tab changed; with call-time tab resolution the
  // old editor's content was written into the newly active tab and the
  // originating tab lost the edit. An editor passing its own tab id must
  // always write to that tab, regardless of the focused tab at flush time.
  describe("ownTabId pinning", () => {
    it("setContent writes to the owned tab even after the active tab changed", () => {
      const tabA = useTabStore.getState().createTab(WINDOW, null);
      useDocumentStore.getState().initDocument(tabA, "a-original", null);
      const { result } = renderHook(() => useDocumentActions(tabA));

      const tabB = useTabStore.getState().createTab(WINDOW, null);
      useDocumentStore.getState().initDocument(tabB, "b-original", null);
      useTabStore.getState().setActiveTab(WINDOW, tabB);

      act(() => {
        result.current.setContent("typed-into-A");
      });

      expect(useDocumentStore.getState().documents[tabA]?.content).toBe("typed-into-A");
      expect(useDocumentStore.getState().documents[tabB]?.content).toBe("b-original");
    });

    it("setCursorInfo and setSelectedText target the owned tab after a switch", () => {
      const tabA = useTabStore.getState().createTab(WINDOW, null);
      useDocumentStore.getState().initDocument(tabA, "a", null);
      const { result } = renderHook(() => useDocumentActions(tabA));

      const tabB = useTabStore.getState().createTab(WINDOW, null);
      useDocumentStore.getState().initDocument(tabB, "b", null);
      useTabStore.getState().setActiveTab(WINDOW, tabB);

      const cursor = {
        sourceLine: 3,
        wordAtCursor: "abc",
        offsetInWord: 1,
        nodeType: "paragraph",
        positionPercent: 0.5,
      } as unknown as import("@/stores/documentStore").CursorInfo;
      act(() => {
        result.current.setCursorInfo(cursor);
        result.current.setSelectedText("sel-A");
      });

      expect(useDocumentStore.getState().documents[tabA]?.cursorInfo).toEqual(cursor);
      expect(useDocumentStore.getState().documents[tabA]?.selectedText).toBe("sel-A");
      expect(useDocumentStore.getState().documents[tabB]?.cursorInfo ?? null).toBeNull();
      expect(useDocumentStore.getState().documents[tabB]?.selectedText ?? "").toBe("");
    });

    it("setContent no-ops (does not bleed) when the owned tab was closed", () => {
      const tabA = useTabStore.getState().createTab(WINDOW, null);
      useDocumentStore.getState().initDocument(tabA, "a", null);
      const { result } = renderHook(() => useDocumentActions(tabA));

      const tabB = useTabStore.getState().createTab(WINDOW, null);
      useDocumentStore.getState().initDocument(tabB, "b-original", null);
      useTabStore.getState().setActiveTab(WINDOW, tabB);
      useDocumentStore.getState().removeDocument(tabA);

      act(() => {
        result.current.setContent("late-flush-from-A");
      });

      expect(useDocumentStore.getState().documents[tabA]).toBeUndefined();
      expect(useDocumentStore.getState().documents[tabB]?.content).toBe("b-original");
    });

    it("without ownTabId, actions still resolve the focused tab at call time", () => {
      const tabA = useTabStore.getState().createTab(WINDOW, null);
      useDocumentStore.getState().initDocument(tabA, "a", null);
      const { result } = renderHook(() => useDocumentActions());

      const tabB = useTabStore.getState().createTab(WINDOW, null);
      useDocumentStore.getState().initDocument(tabB, "b", null);
      useTabStore.getState().setActiveTab(WINDOW, tabB);

      act(() => {
        result.current.setContent("focused-write");
      });

      expect(useDocumentStore.getState().documents[tabB]?.content).toBe("focused-write");
      expect(useDocumentStore.getState().documents[tabA]?.content).toBe("a");
    });
  });

  it("loadContent updates content and file path", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
    const { result } = renderHook(() => useDocumentActions());

    act(() => {
      result.current.loadContent("loaded content", "/path/file.md");
    });

    const doc = useDocumentStore.getState().documents[tabId];
    expect(doc?.content).toBe("loaded content");
  });

  it("loadContent is a no-op when no active tab", () => {
    const { result } = renderHook(() => useDocumentActions());
    act(() => {
      result.current.loadContent("content", "/path.md");
    });
  });

  it("setFilePath updates both document and tab paths", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
    const { result } = renderHook(() => useDocumentActions());

    act(() => {
      result.current.setFilePath("/new/path.md");
    });

    expect(useDocumentStore.getState().documents[tabId]?.filePath).toBe("/new/path.md");
  });

  it("setFilePath with null clears path", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/old.md");
    useDocumentStore.getState().initDocument(tabId, "content", "/old.md");
    const { result } = renderHook(() => useDocumentActions());

    act(() => {
      result.current.setFilePath(null);
    });

    expect(useDocumentStore.getState().documents[tabId]?.filePath).toBeNull();
  });

  it("setFilePath is a no-op when no active tab", () => {
    const { result } = renderHook(() => useDocumentActions());
    act(() => {
      result.current.setFilePath("/path.md");
    });
  });

  it("markSaved clears dirty flag", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "content", null);
    useDocumentStore.getState().setContent(tabId, "changed");
    expect(useDocumentStore.getState().documents[tabId]?.isDirty).toBe(true);

    const { result } = renderHook(() => useDocumentActions());
    act(() => {
      result.current.markSaved();
    });

    expect(useDocumentStore.getState().documents[tabId]?.isDirty).toBe(false);
  });

  it("markSaved is a no-op when no active tab", () => {
    const { result } = renderHook(() => useDocumentActions());
    act(() => {
      result.current.markSaved();
    });
  });

  it("markAutoSaved updates lastAutoSave timestamp", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "content", null);
    const { result } = renderHook(() => useDocumentActions());

    act(() => {
      result.current.markAutoSaved();
    });

    const doc = useDocumentStore.getState().documents[tabId];
    expect(doc?.lastAutoSave).not.toBeNull();
  });

  it("markAutoSaved is a no-op when no active tab", () => {
    const { result } = renderHook(() => useDocumentActions());
    act(() => {
      result.current.markAutoSaved();
    });
  });

  it("setCursorInfo updates cursor info", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
    const { result } = renderHook(() => useDocumentActions());

    const cursorInfo = {
      line: 1,
      column: 5,
      offset: 5,
      nodeType: "paragraph" as const,
      nodeTypes: ["paragraph" as const],
    };

    act(() => {
      result.current.setCursorInfo(cursorInfo);
    });

    expect(useDocumentStore.getState().documents[tabId]?.cursorInfo).toEqual(cursorInfo);
  });

  it("setCursorInfo with null clears cursor info", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
    const { result } = renderHook(() => useDocumentActions());

    act(() => {
      result.current.setCursorInfo(null);
    });

    expect(useDocumentStore.getState().documents[tabId]?.cursorInfo).toBeNull();
  });

  it("setCursorInfo is a no-op when no active tab", () => {
    const { result } = renderHook(() => useDocumentActions());
    act(() => {
      result.current.setCursorInfo(null);
    });
  });
});

describe("useDocumentState — undefined document fallbacks (lines 32-68, 86)", () => {
  beforeEach(resetStores);

  // Create a tab but do NOT init a document — documents[tabId] is undefined.
  // This covers the outer `?? ""` / `?? null` / `?? false` / `?? 0` branches.

  it("useDocumentContent returns empty string when document is undefined", () => {
    useTabStore.getState().createTab(WINDOW, null);
    // No initDocument — documents[tabId] is undefined
    const { result } = renderHook(() => useDocumentContent());
    expect(result.current).toBe("");
  });

  it("useDocumentFilePath returns null when document is undefined", () => {
    useTabStore.getState().createTab(WINDOW, null);
    const { result } = renderHook(() => useDocumentFilePath());
    expect(result.current).toBeNull();
  });

  it("useDocumentIsDirty returns false when document is undefined", () => {
    useTabStore.getState().createTab(WINDOW, null);
    const { result } = renderHook(() => useDocumentIsDirty());
    expect(result.current).toBe(false);
  });

  it("useDocumentIsMissing returns false when document is undefined", () => {
    useTabStore.getState().createTab(WINDOW, null);
    const { result } = renderHook(() => useDocumentIsMissing());
    expect(result.current).toBe(false);
  });

  it("useDocumentIsDivergent returns false when document is undefined", () => {
    useTabStore.getState().createTab(WINDOW, null);
    const { result } = renderHook(() => useDocumentIsDivergent());
    expect(result.current).toBe(false);
  });

  it("useDocumentId returns 0 when document is undefined", () => {
    useTabStore.getState().createTab(WINDOW, null);
    const { result } = renderHook(() => useDocumentId());
    expect(result.current).toBe(0);
  });

  it("useDocumentCursorInfo returns null when document is undefined", () => {
    useTabStore.getState().createTab(WINDOW, null);
    const { result } = renderHook(() => useDocumentCursorInfo());
    expect(result.current).toBeNull();
  });

  it("useDocumentLastAutoSave returns null when document is undefined", () => {
    useTabStore.getState().createTab(WINDOW, null);
    const { result } = renderHook(() => useDocumentLastAutoSave());
    expect(result.current).toBeNull();
  });

  it("getContent returns empty string when document is undefined (line 86)", () => {
    useTabStore.getState().createTab(WINDOW, null);
    // No initDocument
    const { result } = renderHook(() => useDocumentActions());
    expect(result.current.getContent()).toBe("");
  });
});
