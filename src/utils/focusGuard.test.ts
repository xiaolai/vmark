import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { shouldBlockMenuAction, isEditorContext } from "./focusGuard";

describe("focusGuard", () => {
  // Helper to create a mock element with closest() behavior
  function createMockElement(closestResults: Record<string, boolean>): Element {
    return {
      closest: vi.fn((selector: string) => {
        return closestResults[selector] ? {} : null;
      }),
    } as unknown as Element;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("shouldBlockMenuAction", () => {
    it("blocks when find bar input is focused", () => {
      const mockElement = createMockElement({ ".find-bar": true });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);

      expect(shouldBlockMenuAction()).toBe(true);
    });

    it("blocks when file explorer rename is active", () => {
      const mockElement = createMockElement({ ".rename-input": true });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);

      expect(shouldBlockMenuAction()).toBe(true);
    });

    it("blocks when quick open is focused", () => {
      const mockElement = createMockElement({ ".quick-open": true });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);

      expect(shouldBlockMenuAction()).toBe(true);
    });

    it("blocks when settings dialog input is focused", () => {
      const mockElement = createMockElement({ ".settings-dialog input": true });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);

      expect(shouldBlockMenuAction()).toBe(true);
    });

    it("blocks when settings dialog textarea is focused", () => {
      const mockElement = createMockElement({ ".settings-dialog textarea": true });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);

      expect(shouldBlockMenuAction()).toBe(true);
    });

    it("does NOT block for link popup", () => {
      const mockElement = createMockElement({
        "[role='dialog'][aria-modal='true']": true,
        ".link-popup": true,
      });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);
      vi.spyOn(document, "querySelector").mockReturnValue({} as Element);

      expect(shouldBlockMenuAction()).toBe(false);
    });

    it("does NOT block for wiki-link popup", () => {
      const mockElement = createMockElement({
        "[role='dialog'][aria-modal='true']": true,
        ".wiki-link-popup": true,
      });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);
      vi.spyOn(document, "querySelector").mockReturnValue({} as Element);

      expect(shouldBlockMenuAction()).toBe(false);
    });

    it("does NOT block for image popup", () => {
      const mockElement = createMockElement({
        "[role='dialog'][aria-modal='true']": true,
        ".image-popup": true,
      });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);
      vi.spyOn(document, "querySelector").mockReturnValue({} as Element);

      expect(shouldBlockMenuAction()).toBe(false);
    });

    it("blocks for generic modal dialog", () => {
      const mockElement = createMockElement({
        "[role='dialog'][aria-modal='true']": true,
        ".link-popup": false,
        ".wiki-link-popup": false,
        ".image-popup": false,
      });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);
      vi.spyOn(document, "querySelector").mockReturnValue({} as Element);

      expect(shouldBlockMenuAction()).toBe(true);
    });

    it("does NOT block when editor is focused (normal case)", () => {
      const mockElement = createMockElement({
        ".find-bar": false,
        ".rename-input": false,
        ".quick-open": false,
        ".settings-dialog input": false,
        ".settings-dialog textarea": false,
        "[role='dialog'][aria-modal='true']": false,
        ".ProseMirror": true,
      });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);
      vi.spyOn(document, "querySelector").mockReturnValue(null);

      expect(shouldBlockMenuAction()).toBe(false);
    });

    it("does NOT block when no activeElement", () => {
      vi.spyOn(document, "activeElement", "get").mockReturnValue(null);
      vi.spyOn(document, "querySelector").mockReturnValue(null);

      expect(shouldBlockMenuAction()).toBe(false);
    });

    it("blocks when modal exists but focus is inside non-editor modal", () => {
      const mockElement = createMockElement({
        "[role='dialog'][aria-modal='true']": true,
        ".link-popup": false,
        ".wiki-link-popup": false,
        ".image-popup": false,
      });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);
      vi.spyOn(document, "querySelector").mockReturnValue({} as Element);

      expect(shouldBlockMenuAction()).toBe(true);
    });

    it("does NOT block when modal exists but focus is outside modal", () => {
      const mockElement = createMockElement({
        "[role='dialog'][aria-modal='true']": false,
        ".ProseMirror": true,
      });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);
      vi.spyOn(document, "querySelector").mockReturnValue({} as Element);

      expect(shouldBlockMenuAction()).toBe(false);
    });
  });

  describe("isEditorContext", () => {
    it("returns true for WYSIWYG editor (.ProseMirror)", () => {
      const mockElement = createMockElement({
        ".ProseMirror": true,
        ".cm-editor": false,
        ".editor-container": false,
      });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);

      expect(isEditorContext()).toBe(true);
    });

    it("returns true for Source editor (.cm-editor)", () => {
      const mockElement = createMockElement({
        ".ProseMirror": false,
        ".cm-editor": true,
        ".editor-container": false,
      });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);

      expect(isEditorContext()).toBe(true);
    });

    it("returns true for editor-container", () => {
      const mockElement = createMockElement({
        ".ProseMirror": false,
        ".cm-editor": false,
        ".editor-container": true,
      });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);

      expect(isEditorContext()).toBe(true);
    });

    it("returns false for other contexts", () => {
      const mockElement = createMockElement({
        ".ProseMirror": false,
        ".cm-editor": false,
        ".editor-container": false,
        ".sidebar": true,
      });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);

      expect(isEditorContext()).toBe(false);
    });

    it("returns false when no activeElement", () => {
      vi.spyOn(document, "activeElement", "get").mockReturnValue(null);

      expect(isEditorContext()).toBe(false);
    });

    it("returns false for find bar", () => {
      const mockElement = createMockElement({
        ".ProseMirror": false,
        ".cm-editor": false,
        ".editor-container": false,
        ".find-bar": true,
      });
      vi.spyOn(document, "activeElement", "get").mockReturnValue(mockElement);

      expect(isEditorContext()).toBe(false);
    });
  });
});
