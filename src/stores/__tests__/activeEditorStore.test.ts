import { describe, it, expect, beforeEach } from "vitest";
import { useActiveEditorStore } from "../activeEditorStore";

beforeEach(() => {
  useActiveEditorStore.setState({
    activeWysiwygEditor: null,
    activeWysiwygTabId: null,
    activeSourceView: null,
    activeSourceTabId: null,
  });
});

describe("activeEditorStore", () => {
  describe("setActiveWysiwygEditor", () => {
    it("sets the WYSIWYG editor reference", () => {
      const mockEditor = { id: "editor-1" } as never;
      useActiveEditorStore.getState().setActiveWysiwygEditor(mockEditor);
      expect(useActiveEditorStore.getState().activeWysiwygEditor).toBe(mockEditor);
    });

    it("clears with null", () => {
      const mockEditor = { id: "editor-1" } as never;
      useActiveEditorStore.getState().setActiveWysiwygEditor(mockEditor);
      useActiveEditorStore.getState().setActiveWysiwygEditor(null);
      expect(useActiveEditorStore.getState().activeWysiwygEditor).toBeNull();
    });
  });

  describe("setActiveSourceView", () => {
    it("sets the Source view reference", () => {
      const mockView = { id: "view-1" } as never;
      useActiveEditorStore.getState().setActiveSourceView(mockView);
      expect(useActiveEditorStore.getState().activeSourceView).toBe(mockView);
    });
  });

  describe("clearWysiwygEditorIfMatch", () => {
    it("clears when editor matches", () => {
      const mockEditor = { id: "editor-1" } as never;
      useActiveEditorStore.getState().setActiveWysiwygEditor(mockEditor);
      useActiveEditorStore.getState().clearWysiwygEditorIfMatch(mockEditor);
      expect(useActiveEditorStore.getState().activeWysiwygEditor).toBeNull();
    });

    it("does NOT clear when editor does not match", () => {
      const editorA = { id: "editor-A" } as never;
      const editorB = { id: "editor-B" } as never;
      useActiveEditorStore.getState().setActiveWysiwygEditor(editorA);
      useActiveEditorStore.getState().clearWysiwygEditorIfMatch(editorB);
      expect(useActiveEditorStore.getState().activeWysiwygEditor).toBe(editorA);
    });

    it("handles clear when no editor is active", () => {
      const mockEditor = { id: "editor-1" } as never;
      // Should not throw
      useActiveEditorStore.getState().clearWysiwygEditorIfMatch(mockEditor);
      expect(useActiveEditorStore.getState().activeWysiwygEditor).toBeNull();
    });
  });

  describe("clearSourceViewIfMatch", () => {
    it("clears when view matches", () => {
      const mockView = { id: "view-1" } as never;
      useActiveEditorStore.getState().setActiveSourceView(mockView);
      useActiveEditorStore.getState().clearSourceViewIfMatch(mockView);
      expect(useActiveEditorStore.getState().activeSourceView).toBeNull();
    });

    it("does NOT clear when view does not match (race condition guard)", () => {
      const viewOld = { id: "old" } as never;
      const viewNew = { id: "new" } as never;
      // Simulate: new view focuses, then old view's blur fires
      useActiveEditorStore.getState().setActiveSourceView(viewNew);
      useActiveEditorStore.getState().clearSourceViewIfMatch(viewOld);
      // New view should still be active
      expect(useActiveEditorStore.getState().activeSourceView).toBe(viewNew);
    });
  });

  describe("clearActiveEditors", () => {
    it("clears both editors", () => {
      useActiveEditorStore.getState().setActiveWysiwygEditor({ id: "w" } as never);
      useActiveEditorStore.getState().setActiveSourceView({ id: "s" } as never);
      useActiveEditorStore.getState().clearActiveEditors();
      expect(useActiveEditorStore.getState().activeWysiwygEditor).toBeNull();
      expect(useActiveEditorStore.getState().activeSourceView).toBeNull();
    });
  });

  describe("tabId binding", () => {
    it("setActiveWysiwygEditor records the bound tabId", () => {
      const editor = { id: "w" } as never;
      useActiveEditorStore.getState().setActiveWysiwygEditor(editor, "tab-1");
      expect(useActiveEditorStore.getState().activeWysiwygTabId).toBe("tab-1");
    });

    it("setActiveSourceView records the bound tabId", () => {
      const view = { id: "s" } as never;
      useActiveEditorStore.getState().setActiveSourceView(view, "tab-2");
      expect(useActiveEditorStore.getState().activeSourceTabId).toBe("tab-2");
    });

    it("clearing the WYSIWYG editor also clears its tabId", () => {
      const editor = { id: "w" } as never;
      useActiveEditorStore.getState().setActiveWysiwygEditor(editor, "tab-3");
      useActiveEditorStore.getState().setActiveWysiwygEditor(null);
      expect(useActiveEditorStore.getState().activeWysiwygTabId).toBeNull();
    });

    it("clearWysiwygEditorIfMatch also clears the bound tabId", () => {
      const editor = { id: "w" } as never;
      useActiveEditorStore.getState().setActiveWysiwygEditor(editor, "tab-4");
      useActiveEditorStore.getState().clearWysiwygEditorIfMatch(editor);
      expect(useActiveEditorStore.getState().activeWysiwygTabId).toBeNull();
    });

    it("clearActiveEditors clears both tabIds", () => {
      useActiveEditorStore
        .getState()
        .setActiveWysiwygEditor({ id: "w" } as never, "tab-w");
      useActiveEditorStore
        .getState()
        .setActiveSourceView({ id: "s" } as never, "tab-s");
      useActiveEditorStore.getState().clearActiveEditors();
      expect(useActiveEditorStore.getState().activeWysiwygTabId).toBeNull();
      expect(useActiveEditorStore.getState().activeSourceTabId).toBeNull();
    });

    it("setting a new editor for a different tab updates the bound tabId", () => {
      useActiveEditorStore
        .getState()
        .setActiveWysiwygEditor({ id: "old" } as never, "tab-old");
      useActiveEditorStore
        .getState()
        .setActiveWysiwygEditor({ id: "new" } as never, "tab-new");
      expect(useActiveEditorStore.getState().activeWysiwygTabId).toBe("tab-new");
    });
  });
});
