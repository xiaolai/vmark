/**
 * Typewriter Mode Plugin Tests for CodeMirror (Source Mode)
 *
 * Tests the typewriter scrolling behavior that keeps the cursor
 * vertically centered at ~40% from the top of the viewport.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// Mock editorStore before importing
const mockEditorStore = {
  typewriterModeEnabled: false,
};

vi.mock("@/stores/editorStore", () => ({
  useEditorStore: {
    getState: () => mockEditorStore,
  },
}));

// Mock isCodeMirrorComposing so we can force the composing branch
const mockIsComposing = vi.fn((_view?: unknown) => false);

vi.mock("@/utils/imeGuard", () => ({
  isCodeMirrorComposing: (view?: unknown) => mockIsComposing(view),
}));

import { createSourceTypewriterPlugin } from "./typewriterModePlugin";

const views: EditorView[] = [];

function createView(content: string, cursorPos?: number): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);

  const state = EditorState.create({
    doc: content,
    selection: { anchor: cursorPos ?? 0 },
    extensions: [createSourceTypewriterPlugin()],
  });
  const view = new EditorView({ state, parent });
  views.push(view);
  return view;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockEditorStore.typewriterModeEnabled = false;
  mockIsComposing.mockReturnValue(false);
});

afterEach(() => {
  views.forEach((v) => {
    const parent = v.dom.parentElement;
    v.destroy();
    parent?.remove();
  });
  views.length = 0;
  vi.useRealTimers();
});

describe("createSourceTypewriterPlugin", () => {
  describe("when typewriter mode is disabled", () => {
    beforeEach(() => {
      mockEditorStore.typewriterModeEnabled = false;
    });

    it("does not scroll on selection change", () => {
      const view = createView("Hello\nWorld\nTest");

      // Change selection
      view.dispatch({ selection: { anchor: 6 } });

      // No scroll should have been triggered (no error = pass)
      expect(view.state.selection.main.from).toBe(6);
    });
  });

  describe("when typewriter mode is enabled", () => {
    beforeEach(() => {
      mockEditorStore.typewriterModeEnabled = true;
    });

    it("does not scroll for non-selection updates", () => {
      const view = createView("Hello\nWorld");

      // Document change without selection change
      view.dispatch({
        changes: { from: 5, to: 5, insert: "!" },
      });

      // Should not throw
      expect(view.state.doc.toString()).toBe("Hello!\nWorld");
    });

    it("skips initial updates to avoid jarring scroll on load", () => {
      const view = createView("Hello\nWorld\nTest");
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

      // First 3 selection changes should be skipped
      view.dispatch({ selection: { anchor: 1 } });
      view.dispatch({ selection: { anchor: 2 } });
      view.dispatch({ selection: { anchor: 3 } });

      expect(rafSpy).not.toHaveBeenCalled();

      // 4th selection change should trigger scrolling
      view.dispatch({ selection: { anchor: 4 } });

      expect(rafSpy).toHaveBeenCalledTimes(1);

      rafSpy.mockRestore();
    });

    it("does not schedule scroll while an IME is composing (issue #814)", () => {
      const view = createView("Hello\nWorld\nTest\nMore lines");
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

      // Skip initial updates
      for (let i = 1; i <= 3; i++) {
        view.dispatch({ selection: { anchor: i } });
      }

      rafSpy.mockClear();

      // While composing, no scroll should be scheduled on selection change
      mockIsComposing.mockReturnValue(true);
      view.dispatch({ selection: { anchor: 10 } });
      expect(rafSpy).not.toHaveBeenCalled();

      // When composition ends, normal scrolling resumes
      mockIsComposing.mockReturnValue(false);
      view.dispatch({ selection: { anchor: 12 } });
      expect(rafSpy).toHaveBeenCalledTimes(1);

      rafSpy.mockRestore();
    });

    it("cancels an already-pending rAF when composition starts mid-flight (issue #814)", () => {
      const view = createView("Hello\nWorld\nTest\nMore lines");
      const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");

      // Skip initial updates so the plugin is past SKIP_INITIAL_UPDATES.
      for (let i = 1; i <= 3; i++) {
        view.dispatch({ selection: { anchor: i } });
      }
      cancelSpy.mockClear();

      // Trigger a real rAF schedule (not composing).
      view.dispatch({ selection: { anchor: 6 } });

      // Composition starts before the rAF fires — the pending rAF must be
      // canceled so it cannot move the viewport mid-compose.
      mockIsComposing.mockReturnValue(true);
      view.dispatch({ selection: { anchor: 7 } });

      expect(cancelSpy).toHaveBeenCalled();

      cancelSpy.mockRestore();
    });

    it("cancels pending scroll on rapid cursor movement", () => {
      const view = createView("Hello\nWorld\nTest\nMore lines");
      const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");

      // Skip initial updates
      for (let i = 1; i <= 3; i++) {
        view.dispatch({ selection: { anchor: i } });
      }

      // Now subsequent rapid changes should cancel previous
      view.dispatch({ selection: { anchor: 5 } });
      view.dispatch({ selection: { anchor: 10 } });

      expect(cancelSpy).toHaveBeenCalled();

      cancelSpy.mockRestore();
    });
  });

  describe("destroy", () => {
    it("cancels pending animation frame on destroy", () => {
      mockEditorStore.typewriterModeEnabled = true;
      const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");

      const view = createView("Hello\nWorld\nTest");

      // Skip initial updates
      for (let i = 1; i <= 4; i++) {
        view.dispatch({ selection: { anchor: i } });
      }

      view.destroy();

      // Should cancel if there was a pending raf
      // (may or may not have been called depending on timing)
      expect(cancelSpy).toHaveBeenCalled();

      cancelSpy.mockRestore();
    });

    it("does not throw when destroyed without pending scroll", () => {
      const view = createView("Hello");
      expect(() => view.destroy()).not.toThrow();
    });
  });

  describe("scroll behavior", () => {
    beforeEach(() => {
      mockEditorStore.typewriterModeEnabled = true;
    });

    it("uses requestAnimationFrame for smooth batching", () => {
      const view = createView("Hello\nWorld\nTest\nFourth");
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

      // Skip initial updates
      for (let i = 1; i <= 3; i++) {
        view.dispatch({ selection: { anchor: i } });
      }

      view.dispatch({ selection: { anchor: 10 } });

      expect(rafSpy).toHaveBeenCalledWith(expect.any(Function));

      rafSpy.mockRestore();
    });

    it("handles coordsAtPos failure gracefully", () => {
      const view = createView("Hello\nWorld");

      // Skip initial updates
      for (let i = 1; i <= 3; i++) {
        view.dispatch({ selection: { anchor: i } });
      }

      // Mock coordsAtPos to return null
      const origCoords = view.coordsAtPos.bind(view);
      vi.spyOn(view, "coordsAtPos").mockReturnValue(null);

      view.dispatch({ selection: { anchor: 5 } });

      // Execute the raf callback — should not throw
      vi.runAllTimers();

      view.coordsAtPos = origCoords;
    });

    it("executes rAF callback and calls scrollBy when offset exceeds threshold", () => {
      // Capture the rAF callback and invoke it manually
      let capturedRafCb: FrameRequestCallback | null = null;
      const origRaf = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = (cb) => {
        capturedRafCb = cb;
        return 1;
      };

      const view = createView("Hello\nWorld\nTest\nMore content here\nLine 5");

      // Add a scroll container (.editor-content)
      const editorContent = document.createElement("div");
      editorContent.className = "editor-content";
      editorContent.getBoundingClientRect = () => ({
        top: 0, left: 0, bottom: 200, right: 800,
        width: 800, height: 200,
        x: 0, y: 0, toJSON: () => {},
      });
      const scrollBySpy = vi.fn();
      editorContent.scrollBy = scrollBySpy;

      // Move the view dom inside editorContent
      const parent = view.dom.parentElement!;
      editorContent.appendChild(view.dom);
      parent.appendChild(editorContent);

      // Mock coordsAtPos to return coords far from 40% target (80px)
      vi.spyOn(view, "coordsAtPos").mockReturnValue({
        top: 180, bottom: 196, left: 0, right: 10,
      });

      // Skip initial updates then trigger actual scroll path
      for (let i = 1; i <= 4; i++) {
        view.dispatch({ selection: { anchor: i } });
      }

      // Manually invoke the captured rAF callback
      expect(capturedRafCb).not.toBeNull();
      capturedRafCb!(performance.now());

      // scrollBy should have been called since |180 - 80| = 100 > 30 threshold
      expect(scrollBySpy).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: "smooth" })
      );

      globalThis.requestAnimationFrame = origRaf;
    });

    it("does not scroll when offset is within threshold", () => {
      let capturedRafCb: FrameRequestCallback | null = null;
      const origRaf = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = (cb) => {
        capturedRafCb = cb;
        return 1;
      };

      const view = createView("Hello\nWorld");

      const editorContent = document.createElement("div");
      editorContent.className = "editor-content";
      editorContent.getBoundingClientRect = () => ({
        top: 0, left: 0, bottom: 200, right: 800,
        width: 800, height: 200,
        x: 0, y: 0, toJSON: () => {},
      });
      const scrollBySpy = vi.fn();
      editorContent.scrollBy = scrollBySpy;

      const parent = view.dom.parentElement!;
      editorContent.appendChild(view.dom);
      parent.appendChild(editorContent);

      // coords.top = 100, target = 80, offset = 20 < 30 threshold
      vi.spyOn(view, "coordsAtPos").mockReturnValue({
        top: 100, bottom: 116, left: 0, right: 10,
      });

      for (let i = 1; i <= 4; i++) {
        view.dispatch({ selection: { anchor: i } });
      }

      capturedRafCb!(performance.now());

      // Offset is 20 < 30 threshold — no scrollBy
      expect(scrollBySpy).not.toHaveBeenCalled();

      globalThis.requestAnimationFrame = origRaf;
    });

    it("falls back to parentElement when no .editor-content container", () => {
      let capturedRafCb: FrameRequestCallback | null = null;
      const origRaf = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = (cb) => {
        capturedRafCb = cb;
        return 1;
      };

      // createView appends to body, so parentElement is the div (no .editor-content)
      const view = createView("Hello\nWorld\nTest\nLine4\nLine5");
      const parent = view.dom.parentElement!;

      parent.getBoundingClientRect = () => ({
        top: 0, left: 0, bottom: 400, right: 800,
        width: 800, height: 400,
        x: 0, y: 0, toJSON: () => {},
      });
      const scrollBySpy = vi.fn();
      parent.scrollBy = scrollBySpy;

      vi.spyOn(view, "coordsAtPos").mockReturnValue({
        top: 350, // far from 400*0.4 = 160 → offset = 190 > 30
        bottom: 366, left: 0, right: 10,
      });

      for (let i = 1; i <= 4; i++) {
        view.dispatch({ selection: { anchor: i } });
      }

      capturedRafCb!(performance.now());

      expect(scrollBySpy).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: "smooth" })
      );

      globalThis.requestAnimationFrame = origRaf;
    });

    it("handles coordsAtPos throwing exception gracefully", () => {
      let capturedRafCb: FrameRequestCallback | null = null;
      const origRaf = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = (cb) => {
        capturedRafCb = cb;
        return 1;
      };

      const view = createView("Hello\nWorld");

      vi.spyOn(view, "coordsAtPos").mockImplementation(() => {
        throw new Error("position out of range");
      });

      // Skip initial + trigger
      for (let i = 1; i <= 4; i++) {
        view.dispatch({ selection: { anchor: i } });
      }

      // Invoke rAF callback — catch block should swallow the error
      expect(() => capturedRafCb!(performance.now())).not.toThrow();

      globalThis.requestAnimationFrame = origRaf;
    });

    it("rAF callback does nothing when scrollContainer is null", () => {
      let capturedRafCb: FrameRequestCallback | null = null;
      const origRaf = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = (cb) => {
        capturedRafCb = cb;
        return 1;
      };

      // Detach view dom from parent so parentElement is null
      const view = createView("Hello\nWorld");
      const parent = view.dom.parentElement!;
      parent.removeChild(view.dom);

      vi.spyOn(view, "coordsAtPos").mockReturnValue({
        top: 180, bottom: 196, left: 0, right: 10,
      });

      for (let i = 1; i <= 4; i++) {
        view.dispatch({ selection: { anchor: i } });
      }

      // Should not throw even with no scroll container
      expect(() => capturedRafCb!(performance.now())).not.toThrow();

      // Reattach for cleanup
      parent.appendChild(view.dom);
      globalThis.requestAnimationFrame = origRaf;
    });
  });
});
