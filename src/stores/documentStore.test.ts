import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "./documentStore";

describe("documentStore", () => {
  const WINDOW_LABEL = "test-window";

  beforeEach(() => {
    // Clear all documents before each test
    const store = useDocumentStore.getState();
    Object.keys(store.documents).forEach((label) => {
      store.removeDocument(label);
    });
  });

  describe("initDocument", () => {
    it("creates a new document with default values", () => {
      const { initDocument, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL);

      const doc = getDocument(WINDOW_LABEL);
      expect(doc).toBeDefined();
      expect(doc?.content).toBe("");
      expect(doc?.savedContent).toBe("");
      expect(doc?.filePath).toBeNull();
      expect(doc?.isDirty).toBe(false);
      expect(doc?.documentId).toBe(0);
      expect(doc?.cursorInfo).toBeNull();
      expect(doc?.lastAutoSave).toBeNull();
      expect(doc?.lineEnding).toBe("unknown");
      expect(doc?.hardBreakStyle).toBe("unknown");
    });

    it("creates a document with initial content", () => {
      const { initDocument, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL, "# Hello World");

      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.content).toBe("# Hello World");
      expect(doc?.savedContent).toBe("# Hello World");
      expect(doc?.isDirty).toBe(false);
    });

    it("creates a document with initial content and filePath", () => {
      const { initDocument, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL, "# Test", "/path/to/file.md");

      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.content).toBe("# Test");
      expect(doc?.filePath).toBe("/path/to/file.md");
    });

    it("sets lastDiskContent to savedContent when savedContent is provided", () => {
      const { initDocument, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL, "Current edits", "/path.md", "Disk baseline");

      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.content).toBe("Current edits");
      expect(doc?.savedContent).toBe("Disk baseline");
      expect(doc?.lastDiskContent).toBe("Disk baseline");
      expect(doc?.isDirty).toBe(true);
    });

    it("marks clean when savedContent matches content", () => {
      const { initDocument, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL, "Same", "/path.md", "Same");

      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.isDirty).toBe(false);
      expect(doc?.lastDiskContent).toBe("Same");
    });
  });

  describe("setContent", () => {
    it("updates content and marks dirty when content differs from saved", () => {
      const { initDocument, setContent, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL, "Original");
      setContent(WINDOW_LABEL, "Modified");

      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.content).toBe("Modified");
      expect(doc?.isDirty).toBe(true);
    });

    it("does not mark dirty when content matches saved content", () => {
      const { initDocument, setContent, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL, "Same content");
      setContent(WINDOW_LABEL, "Same content");

      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.isDirty).toBe(false);
    });

    it("does nothing for non-existent window", () => {
      const { setContent, getDocument } = useDocumentStore.getState();

      setContent("non-existent", "content");

      expect(getDocument("non-existent")).toBeUndefined();
    });
  });

  describe("loadContent", () => {
    it("loads content and resets dirty state", () => {
      const { initDocument, setContent, loadContent, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL, "Initial");
      setContent(WINDOW_LABEL, "Dirty content");
      expect(getDocument(WINDOW_LABEL)?.isDirty).toBe(true);

      loadContent(WINDOW_LABEL, "Loaded content", "/new/path.md");

      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.content).toBe("Loaded content");
      expect(doc?.savedContent).toBe("Loaded content");
      expect(doc?.filePath).toBe("/new/path.md");
      expect(doc?.isDirty).toBe(false);
      expect(doc?.lineEnding).toBe("unknown");
      expect(doc?.hardBreakStyle).toBe("unknown");
    });

    it("applies line metadata when provided", () => {
      const { initDocument, loadContent, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL, "Initial");
      loadContent(WINDOW_LABEL, "Loaded content", "/new/path.md", {
        lineEnding: "crlf",
        hardBreakStyle: "twoSpaces",
      });

      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.lineEnding).toBe("crlf");
      expect(doc?.hardBreakStyle).toBe("twoSpaces");
    });

    it("increments documentId on load", () => {
      const { initDocument, loadContent, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL);
      expect(getDocument(WINDOW_LABEL)?.documentId).toBe(0);

      loadContent(WINDOW_LABEL, "New content");
      expect(getDocument(WINDOW_LABEL)?.documentId).toBe(1);

      loadContent(WINDOW_LABEL, "Another content");
      expect(getDocument(WINDOW_LABEL)?.documentId).toBe(2);
    });
  });

  describe("setFilePath", () => {
    it("updates the file path", () => {
      const { initDocument, setFilePath, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL);
      setFilePath(WINDOW_LABEL, "/updated/path.md");

      expect(getDocument(WINDOW_LABEL)?.filePath).toBe("/updated/path.md");
    });
  });

  describe("markSaved", () => {
    it("clears the dirty flag", () => {
      const { initDocument, setContent, markSaved, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL, "Initial");
      setContent(WINDOW_LABEL, "Modified");
      expect(getDocument(WINDOW_LABEL)?.isDirty).toBe(true);

      markSaved(WINDOW_LABEL);

      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.isDirty).toBe(false);
      expect(doc?.savedContent).toBe("Modified");
    });

    it("keeps isDirty true when content diverged during save (TOCTOU)", () => {
      const { initDocument, setContent, markSaved, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL, "Original");
      // User edits to "Version B"
      setContent(WINDOW_LABEL, "Version B");
      // But the save wrote "Version A" (normalized content from before edit)
      markSaved(WINDOW_LABEL, "Version A");

      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.isDirty).toBe(true);
      expect(doc?.lastDiskContent).toBe("Version A");
      // savedContent should update to what was written to disk
      expect(doc?.savedContent).toBe("Version A");
    });

    it("clears isDirty when content matches disk content", () => {
      const { initDocument, setContent, markSaved, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL, "Original");
      setContent(WINDOW_LABEL, "Saved content");
      markSaved(WINDOW_LABEL, "Saved content");

      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.isDirty).toBe(false);
      expect(doc?.savedContent).toBe("Saved content");
      expect(doc?.lastDiskContent).toBe("Saved content");
    });
  });

  describe("markAutoSaved", () => {
    it("clears dirty flag and sets lastAutoSave timestamp", () => {
      const { initDocument, setContent, markAutoSaved, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL, "Initial");
      setContent(WINDOW_LABEL, "Modified");

      const beforeTime = Date.now();
      markAutoSaved(WINDOW_LABEL);
      const afterTime = Date.now();

      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.isDirty).toBe(false);
      expect(doc?.lastAutoSave).toBeGreaterThanOrEqual(beforeTime);
      expect(doc?.lastAutoSave).toBeLessThanOrEqual(afterTime);
    });

    it("keeps isDirty true when content diverged during auto-save (TOCTOU)", () => {
      const { initDocument, setContent, markAutoSaved, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL, "Original");
      setContent(WINDOW_LABEL, "Edited during save");
      // Auto-save wrote the pre-edit content
      markAutoSaved(WINDOW_LABEL, "Pre-edit content");

      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.isDirty).toBe(true);
      expect(doc?.lastDiskContent).toBe("Pre-edit content");
      expect(doc?.lastAutoSave).not.toBeNull();
    });

    it("clears isDirty when content matches disk content", () => {
      const { initDocument, setContent, markAutoSaved, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL, "Original");
      setContent(WINDOW_LABEL, "Auto-saved content");
      markAutoSaved(WINDOW_LABEL, "Auto-saved content");

      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.isDirty).toBe(false);
      expect(doc?.savedContent).toBe("Auto-saved content");
    });
  });

  describe("markMissing / clearMissing", () => {
    it("sets isMissing to true", () => {
      const { initDocument, markMissing, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL, "content", "/file.md");

      markMissing(WINDOW_LABEL);
      expect(getDocument(WINDOW_LABEL)?.isMissing).toBe(true);
    });

    it("clears isMissing back to false", () => {
      const { initDocument, markMissing, clearMissing, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL, "content", "/file.md");

      markMissing(WINDOW_LABEL);
      expect(getDocument(WINDOW_LABEL)?.isMissing).toBe(true);

      clearMissing(WINDOW_LABEL);
      expect(getDocument(WINDOW_LABEL)?.isMissing).toBe(false);
    });

    it("no-ops for non-existent document", () => {
      const { markMissing, getDocument } = useDocumentStore.getState();
      markMissing("non-existent");
      expect(getDocument("non-existent")).toBeUndefined();
    });
  });

  describe("markDivergent", () => {
    it("sets isDivergent to true", () => {
      const { initDocument, markDivergent, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL, "content", "/file.md");

      markDivergent(WINDOW_LABEL);
      expect(getDocument(WINDOW_LABEL)?.isDivergent).toBe(true);
    });

    it("markSaved clears isDivergent", () => {
      const { initDocument, markDivergent, markSaved, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL, "content", "/file.md");

      markDivergent(WINDOW_LABEL);
      expect(getDocument(WINDOW_LABEL)?.isDivergent).toBe(true);

      markSaved(WINDOW_LABEL, "content");
      expect(getDocument(WINDOW_LABEL)?.isDivergent).toBe(false);
    });
  });

  describe("setLineMetadata", () => {
    it("updates lineEnding", () => {
      const { initDocument, setLineMetadata, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL);

      setLineMetadata(WINDOW_LABEL, { lineEnding: "crlf" });
      expect(getDocument(WINDOW_LABEL)?.lineEnding).toBe("crlf");
      expect(getDocument(WINDOW_LABEL)?.hardBreakStyle).toBe("unknown");
    });

    it("updates hardBreakStyle", () => {
      const { initDocument, setLineMetadata, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL);

      setLineMetadata(WINDOW_LABEL, { hardBreakStyle: "backslash" });
      expect(getDocument(WINDOW_LABEL)?.hardBreakStyle).toBe("backslash");
      expect(getDocument(WINDOW_LABEL)?.lineEnding).toBe("unknown");
    });

    it("updates both at once", () => {
      const { initDocument, setLineMetadata, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL);

      setLineMetadata(WINDOW_LABEL, { lineEnding: "lf", hardBreakStyle: "twoSpaces" });
      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.lineEnding).toBe("lf");
      expect(doc?.hardBreakStyle).toBe("twoSpaces");
    });
  });

  describe("loadContent filePath handling", () => {
    it("preserves existing filePath when filePath arg is undefined", () => {
      const { initDocument, loadContent, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL, "Initial", "/original/path.md");

      loadContent(WINDOW_LABEL, "New content");

      const doc = getDocument(WINDOW_LABEL);
      expect(doc?.filePath).toBe("/original/path.md");
      expect(doc?.content).toBe("New content");
    });

    it("clears filePath when explicitly passed null", () => {
      const { initDocument, loadContent, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL, "Initial", "/original/path.md");

      loadContent(WINDOW_LABEL, "New content", null);

      expect(getDocument(WINDOW_LABEL)?.filePath).toBeNull();
    });
  });

  describe("setCursorInfo", () => {
    it("updates cursor info", () => {
      const { initDocument, setCursorInfo, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL);

      const cursorInfo = {
        sourceLine: 5,
        wordAtCursor: "test",
        offsetInWord: 2,
        nodeType: "paragraph" as const,
        percentInLine: 0.5,
        contextBefore: "abc",
        contextAfter: "xyz",
      };

      setCursorInfo(WINDOW_LABEL, cursorInfo);

      expect(getDocument(WINDOW_LABEL)?.cursorInfo).toEqual(cursorInfo);
    });

    it("can clear cursor info with null", () => {
      const { initDocument, setCursorInfo, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL);
      setCursorInfo(WINDOW_LABEL, {
        sourceLine: 1,
        wordAtCursor: "",
        offsetInWord: 0,
        nodeType: "paragraph",
        percentInLine: 0,
        contextBefore: "",
        contextAfter: "",
      });

      setCursorInfo(WINDOW_LABEL, null);

      expect(getDocument(WINDOW_LABEL)?.cursorInfo).toBeNull();
    });
  });

  describe("setSelectedText", () => {
    it("defaults to empty string after initDocument", () => {
      const { initDocument, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL);
      expect(getDocument(WINDOW_LABEL)?.selectedText).toBe("");
    });

    it("updates selectedText", () => {
      const { initDocument, setSelectedText, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL);
      setSelectedText(WINDOW_LABEL, "hello world");
      expect(getDocument(WINDOW_LABEL)?.selectedText).toBe("hello world");
    });

    it("can clear selectedText", () => {
      const { initDocument, setSelectedText, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL);
      setSelectedText(WINDOW_LABEL, "abc");
      setSelectedText(WINDOW_LABEL, "");
      expect(getDocument(WINDOW_LABEL)?.selectedText).toBe("");
    });

    it("no-ops when tab does not exist", () => {
      const { setSelectedText, getDocument } = useDocumentStore.getState();
      setSelectedText("missing-tab", "x");
      expect(getDocument("missing-tab")).toBeUndefined();
    });

    it("is a no-op when text is unchanged (skips state update)", () => {
      const { initDocument, setSelectedText, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL);
      setSelectedText(WINDOW_LABEL, "abc");
      const docBefore = getDocument(WINDOW_LABEL);
      setSelectedText(WINDOW_LABEL, "abc");
      const docAfter = getDocument(WINDOW_LABEL);
      // Same reference proves no state object was created
      expect(docAfter).toBe(docBefore);
    });

    it("loadContent clears selectedText", () => {
      const { initDocument, setSelectedText, loadContent, getDocument } =
        useDocumentStore.getState();
      initDocument(WINDOW_LABEL);
      setSelectedText(WINDOW_LABEL, "previous");
      loadContent(WINDOW_LABEL, "new content");
      expect(getDocument(WINDOW_LABEL)?.selectedText).toBe("");
    });
  });

  describe("removeDocument", () => {
    it("removes the document from the store", () => {
      const { initDocument, removeDocument, getDocument } = useDocumentStore.getState();

      initDocument(WINDOW_LABEL);
      expect(getDocument(WINDOW_LABEL)).toBeDefined();

      removeDocument(WINDOW_LABEL);

      expect(getDocument(WINDOW_LABEL)).toBeUndefined();
    });
  });

  describe("getAllDirtyDocuments", () => {
    it("returns all tab IDs with dirty documents", () => {
      const { initDocument, setContent, getAllDirtyDocuments } = useDocumentStore.getState();

      initDocument("tab-1", "Content 1");
      initDocument("tab-2", "Content 2");
      initDocument("tab-3", "Content 3");

      setContent("tab-1", "Modified 1");
      setContent("tab-3", "Modified 3");

      const dirtyTabs = getAllDirtyDocuments();
      expect(dirtyTabs).toHaveLength(2);
      expect(dirtyTabs).toContain("tab-1");
      expect(dirtyTabs).toContain("tab-3");
      expect(dirtyTabs).not.toContain("tab-2");
    });

    it("returns empty array when no documents are dirty", () => {
      const { initDocument, getAllDirtyDocuments } = useDocumentStore.getState();

      initDocument("tab-1");
      initDocument("tab-2");

      expect(getAllDirtyDocuments()).toHaveLength(0);
    });
  });

  describe("multiple windows", () => {
    it("maintains separate state for each window", () => {
      const { initDocument, setContent, getDocument } = useDocumentStore.getState();

      initDocument("window-1", "Content A");
      initDocument("window-2", "Content B");

      setContent("window-1", "Modified A");

      expect(getDocument("window-1")?.content).toBe("Modified A");
      expect(getDocument("window-1")?.isDirty).toBe(true);
      expect(getDocument("window-2")?.content).toBe("Content B");
      expect(getDocument("window-2")?.isDirty).toBe(false);
    });
  });

  describe("readOnly", () => {
    it("defaults to false on new documents", () => {
      const { initDocument, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL, "test");
      expect(getDocument(WINDOW_LABEL)?.readOnly).toBe(false);
    });

    it("setReadOnly sets readOnly flag", () => {
      const { initDocument, setReadOnly, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL, "test");
      setReadOnly(WINDOW_LABEL, true);
      expect(getDocument(WINDOW_LABEL)?.readOnly).toBe(true);
      setReadOnly(WINDOW_LABEL, false);
      expect(getDocument(WINDOW_LABEL)?.readOnly).toBe(false);
    });

    it("toggleReadOnly toggles readOnly flag", () => {
      const { initDocument, toggleReadOnly, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL, "test");
      expect(getDocument(WINDOW_LABEL)?.readOnly).toBe(false);
      toggleReadOnly(WINDOW_LABEL);
      expect(getDocument(WINDOW_LABEL)?.readOnly).toBe(true);
      toggleReadOnly(WINDOW_LABEL);
      expect(getDocument(WINDOW_LABEL)?.readOnly).toBe(false);
    });

    it("isReadOnly returns correct value", () => {
      const { initDocument, setReadOnly, isReadOnly } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL, "test");
      expect(isReadOnly(WINDOW_LABEL)).toBe(false);
      setReadOnly(WINDOW_LABEL, true);
      expect(isReadOnly(WINDOW_LABEL)).toBe(true);
    });

    it("isReadOnly returns false for non-existent tab", () => {
      expect(useDocumentStore.getState().isReadOnly("nonexistent")).toBe(false);
    });

    it("readOnly survives content updates", () => {
      const { initDocument, setReadOnly, setContent, getDocument } = useDocumentStore.getState();
      initDocument(WINDOW_LABEL, "test");
      setReadOnly(WINDOW_LABEL, true);
      setContent(WINDOW_LABEL, "updated");
      expect(getDocument(WINDOW_LABEL)?.readOnly).toBe(true);
    });

    it("setReadOnly no-ops for non-existent tab", () => {
      useDocumentStore.getState().setReadOnly("nonexistent", true);
      expect(useDocumentStore.getState().isReadOnly("nonexistent")).toBe(false);
    });
  });
});
