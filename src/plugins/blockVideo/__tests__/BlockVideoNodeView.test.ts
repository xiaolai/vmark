/**
 * BlockVideoNodeView Tests
 *
 * Tests for the block video node view including:
 * - Constructor creates correct DOM structure
 * - Update method handles attribute changes
 * - Destroy cleanup
 * - Various node attributes (src, title, controls, preload, poster)
 * - Edge cases (missing attrs, empty src)
 * - stopEvent behavior (especially controls area detection)
 * - selectNode / deselectNode
 * - Double-click popup opening with controls area exclusion
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

vi.mock("@/plugins/shared/mediaSecurity", () => ({
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

import { BlockVideoNodeView } from "../BlockVideoNodeView";

// --- Helpers ---

function createMockNode(attrs: Record<string, unknown> = {}): PMNode {
  return {
    type: { name: "block_video" },
    attrs: {
      src: attrs.src ?? "test.mp4",
      title: attrs.title ?? "",
      controls: attrs.controls ?? true,
      preload: attrs.preload ?? "metadata",
      poster: attrs.poster ?? "",
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

describe("BlockVideoNodeView", () => {
  let nodeView: BlockVideoNodeView;
  let mockEditor: ReturnType<typeof createMockEditor>;
  let getPos: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.textContent = "";
    // jsdom doesn't implement HTMLMediaElement.prototype.pause
    HTMLMediaElement.prototype.pause = vi.fn();
    mockIsExternalUrl.mockReturnValue(false);
    mockResolveMediaSrc.mockResolvedValue("resolved://test.mp4");
    mockEditor = createMockEditor();
    getPos = vi.fn(() => 8);
  });

  afterEach(() => {
    nodeView?.destroy();
  });

  function createNodeView(attrs: Record<string, unknown> = {}) {
    const node = createMockNode(attrs);
    nodeView = new BlockVideoNodeView(
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
      expect(nodeView.dom.classList.contains("block-video")).toBe(true);
    });

    it("sets data-type attribute", () => {
      createNodeView();
      expect(nodeView.dom.getAttribute("data-type")).toBe("block_video");
    });

    it("contains a video element", () => {
      createNodeView();
      const video = nodeView.dom.querySelector("video");
      expect(video).not.toBeNull();
    });

    it("sets video title from node attrs", () => {
      createNodeView({ title: "My Video" });
      const video = nodeView.dom.querySelector("video")!;
      expect(video.title).toBe("My Video");
    });

    it("sets video controls when attrs.controls is true", () => {
      createNodeView({ controls: true });
      const video = nodeView.dom.querySelector("video")!;
      expect(video.controls).toBe(true);
    });

    it("does not set controls when attrs.controls is false", () => {
      createNodeView({ controls: false });
      const video = nodeView.dom.querySelector("video")!;
      expect(video.controls).toBe(false);
    });

    it("sets preload attribute from node attrs", () => {
      createNodeView({ preload: "auto" });
      const video = nodeView.dom.querySelector("video")!;
      expect(video.preload).toBe("auto");
    });

    it("defaults preload to metadata", () => {
      createNodeView({ preload: undefined });
      const video = nodeView.dom.querySelector("video")!;
      expect(video.preload).toBe("metadata");
    });

    it("sets poster from node attrs", () => {
      createNodeView({ poster: "thumb.jpg" });
      const video = nodeView.dom.querySelector("video")!;
      // jsdom resolves relative URLs; check the attribute value
      expect(video.getAttribute("poster")).toBe("thumb.jpg");
    });

    it("does not set poster when empty", () => {
      createNodeView({ poster: "" });
      const video = nodeView.dom.querySelector("video")!;
      expect(video.getAttribute("poster")).toBeNull();
    });
  });

  describe("Source Resolution", () => {
    it("resolves relative src via resolveMediaSrc", () => {
      mockIsExternalUrl.mockReturnValue(false);
      createNodeView({ src: "./videos/clip.mp4" });
      expect(mockResolveMediaSrc).toHaveBeenCalledWith("./videos/clip.mp4", "[BlockVideoView]");
    });

    it("sets src directly for external URLs", () => {
      mockIsExternalUrl.mockReturnValue(true);
      createNodeView({ src: "https://example.com/video.mp4" });
      const video = nodeView.dom.querySelector("video")!;
      expect(video.src).toContain("https://example.com/video.mp4");
    });

    it("shows error for empty src", () => {
      createNodeView({ src: "" });
      expect(mockShowMediaError).toHaveBeenCalledWith(
        nodeView.dom,
        expect.any(HTMLVideoElement),
        "",
        "No video source",
        expect.objectContaining({ loadEvent: "loadedmetadata" }),
      );
    });

    it("adds loading class for external URLs", () => {
      mockIsExternalUrl.mockReturnValue(true);
      createNodeView({ src: "https://example.com/video.mp4" });
      expect(nodeView.dom.classList.contains("media-loading")).toBe(true);
    });

    it("shows error when resolveMediaSrc returns null", async () => {
      mockIsExternalUrl.mockReturnValue(false);
      mockResolveMediaSrc.mockResolvedValue(null);
      createNodeView({ src: "missing.mp4" });
      await vi.waitFor(() => {
        expect(mockShowMediaError).toHaveBeenCalledWith(
          nodeView.dom,
          expect.any(HTMLVideoElement),
          "missing.mp4",
          "Failed to resolve path",
          expect.any(Object),
        );
      });
    });

    it("shows error when resolveMediaSrc rejects with Error", async () => {
      mockIsExternalUrl.mockReturnValue(false);
      mockResolveMediaSrc.mockRejectedValue(new Error("Disk error"));
      createNodeView({ src: "bad.mp4" });
      await vi.waitFor(() => {
        expect(mockShowMediaError).toHaveBeenCalledWith(
          nodeView.dom,
          expect.any(HTMLVideoElement),
          "bad.mp4",
          "Disk error",
          expect.any(Object),
        );
      });
    });

    it("shows generic error when resolveMediaSrc rejects with non-Error", async () => {
      mockIsExternalUrl.mockReturnValue(false);
      mockResolveMediaSrc.mockRejectedValue("string error");
      createNodeView({ src: "bad.mp4" });
      await vi.waitFor(() => {
        expect(mockShowMediaError).toHaveBeenCalledWith(
          nodeView.dom,
          expect.any(HTMLVideoElement),
          "bad.mp4",
          "Failed to resolve path",
          expect.any(Object),
        );
      });
    });

    it("ignores stale resolution after destroy", async () => {
      mockIsExternalUrl.mockReturnValue(false);
      let resolvePromise: (v: string) => void;
      mockResolveMediaSrc.mockReturnValue(new Promise((r) => { resolvePromise = r; }));
      createNodeView({ src: "clip.mp4" });
      nodeView.destroy();
      resolvePromise!("resolved://clip.mp4");
      await Promise.resolve();
      expect(mockAttachMediaLoadHandlers).not.toHaveBeenCalled();
    });
  });

  describe("update()", () => {
    it("returns true for block_video node type", () => {
      createNodeView();
      expect(nodeView.update(createMockNode({ title: "Updated" }))).toBe(true);
    });

    it("returns false for different node type", () => {
      createNodeView();
      const wrongNode = { type: { name: "paragraph" }, attrs: {} } as unknown as PMNode;
      expect(nodeView.update(wrongNode)).toBe(false);
    });

    it("updates video title", () => {
      createNodeView({ title: "Original" });
      const video = nodeView.dom.querySelector("video")!;
      nodeView.update(createMockNode({ title: "Updated Title" }));
      expect(video.title).toBe("Updated Title");
    });

    it("updates video controls", () => {
      createNodeView({ controls: true });
      const video = nodeView.dom.querySelector("video")!;
      nodeView.update(createMockNode({ controls: false }));
      expect(video.controls).toBe(false);
    });

    it("updates video preload", () => {
      createNodeView({ preload: "metadata" });
      const video = nodeView.dom.querySelector("video")!;
      nodeView.update(createMockNode({ preload: "none" }));
      expect(video.preload).toBe("none");
    });

    it("updates video poster", () => {
      createNodeView({ poster: "old-thumb.jpg" });
      const video = nodeView.dom.querySelector("video")!;
      nodeView.update(createMockNode({ poster: "new-thumb.jpg" }));
      expect(video.getAttribute("poster")).toBe("new-thumb.jpg");
    });

    it("re-resolves src when it changes", () => {
      mockIsExternalUrl.mockReturnValue(false);
      createNodeView({ src: "old.mp4" });
      vi.clearAllMocks();

      nodeView.update(createMockNode({ src: "new.mp4" }));
      expect(mockResolveMediaSrc).toHaveBeenCalledWith("new.mp4", "[BlockVideoView]");
    });

    it("does not re-resolve src when it stays the same", () => {
      mockIsExternalUrl.mockReturnValue(false);
      createNodeView({ src: "same.mp4" });
      vi.clearAllMocks();

      nodeView.update(createMockNode({ src: "same.mp4" }));
      expect(mockResolveMediaSrc).not.toHaveBeenCalled();
    });
  });

  describe("destroy()", () => {
    it("pauses video", () => {
      createNodeView();
      const video = nodeView.dom.querySelector("video")!;
      const pauseSpy = vi.spyOn(video, "pause");
      nodeView.destroy();
      expect(pauseSpy).toHaveBeenCalled();
    });

    it("clears video src", () => {
      createNodeView();
      const video = nodeView.dom.querySelector("video")!;
      nodeView.destroy();
      // jsdom resolves "" to base URL; check getAttribute instead
      expect(video.getAttribute("src")).toBe("");
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
      createNodeView({ src: "https://example.com/video.mp4" });
      nodeView.destroy();
      expect(mockCleanup).toHaveBeenCalled();
    });
  });

  describe("stopEvent()", () => {
    it("returns true for mousedown in video controls area", () => {
      createNodeView();
      const video = nodeView.dom.querySelector("video")!;
      video.getBoundingClientRect = vi.fn(() => ({
        top: 0, left: 0, bottom: 400, right: 600,
        width: 600, height: 400, x: 0, y: 0,
        toJSON: () => ({}),
      }));
      // Click in controls area (bottom 40px) => clientY > 400 - 40 = 360
      const event = new MouseEvent("mousedown", { clientY: 380 });
      Object.defineProperty(event, "target", { value: video });
      expect(nodeView.stopEvent(event)).toBe(true);
    });

    it("returns true for mousedown on video outside controls", () => {
      createNodeView();
      const video = nodeView.dom.querySelector("video")!;
      video.getBoundingClientRect = vi.fn(() => ({
        top: 0, left: 0, bottom: 400, right: 600,
        width: 600, height: 400, x: 0, y: 0,
        toJSON: () => ({}),
      }));
      const event = new MouseEvent("mousedown", { clientY: 100 });
      Object.defineProperty(event, "target", { value: video });
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

    it("returns false for other event types", () => {
      createNodeView();
      const event = new Event("keydown");
      Object.defineProperty(event, "target", { value: document.createElement("div") });
      expect(nodeView.stopEvent(event)).toBe(false);
    });

    it("returns false for mousedown on unrelated target", () => {
      createNodeView();
      const event = new MouseEvent("mousedown");
      Object.defineProperty(event, "target", { value: document.createElement("div") });
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
    function setupVideoWithRect() {
      createNodeView({ src: "clip.mp4", poster: "thumb.jpg" });
      const video = nodeView.dom.querySelector("video")!;
      video.getBoundingClientRect = vi.fn(() => ({
        top: 100, left: 200, bottom: 500, right: 800,
        width: 600, height: 400, x: 200, y: 100,
        toJSON: () => ({}),
      }));
      return video;
    }

    it("opens media popup on dblclick above controls area", () => {
      setupVideoWithRect();
      // Dispatch from dom (not video target) so controls check is skipped
      const event = new MouseEvent("dblclick", { bubbles: true, clientY: 200 });
      nodeView.dom.dispatchEvent(event);

      expect(mockSelectMediaNode).toHaveBeenCalled();
      expect(mockOpenPopup).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaSrc: "clip.mp4",
          mediaNodeType: "block_video",
          mediaNodePos: 8,
        }),
      );
    });

    it("does not open popup when dblclick in controls area on video target", () => {
      const video = setupVideoWithRect();
      // Must dispatch on video element to trigger controls area check
      // The handler checks e.target === this.video
      const event = new MouseEvent("dblclick", { bubbles: true, clientY: 490 });
      Object.defineProperty(event, "target", { value: video, writable: false });
      video.dispatchEvent(event);

      expect(mockOpenPopup).not.toHaveBeenCalled();
    });

    it("does not open popup when getPos returns undefined", () => {
      getPos.mockReturnValue(undefined);
      setupVideoWithRect();
      const event = new MouseEvent("dblclick", { bubbles: true, clientY: 200 });
      Object.defineProperty(event, "target", { value: document.createElement("div") });
      nodeView.dom.dispatchEvent(event);
      expect(mockOpenPopup).not.toHaveBeenCalled();
    });
  });

  describe("cached external video fast-path (lines 121-122)", () => {
    it("clears loading state when readyState >= 1", () => {
      mockIsExternalUrl.mockReturnValue(true);
      const node = createMockNode({ src: "https://example.com/cached.mp4" });
      nodeView = new BlockVideoNodeView(node, getPos, mockEditor);
      const video = nodeView.dom.querySelector("video")!;
      Object.defineProperty(video, "readyState", { value: 1, writable: true });

      vi.clearAllMocks();
      mockIsExternalUrl.mockReturnValue(true);
      nodeView.update(createMockNode({ src: "https://example.com/cached2.mp4" }));

      expect(mockClearMediaLoadState).toHaveBeenCalled();
    });
  });

  describe("setupLoadHandlers callbacks (lines 152-153)", () => {
    it("onLoaded callback does not throw", () => {
      mockIsExternalUrl.mockReturnValue(true);
      createNodeView({ src: "https://example.com/video.mp4" });
      const onLoaded = mockAttachMediaLoadHandlers.mock.calls[0][3];
      expect(() => onLoaded()).not.toThrow();
    });

    it("onError callback calls showMediaError with correct message", () => {
      mockIsExternalUrl.mockReturnValue(true);
      createNodeView({ src: "https://example.com/video.mp4" });
      const onError = mockAttachMediaLoadHandlers.mock.calls[0]?.[4];
      expect(onError).toBeDefined();
      vi.clearAllMocks();
      onError();
      expect(mockShowMediaError).toHaveBeenCalledWith(
        nodeView.dom,
        expect.any(HTMLVideoElement),
        expect.any(String),
        "Failed to load video",
        expect.any(Object),
      );
    });
  });

  describe("null-coalescing fallback branches", () => {
    it("handles null src attr", () => {
      createNodeView({ src: null });
      expect(mockShowMediaError).toHaveBeenCalledWith(
        nodeView.dom, expect.any(HTMLVideoElement), "", "No video source", expect.any(Object),
      );
    });

    it("handles null title attr", () => {
      createNodeView({ title: null });
      const video = nodeView.dom.querySelector("video")!;
      expect(video.title).toBe("");
    });

    it("handles null poster attr", () => {
      createNodeView({ poster: null });
      const video = nodeView.dom.querySelector("video")!;
      expect(video.poster).toBe("");
    });

    it("update handles null attrs", () => {
      createNodeView();
      expect(nodeView.update(createMockNode({ title: null, controls: null, preload: null, poster: null }))).toBe(true);
    });
  });

  describe("handleClick branches", () => {
    it("opens popup when dblclick target is video but clientY is above controls area (else branch at line 80)", () => {
      createNodeView({ src: "clip.mp4" });
      const video = nodeView.dom.querySelector("video")!;
      video.getBoundingClientRect = vi.fn(() => ({
        top: 0, left: 0, bottom: 400, right: 600,
        width: 600, height: 400, x: 0, y: 0, toJSON: () => ({}),
      }));
      // clientY=100 is NOT > rect.bottom - 40 (=360), so we fall through to open popup
      const event = new MouseEvent("dblclick", { bubbles: true, clientY: 100 });
      Object.defineProperty(event, "target", { value: video, writable: false });
      video.dispatchEvent(event);

      expect(mockOpenPopup).toHaveBeenCalled();
    });

    it("uses empty string for mediaTitle when title is null (line 91: title ?? '')", () => {
      createNodeView({ src: "clip.mp4", title: null });
      const video = nodeView.dom.querySelector("video")!;
      video.getBoundingClientRect = vi.fn(() => ({
        top: 0, left: 0, bottom: 400, right: 600,
        width: 600, height: 400, x: 0, y: 0, toJSON: () => ({}),
      }));
      const event = new MouseEvent("dblclick", { bubbles: true, clientY: 100 });
      Object.defineProperty(event, "target", { value: nodeView.dom });
      nodeView.dom.dispatchEvent(event);

      expect(mockOpenPopup).toHaveBeenCalledWith(
        expect.objectContaining({ mediaTitle: "" }),
      );
    });

    it("uses empty string for mediaPoster when poster is null (line 94: poster ?? '')", () => {
      createNodeView({ src: "clip.mp4", poster: null });
      const video = nodeView.dom.querySelector("video")!;
      video.getBoundingClientRect = vi.fn(() => ({
        top: 0, left: 0, bottom: 400, right: 600,
        width: 600, height: 400, x: 0, y: 0, toJSON: () => ({}),
      }));
      const event = new MouseEvent("dblclick", { bubbles: true, clientY: 100 });
      Object.defineProperty(event, "target", { value: nodeView.dom });
      nodeView.dom.dispatchEvent(event);

      expect(mockOpenPopup).toHaveBeenCalledWith(
        expect.objectContaining({ mediaPoster: "" }),
      );
    });

    it("ignores stale catch when destroyed before rejection fires (line 141: destroyed branch)", async () => {
      mockIsExternalUrl.mockReturnValue(false);
      let reject1: (e: Error) => void;
      mockResolveMediaSrc.mockReturnValueOnce(new Promise((_, r) => { reject1 = r; }));

      createNodeView({ src: "clip.mp4" });
      // Destroy before the promise rejects
      nodeView.destroy();
      reject1!(new Error("stale error"));
      await Promise.resolve();

      // Should be ignored — showMediaError not called
      expect(mockShowMediaError).not.toHaveBeenCalled();
    });
  });

  describe("update() preload ?? fallback", () => {
    it("defaults preload to metadata when update provides null (line 162: ?? 'metadata')", () => {
      createNodeView({ preload: "auto" });
      const video = nodeView.dom.querySelector("video")!;
      nodeView.update(createMockNode({ preload: null }));
      expect(video.preload).toBe("metadata");
    });
  });

  describe("stopEvent click on video element (line 186)", () => {
    it("returns true for click on video outside controls area", () => {
      createNodeView();
      const video = nodeView.dom.querySelector("video")!;
      video.getBoundingClientRect = vi.fn(() => ({
        top: 0, left: 0, bottom: 400, right: 600, width: 600, height: 400, x: 0, y: 0, toJSON: () => ({}),
      }));
      const event = new MouseEvent("click", { clientY: 100 });
      Object.defineProperty(event, "target", { value: video });
      expect(nodeView.stopEvent(event)).toBe(true);
    });
  });
});
