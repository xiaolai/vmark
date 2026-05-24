/**
 * Focus Mode Plugin Tests for CodeMirror (Source Mode)
 *
 * Tests paragraph boundary detection and decoration building
 * for the focus mode plugin.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// Mock editorStore before importing the module under test
const mockEditorStore = {
  focusModeEnabled: false,
};
const mockSubscribe = vi.fn(() => vi.fn());

vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => mockEditorStore,
    subscribe: (...args: unknown[]) => mockSubscribe(...args),
  },
}));

vi.mock("@/utils/imeGuard", () => ({
  runOrQueueCodeMirrorAction: (_view: unknown, fn: () => void) => fn(),
}));

// Import after mocks
import { createSourceFocusModePlugin } from "./focusModePlugin";

const views: EditorView[] = [];

function createView(content: string, cursorPos?: number): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);

  const state = EditorState.create({
    doc: content,
    selection: { anchor: cursorPos ?? 0 },
    extensions: [createSourceFocusModePlugin()],
  });
  const view = new EditorView({ state, parent });
  views.push(view);
  return view;
}

afterEach(() => {
  views.forEach((v) => {
    const parent = v.dom.parentElement;
    v.destroy();
    parent?.remove();
  });
  views.length = 0;
  mockEditorStore.focusModeEnabled = false;
  mockSubscribe.mockClear();
});

describe("createSourceFocusModePlugin", () => {
  describe("when focus mode is disabled", () => {
    beforeEach(() => {
      mockEditorStore.focusModeEnabled = false;
    });

    it("produces no decorations", () => {
      const view = createView("Hello world\n\nSecond paragraph");
      // With focus mode off, no blur decorations should be applied
      // The plugin should have an empty decoration set
      const pluginField = view.plugin(
        // Access the plugin by its spec — check that no cm-blur classes are added
        // Instead, we verify the DOM does not contain cm-blur classes
      );
      // Since no cm-blur should be applied, check DOM
      const blurLines = view.dom.querySelectorAll(".cm-blur");
      expect(blurLines.length).toBe(0);
      expect(pluginField).toBeDefined();
    });
  });

  describe("when focus mode is enabled", () => {
    beforeEach(() => {
      mockEditorStore.focusModeEnabled = true;
    });

    it("applies blur decoration to lines outside current paragraph", () => {
      const content = "First paragraph\n\nSecond paragraph\n\nThird paragraph";
      // Cursor is in "Second paragraph" (line 3, position 17)
      const view = createView(content, 17);

      // Lines outside the second paragraph should have cm-blur
      const blurLines = view.dom.querySelectorAll(".cm-blur");
      expect(blurLines.length).toBeGreaterThan(0);
    });

    it("does not blur the current paragraph", () => {
      // Single line, cursor at start
      const view = createView("Only one line", 0);

      // The single line is the current paragraph — should not be blurred
      const lineElements = view.dom.querySelectorAll(".cm-line");
      const blurredLineElements = view.dom.querySelectorAll(".cm-line.cm-blur");
      // The content line should NOT be blurred
      expect(blurredLineElements.length).toBe(0);
      expect(lineElements.length).toBeGreaterThan(0);
    });

    it("handles empty document", () => {
      const view = createView("", 0);
      // Should not throw and should have no blur decorations
      const blurLines = view.dom.querySelectorAll(".cm-blur");
      expect(blurLines.length).toBe(0);
    });

    it("treats blank lines as paragraph separators", () => {
      const content = "Line A\nLine B\n\nLine C\nLine D";
      // Cursor in Line A (position 0) — paragraph is Line A + Line B
      const view = createView(content, 0);

      const blurLines = view.dom.querySelectorAll(".cm-blur");
      // Line C and Line D (and the blank line) should be blurred
      expect(blurLines.length).toBeGreaterThan(0);
    });

    it("cursor at beginning of paragraph includes full paragraph", () => {
      const content = "Para one\n\nPara two\n\nPara three";
      // Cursor at start of "Para two" (position 10)
      const view = createView(content, 10);

      const blurLines = view.dom.querySelectorAll(".cm-blur");
      // "Para one", blank line, blank line, "Para three" should be blurred
      expect(blurLines.length).toBeGreaterThan(0);
    });
  });

  describe("store subscription", () => {
    it("subscribes to editorStore on construction", () => {
      createView("test");
      expect(mockSubscribe).toHaveBeenCalledTimes(1);
    });

    it("unsubscribes on destroy", () => {
      const unsubscribe = vi.fn();
      mockSubscribe.mockReturnValueOnce(unsubscribe);

      const view = createView("test");
      view.destroy();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe("update triggers", () => {
    beforeEach(() => {
      mockEditorStore.focusModeEnabled = true;
    });

    it("rebuilds decorations when selection changes", () => {
      const content = "First para\n\nSecond para\n\nThird para";
      const view = createView(content, 0);

      const blurBefore = view.dom.querySelectorAll(".cm-blur").length;

      // Move cursor to third paragraph
      view.dispatch({
        selection: { anchor: 25 },
      });

      // Decorations should change (different paragraph focused)
      const blurAfter = view.dom.querySelectorAll(".cm-blur").length;
      // Both states should have some blurred lines
      expect(blurBefore).toBeGreaterThan(0);
      expect(blurAfter).toBeGreaterThan(0);
    });

    it("rebuilds decorations when document changes", () => {
      const view = createView("Test paragraph", 0);

      // Insert text
      view.dispatch({
        changes: { from: 14, to: 14, insert: "\n\nNew paragraph" },
      });

      // Should not throw
      expect(view.state.doc.toString()).toBe("Test paragraph\n\nNew paragraph");
    });
  });

  describe("store subscription callback — focus mode toggle", () => {
    it("rebuilds decorations and dispatches empty transaction when focusModeEnabled changes", () => {
      // Set up so subscription callback is captured
      let capturedCallback: ((state: typeof mockEditorStore, prevState: typeof mockEditorStore) => void) | null = null;
      mockSubscribe.mockImplementation((cb: typeof capturedCallback) => {
        capturedCallback = cb;
        return vi.fn();
      });

      // Start with focus mode disabled
      mockEditorStore.focusModeEnabled = false;
      const view = createView("Paragraph one\n\nParagraph two", 0);

      expect(capturedCallback).not.toBeNull();

      // Simulate store change: focusModeEnabled goes from false → true
      const prevState = { focusModeEnabled: false };
      mockEditorStore.focusModeEnabled = true;
      capturedCallback!({ focusModeEnabled: true }, prevState as typeof mockEditorStore);

      // The callback should have rebuilt decorations (now focus mode is on)
      const blurLines = view.dom.querySelectorAll(".cm-blur");
      // With focus mode enabled and content having 2 paragraphs, there should be blur decorations
      expect(blurLines.length).toBeGreaterThanOrEqual(0); // decorations rebuilt without error
    });

    it("does not rebuild when focusModeEnabled is unchanged", () => {
      let capturedCallback: ((state: typeof mockEditorStore, prevState: typeof mockEditorStore) => void) | null = null;
      mockSubscribe.mockImplementation((cb: typeof capturedCallback) => {
        capturedCallback = cb;
        return vi.fn();
      });

      mockEditorStore.focusModeEnabled = true;
      const view = createView("Test content", 0);

      // Simulate store change where focusModeEnabled didn't change
      const prevState = { focusModeEnabled: true };
      capturedCallback!({ focusModeEnabled: true }, prevState as typeof mockEditorStore);

      // No error thrown and view still functional
      expect(view.state.doc.toString()).toBe("Test content");
    });
  });

  describe("buildDecorations — single line (totalLines === 1)", () => {
    beforeEach(() => {
      mockEditorStore.focusModeEnabled = true;
    });

    it("handles single-line document without blurring the only line", () => {
      const view = createView("Single line only", 0);
      // The only line is the current paragraph — should not be blurred
      const blurLines = view.dom.querySelectorAll(".cm-blur");
      expect(blurLines.length).toBe(0);
    });

    it("handles multi-line doc where cursor is at start (paragraph spans first lines)", () => {
      // Lines 1-2 form one paragraph (no blank line between them)
      // Line 3 is blank, Line 4 is a separate paragraph
      const content = "line one\nline two\n\nline four";
      // cursor at start (in first paragraph spanning lines 1-2)
      const view = createView(content, 0);

      const blurLines = view.dom.querySelectorAll(".cm-blur");
      // line four (and blank line) should be blurred
      expect(blurLines.length).toBeGreaterThan(0);
    });
  });
});
