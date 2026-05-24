/**
 * BlockAudioNodeView Tests
 *
 * Tests for the block audio node view including:
 * - Constructor creates correct DOM structure
 * - Update method handles attribute changes
 * - Destroy cleanup
 * - Various node attributes (src, title, controls, preload)
 * - Edge cases (missing attrs, empty src)
 * - stopEvent behavior
 * - selectNode / deselectNode
 * - Double-click popup opening
 * - Async src resolution paths
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";

// Mock dependencies before imports
const mockResolveMediaSrc = vi.fn();
const mockIsExternalUrl = vi.fn();
const mockOpenPopup = vi.fn();
const mockSelectMediaNode = vi.fn();
const mockAttachMediaLoadHandlers = vi.fn(() => vi.fn());
const mockShowMediaError = vi.fn();
const mockClearMediaLoadState = vi.fn();

vi.mock("@/services/media/resolveMediaSrc", () => ({
  resolveMediaSrc: (...args: unknown[]) => mockResolveMediaSrc(...args),
}));

vi.mock("@/plugins/imageView/security", () => ({
  isExternalUrl: (...args: unknown[]) => mockIsExternalUrl(...args),
}));

vi.mock("@/stores/mediaPopupStore", () => ({
  useMediaPopupStore: {
    getState: () => ({ openPopup: mockOpenPopup }),
  },
}));

vi.mock("@/plugins/shared/mediaNodeViewHelpers", () => ({
  attachMediaLoadHandlers: (...args: unknown[]) => mockAttachMediaLoadHandlers(...args),
  showMediaError: (...args: unknown[]) => mockShowMediaError(...args),
  clearMediaLoadState: (...args: unknown[]) => mockClearMediaLoadState(...args),
  selectMediaNode: (...args: unknown[]) => mockSelectMediaNode(...args),
}));

import { BlockAudioNodeView } from "../BlockAudioNodeView";

// --- Helpers ---

function createMockNode(attrs: Record<string, unknown> = {}): PMNode {
  return {
    type: { name: "block_audio" },
    attrs: {
      src: attrs.src ?? "test.mp3",
      title: attrs.title ?? "",
      controls: attrs.controls ?? true,
      preload: attrs.preload ?? "metadata",
      ...attrs,
    },
  } as unknown as PMNode;
}

function createMockEditor() {
  return {
    view: {
      state: {
        doc: {},
        tr: {
          setSelection: vi.fn().mockReturnThis(),
          setMeta: vi.fn().mockReturnThis(),
        },
      },
      dispatch: vi.fn(),
    },
  } as unknown as import("@tiptap/core").Editor;
}

describe("BlockAudioNodeView", () => {
  let nodeView: BlockAudioNodeView;
  let mockEditor: ReturnType<typeof createMockEditor>;
  let getPos: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.textContent = "";
    // jsdom doesn't implement HTMLMediaElement.prototype.pause
    HTMLMediaElement.prototype.pause = vi.fn();
    mockIsExternalUrl.mockReturnValue(false);
    mockResolveMediaSrc.mockResolvedValue("resolved://test.mp3");
    mockEditor = createMockEditor();
    getPos = vi.fn(() => 5);
  });

  afterEach(() => {
    nodeView?.destroy();
  });

  function createNodeView(attrs: Record<string, unknown> = {}) {
    const node = createMockNode(attrs);
    nodeView = new BlockAudioNodeView(
      node,
      getPos,
      mockEditor as unknown as import("@tiptap/core").Editor,
    );
    document.body.appendChild(nodeView.dom);
    return nodeView;
  }

  describe("DOM Structure", () => {
    it("creates a figure element as dom", () => {
      createNodeView();
      expect(nodeView.dom.tagName).toBe("FIGURE");
    });

    it("sets correct className", () => {
      createNodeView();
      expect(nodeView.dom.classList.contains("block-audio")).toBe(true);
    });

    it("sets data-type attribute", () => {
      createNodeView();
      expect(nodeView.dom.getAttribute("data-type")).toBe("block_audio");
    });

    it("contains an audio element", () => {
      createNodeView();
      const audio = nodeView.dom.querySelector("audio");
      expect(audio).not.toBeNull();
    });

    it("sets audio title from node attrs", () => {
      createNodeView({ title: "My Audio" });
      const audio = nodeView.dom.querySelector("audio")!;
      expect(audio.title).toBe("My Audio");
    });

    it("sets audio controls when attrs.controls is true", () => {
      createNodeView({ controls: true });
      const audio = nodeView.dom.querySelector("audio")!;
      expect(audio.controls).toBe(true);
    });

    it("does not set controls when attrs.controls is false", () => {
      createNodeView({ controls: false });
      const audio = nodeView.dom.querySelector("audio")!;
      expect(audio.controls).toBe(false);
    });

    it("sets preload attribute from node attrs", () => {
      createNodeView({ preload: "auto" });
      const audio = nodeView.dom.querySelector("audio")!;
      expect(audio.preload).toBe("auto");
    });

    it("defaults preload to metadata when not specified", () => {
      createNodeView({ preload: undefined });
      const audio = nodeView.dom.querySelector("audio")!;
      expect(audio.preload).toBe("metadata");
    });
  });

  describe("Source Resolution", () => {
    it("resolves relative src via resolveMediaSrc", () => {
      mockIsExternalUrl.mockReturnValue(false);
      createNodeView({ src: "./audio/track.mp3" });
      expect(mockResolveMediaSrc).toHaveBeenCalledWith("./audio/track.mp3", "[BlockAudioView]");
    });

    it("sets src directly for external URLs", () => {
      mockIsExternalUrl.mockReturnValue(true);
      createNodeView({ src: "https://example.com/audio.mp3" });
      const audio = nodeView.dom.querySelector("audio")!;
      expect(audio.src).toContain("https://example.com/audio.mp3");
    });

    it("shows error for empty src", () => {
      createNodeView({ src: "" });
      expect(mockShowMediaError).toHaveBeenCalledWith(
        nodeView.dom,
        expect.any(HTMLAudioElement),
        "",
        "No audio source",
        expect.objectContaining({ loadEvent: "loadedmetadata" }),
      );
    });

    it("calls clearMediaLoadState before resolving", () => {
      createNodeView({ src: "test.mp3" });
      expect(mockClearMediaLoadState).toHaveBeenCalled();
    });

    it("adds loading class for external URLs", () => {
      mockIsExternalUrl.mockReturnValue(true);
      createNodeView({ src: "https://example.com/audio.mp3" });
      expect(nodeView.dom.classList.contains("media-loading")).toBe(true);
    });

    it("adds loading class for relative paths before resolution", () => {
      mockResolveMediaSrc.mockReturnValue(new Promise(() => {})); // Never resolves
      mockIsExternalUrl.mockReturnValue(false);
      createNodeView({ src: "audio.mp3" });
      expect(nodeView.dom.classList.contains("media-loading")).toBe(true);
    });

    it("shows error when resolveMediaSrc returns null", async () => {
      mockIsExternalUrl.mockReturnValue(false);
      mockResolveMediaSrc.mockResolvedValue(null);
      createNodeView({ src: "missing.mp3" });
      await vi.waitFor(() => {
        expect(mockShowMediaError).toHaveBeenCalledWith(
          nodeView.dom,
          expect.any(HTMLAudioElement),
          "missing.mp3",
          "Failed to resolve path",
          expect.any(Object),
        );
      });
    });

    it("shows error when resolveMediaSrc rejects", async () => {
      mockIsExternalUrl.mockReturnValue(false);
      mockResolveMediaSrc.mockRejectedValue(new Error("Network failure"));
      createNodeView({ src: "bad.mp3" });
      await vi.waitFor(() => {
        expect(mockShowMediaError).toHaveBeenCalledWith(
          nodeView.dom,
          expect.any(HTMLAudioElement),
          "bad.mp3",
          "Network failure",
          expect.any(Object),
        );
      });
    });

    it("ignores stale resolution after destroy", async () => {
      mockIsExternalUrl.mockReturnValue(false);
      let resolvePromise: (v: string) => void;
      mockResolveMediaSrc.mockReturnValue(new Promise((r) => { resolvePromise = r; }));
      createNodeView({ src: "track.mp3" });
      nodeView.destroy();
      resolvePromise!("resolved://track.mp3");
      await Promise.resolve();
      // setupLoadHandlers should not be called after destroy
      expect(mockAttachMediaLoadHandlers).not.toHaveBeenCalled();
    });
  });

  describe("update()", () => {
    it("returns true for block_audio node type", () => {
      createNodeView();
      const newNode = createMockNode({ title: "Updated" });
      expect(nodeView.update(newNode)).toBe(true);
    });

    it("returns false for different node type", () => {
      createNodeView();
      const wrongNode = {
        type: { name: "paragraph" },
        attrs: {},
      } as unknown as PMNode;
      expect(nodeView.update(wrongNode)).toBe(false);
    });

    it("updates audio title", () => {
      createNodeView({ title: "Original" });
      const audio = nodeView.dom.querySelector("audio")!;
      expect(audio.title).toBe("Original");

      nodeView.update(createMockNode({ title: "Updated Title" }));
      expect(audio.title).toBe("Updated Title");
    });

    it("updates audio controls", () => {
      createNodeView({ controls: true });
      const audio = nodeView.dom.querySelector("audio")!;
      expect(audio.controls).toBe(true);

      nodeView.update(createMockNode({ controls: false }));
      expect(audio.controls).toBe(false);
    });

    it("updates audio preload", () => {
      createNodeView({ preload: "metadata" });
      const audio = nodeView.dom.querySelector("audio")!;

      nodeView.update(createMockNode({ preload: "auto" }));
      expect(audio.preload).toBe("auto");
    });

    it("re-resolves src when it changes", () => {
      mockIsExternalUrl.mockReturnValue(false);
      createNodeView({ src: "old.mp3" });
      vi.clearAllMocks();

      nodeView.update(createMockNode({ src: "new.mp3" }));
      expect(mockResolveMediaSrc).toHaveBeenCalledWith("new.mp3", "[BlockAudioView]");
    });

    it("does not re-resolve src when it stays the same", () => {
      mockIsExternalUrl.mockReturnValue(false);
      createNodeView({ src: "same.mp3" });
      vi.clearAllMocks();

      nodeView.update(createMockNode({ src: "same.mp3" }));
      expect(mockResolveMediaSrc).not.toHaveBeenCalled();
    });

    it("handles null/undefined attrs gracefully", () => {
      createNodeView();
      const node = createMockNode({ src: undefined, title: undefined, controls: undefined, preload: undefined });
      expect(nodeView.update(node)).toBe(true);
    });
  });

  describe("destroy()", () => {
    it("pauses audio", () => {
      createNodeView();
      const audio = nodeView.dom.querySelector("audio")!;
      const pauseSpy = vi.spyOn(audio, "pause");
      nodeView.destroy();
      expect(pauseSpy).toHaveBeenCalled();
    });

    it("clears audio src", () => {
      createNodeView();
      const audio = nodeView.dom.querySelector("audio")!;
      nodeView.destroy();
      // jsdom resolves "" to base URL; check getAttribute instead
      expect(audio.getAttribute("src")).toBe("");
    });

    it("removes dblclick listener", () => {
      createNodeView();
      const spy = vi.spyOn(nodeView.dom, "removeEventListener");
      nodeView.destroy();
      expect(spy).toHaveBeenCalledWith("dblclick", expect.any(Function));
    });

    it("calls cleanup handlers", () => {
      mockIsExternalUrl.mockReturnValue(true);
      const mockCleanup = vi.fn();
      mockAttachMediaLoadHandlers.mockReturnValue(mockCleanup);
      createNodeView({ src: "https://example.com/audio.mp3" });
      nodeView.destroy();
      expect(mockCleanup).toHaveBeenCalled();
    });
  });

  describe("stopEvent()", () => {
    it("returns true when target is the audio element", () => {
      createNodeView();
      const audio = nodeView.dom.querySelector("audio")!;
      const event = new Event("mousedown");
      Object.defineProperty(event, "target", { value: audio });
      expect(nodeView.stopEvent(event)).toBe(true);
    });

    it("returns true for mousedown on figure dom", () => {
      createNodeView();
      const event = new MouseEvent("mousedown");
      Object.defineProperty(event, "target", { value: nodeView.dom });
      expect(nodeView.stopEvent(event)).toBe(true);
    });

    it("returns true for click on figure dom", () => {
      createNodeView();
      const event = new MouseEvent("click");
      Object.defineProperty(event, "target", { value: nodeView.dom });
      expect(nodeView.stopEvent(event)).toBe(true);
    });

    it("returns false for other events on unrelated targets", () => {
      createNodeView();
      const other = document.createElement("div");
      const event = new Event("keydown");
      Object.defineProperty(event, "target", { value: other });
      expect(nodeView.stopEvent(event)).toBe(false);
    });
  });

  describe("selectNode / deselectNode", () => {
    it("adds ProseMirror-selectednode class on select", () => {
      createNodeView();
      nodeView.selectNode();
      expect(nodeView.dom.classList.contains("ProseMirror-selectednode")).toBe(true);
    });

    it("removes ProseMirror-selectednode class on deselect", () => {
      createNodeView();
      nodeView.selectNode();
      nodeView.deselectNode();
      expect(nodeView.dom.classList.contains("ProseMirror-selectednode")).toBe(false);
    });

    it("clears window selection on selectNode", () => {
      createNodeView();
      const removeAllRanges = vi.fn();
      vi.spyOn(window, "getSelection").mockReturnValue({
        removeAllRanges,
      } as unknown as Selection);
      nodeView.selectNode();
      expect(removeAllRanges).toHaveBeenCalled();
    });
  });

  describe("double-click popup", () => {
    it("opens media popup on dblclick", () => {
      createNodeView({ src: "track.mp3" });
      const audio = nodeView.dom.querySelector("audio")!;
      audio.getBoundingClientRect = vi.fn(() => ({
        top: 100, left: 200, bottom: 150, right: 400,
        width: 200, height: 50, x: 200, y: 100,
        toJSON: () => ({}),
      }));

      nodeView.dom.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

      expect(mockSelectMediaNode).toHaveBeenCalled();
      expect(mockOpenPopup).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaSrc: "track.mp3",
          mediaNodeType: "block_audio",
          mediaNodePos: 5,
        }),
      );
    });

    it("does not open popup when getPos returns undefined", () => {
      getPos.mockReturnValue(undefined);
      createNodeView({ src: "track.mp3" });

      nodeView.dom.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

      expect(mockOpenPopup).not.toHaveBeenCalled();
    });
  });

  describe("external URL fast-path (cached media, line 102–103)", () => {
    it("clears loading state when audio is already cached (readyState >= 1)", () => {
      mockIsExternalUrl.mockReturnValue(true);
      const node = createMockNode({ src: "https://example.com/cached.mp3" });
      nodeView = new BlockAudioNodeView(
        node,
        getPos,
        mockEditor as unknown as import("@tiptap/core").Editor,
      );
      const audio = nodeView.dom.querySelector("audio")!;
      // Simulate cached: readyState >= 1
      Object.defineProperty(audio, "readyState", { value: 1, writable: true });

      // Trigger src update with a new external URL
      vi.clearAllMocks();
      mockIsExternalUrl.mockReturnValue(true);
      nodeView.update(createMockNode({ src: "https://example.com/cached2.mp3" }));

      expect(mockClearMediaLoadState).toHaveBeenCalled();
    });
  });

  describe("setupLoadHandlers callbacks (lines 133–134)", () => {
    it("onLoaded callback is a no-op (does not throw)", () => {
      mockIsExternalUrl.mockReturnValue(true);
      createNodeView({ src: "https://example.com/audio.mp3" });

      // The onLoaded callback (arg index 3) is () => {}
      const onLoaded = mockAttachMediaLoadHandlers.mock.calls[0][3];
      expect(() => onLoaded()).not.toThrow();
    });

    it("onError callback calls showMediaError", () => {
      mockIsExternalUrl.mockReturnValue(true);
      createNodeView({ src: "https://example.com/audio.mp3" });

      // Grab the onError callback (arg index 4) before clearing
      const onError = mockAttachMediaLoadHandlers.mock.calls[0]?.[4];
      expect(onError).toBeDefined();

      vi.clearAllMocks();
      onError();
      expect(mockShowMediaError).toHaveBeenCalledWith(
        nodeView.dom,
        expect.any(HTMLAudioElement),
        expect.any(String),
        "Failed to load audio",
        expect.any(Object),
      );
    });
  });

  describe("stale rejection handler — non-Error (line 122–123)", () => {
    it("shows generic error when resolveMediaSrc rejects with non-Error", async () => {
      mockIsExternalUrl.mockReturnValue(false);
      mockResolveMediaSrc.mockRejectedValue("string error");
      createNodeView({ src: "bad.mp3" });
      await vi.waitFor(() => {
        expect(mockShowMediaError).toHaveBeenCalledWith(
          nodeView.dom,
          expect.any(HTMLAudioElement),
          "bad.mp3",
          "Failed to resolve path",
          expect.any(Object),
        );
      });
    });
  });

  describe("null-coalescing fallback branches", () => {
    it("handles null src attr (line 46)", () => {
      createNodeView({ src: null });
      expect(mockShowMediaError).toHaveBeenCalledWith(
        nodeView.dom,
        expect.any(HTMLAudioElement),
        "",
        "No audio source",
        expect.any(Object),
      );
    });

    it("handles null title attr (line 53)", () => {
      createNodeView({ title: null });
      const audio = nodeView.dom.querySelector("audio")!;
      expect(audio.title).toBe("");
    });

    it("handleClick title fallback (line 72)", () => {
      createNodeView({ src: "track.mp3" });
      const audio = nodeView.dom.querySelector("audio")!;
      audio.getBoundingClientRect = vi.fn(() => ({
        top: 100, left: 200, bottom: 150, right: 400,
        width: 200, height: 50, x: 200, y: 100,
        toJSON: () => ({}),
      }));
      // Set title to empty to test the ?? fallback
      audio.title = "";
      nodeView.dom.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      expect(mockOpenPopup).toHaveBeenCalledWith(
        expect.objectContaining({ mediaTitle: "" }),
      );
    });
  });
});
