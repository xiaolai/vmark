/**
 * BlockImageNodeView Tests
 *
 * Tests for the block image node view including:
 * - Constructor creates correct DOM structure
 * - Update method handles attribute changes
 * - Destroy cleanup
 * - Various node attributes (src, alt, title)
 * - Edge cases (missing attrs, empty src)
 * - stopEvent behavior
 * - selectNode / deselectNode
 * - Double-click popup opening
 * - Context menu handling
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";

// Mock dependencies before imports
const mockResolveMediaSrc = vi.fn();
const mockIsExternalUrl = vi.fn();
const mockOpenPopup = vi.fn();
const mockOpenMenu = vi.fn();
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

vi.mock("@/stores/imageContextMenuStore", () => ({
  useImageContextMenuStore: {
    getState: () => ({ openMenu: mockOpenMenu }),
  },
}));

vi.mock("@/plugins/shared/mediaNodeViewHelpers", () => ({
  attachMediaLoadHandlers: (...args: unknown[]) => mockAttachMediaLoadHandlers(...args),
  showMediaError: (...args: unknown[]) => mockShowMediaError(...args),
  clearMediaLoadState: (...args: unknown[]) => mockClearMediaLoadState(...args),
  selectMediaNode: (...args: unknown[]) => mockSelectMediaNode(...args),
}));

import { BlockImageNodeView } from "../BlockImageNodeView";

// --- Helpers ---

function createMockNode(attrs: Record<string, unknown> = {}): PMNode {
  return {
    type: { name: "block_image" },
    attrs: {
      src: attrs.src ?? "test.png",
      alt: attrs.alt ?? "",
      title: attrs.title ?? "",
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

describe("BlockImageNodeView", () => {
  let nodeView: BlockImageNodeView;
  let mockEditor: ReturnType<typeof createMockEditor>;
  let getPos: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.textContent = "";
    mockIsExternalUrl.mockReturnValue(false);
    mockResolveMediaSrc.mockResolvedValue("resolved://test.png");
    mockEditor = createMockEditor();
    getPos = vi.fn(() => 10);
  });

  afterEach(() => {
    nodeView?.destroy();
  });

  function createNodeView(attrs: Record<string, unknown> = {}) {
    const node = createMockNode(attrs);
    nodeView = new BlockImageNodeView(node, getPos, mockEditor);
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
      expect(nodeView.dom.classList.contains("block-image")).toBe(true);
    });

    it("sets data-type attribute", () => {
      createNodeView();
      expect(nodeView.dom.getAttribute("data-type")).toBe("block_image");
    });

    it("contains an img element", () => {
      createNodeView();
      const img = nodeView.dom.querySelector("img");
      expect(img).not.toBeNull();
    });

    it("sets img alt from node attrs", () => {
      createNodeView({ alt: "A photo" });
      const img = nodeView.dom.querySelector("img")!;
      expect(img.alt).toBe("A photo");
    });

    it("sets img title from node attrs", () => {
      createNodeView({ title: "Photo Title" });
      const img = nodeView.dom.querySelector("img")!;
      expect(img.title).toBe("Photo Title");
    });

    it("handles empty alt and title", () => {
      createNodeView({ alt: "", title: "" });
      const img = nodeView.dom.querySelector("img")!;
      expect(img.alt).toBe("");
      expect(img.title).toBe("");
    });
  });

  describe("Source Resolution", () => {
    it("resolves relative src via resolveMediaSrc", () => {
      mockIsExternalUrl.mockReturnValue(false);
      createNodeView({ src: "./images/photo.png" });
      expect(mockResolveMediaSrc).toHaveBeenCalledWith("./images/photo.png", "[BlockImageView]");
    });

    it("sets src directly for external URLs", () => {
      mockIsExternalUrl.mockReturnValue(true);
      createNodeView({ src: "https://example.com/photo.png" });
      const img = nodeView.dom.querySelector("img")!;
      expect(img.src).toContain("https://example.com/photo.png");
    });

    it("shows error for empty src", () => {
      createNodeView({ src: "" });
      expect(mockShowMediaError).toHaveBeenCalledWith(
        nodeView.dom,
        expect.any(HTMLImageElement),
        "",
        "No image source",
        expect.objectContaining({ loadEvent: "load" }),
      );
    });

    it("adds loading class for external URLs", () => {
      mockIsExternalUrl.mockReturnValue(true);
      createNodeView({ src: "https://example.com/photo.png" });
      expect(nodeView.dom.classList.contains("image-loading")).toBe(true);
    });

    it("shows error when resolveMediaSrc returns null", async () => {
      mockIsExternalUrl.mockReturnValue(false);
      mockResolveMediaSrc.mockResolvedValue(null);
      createNodeView({ src: "missing.png" });
      await vi.waitFor(() => {
        expect(mockShowMediaError).toHaveBeenCalledWith(
          nodeView.dom,
          expect.any(HTMLImageElement),
          "missing.png",
          "Failed to resolve path",
          expect.any(Object),
        );
      });
    });

    it("shows error when resolveMediaSrc rejects", async () => {
      mockIsExternalUrl.mockReturnValue(false);
      mockResolveMediaSrc.mockRejectedValue(new Error("File not found"));
      createNodeView({ src: "bad.png" });
      await vi.waitFor(() => {
        expect(mockShowMediaError).toHaveBeenCalledWith(
          nodeView.dom,
          expect.any(HTMLImageElement),
          "bad.png",
          "File not found",
          expect.any(Object),
        );
      });
    });

    it("ignores stale resolution after destroy", async () => {
      mockIsExternalUrl.mockReturnValue(false);
      let resolvePromise: (v: string) => void;
      mockResolveMediaSrc.mockReturnValue(new Promise((r) => { resolvePromise = r; }));
      createNodeView({ src: "photo.png" });
      nodeView.destroy();
      resolvePromise!("resolved://photo.png");
      await Promise.resolve();
      expect(mockAttachMediaLoadHandlers).not.toHaveBeenCalled();
    });

    it("handles non-Error rejection gracefully", async () => {
      mockIsExternalUrl.mockReturnValue(false);
      mockResolveMediaSrc.mockRejectedValue("string error");
      createNodeView({ src: "bad.png" });
      await vi.waitFor(() => {
        expect(mockShowMediaError).toHaveBeenCalledWith(
          nodeView.dom,
          expect.any(HTMLImageElement),
          "bad.png",
          "Failed to resolve path",
          expect.any(Object),
        );
      });
    });
  });

  describe("update()", () => {
    it("returns true for block_image node type", () => {
      createNodeView();
      const newNode = createMockNode({ alt: "Updated" });
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

    it("updates img alt", () => {
      createNodeView({ alt: "Original" });
      const img = nodeView.dom.querySelector("img")!;
      nodeView.update(createMockNode({ alt: "Updated Alt" }));
      expect(img.alt).toBe("Updated Alt");
    });

    it("updates img title", () => {
      createNodeView({ title: "Original" });
      const img = nodeView.dom.querySelector("img")!;
      nodeView.update(createMockNode({ title: "Updated Title" }));
      expect(img.title).toBe("Updated Title");
    });

    it("re-resolves src when it changes", () => {
      mockIsExternalUrl.mockReturnValue(false);
      createNodeView({ src: "old.png" });
      vi.clearAllMocks();

      nodeView.update(createMockNode({ src: "new.png" }));
      expect(mockResolveMediaSrc).toHaveBeenCalledWith("new.png", "[BlockImageView]");
    });

    it("does not re-resolve src when it stays the same", () => {
      mockIsExternalUrl.mockReturnValue(false);
      createNodeView({ src: "same.png" });
      vi.clearAllMocks();

      nodeView.update(createMockNode({ src: "same.png" }));
      expect(mockResolveMediaSrc).not.toHaveBeenCalled();
    });

    it("handles null/undefined attrs gracefully", () => {
      createNodeView();
      const node = createMockNode({ src: undefined, alt: undefined, title: undefined });
      expect(nodeView.update(node)).toBe(true);
    });
  });

  describe("destroy()", () => {
    it("removes contextmenu listener from img", () => {
      createNodeView();
      const img = nodeView.dom.querySelector("img")!;
      const spy = vi.spyOn(img, "removeEventListener");
      nodeView.destroy();
      expect(spy).toHaveBeenCalledWith("contextmenu", expect.any(Function));
    });

    it("removes dblclick listener from dom", () => {
      createNodeView();
      const spy = vi.spyOn(nodeView.dom, "removeEventListener");
      nodeView.destroy();
      expect(spy).toHaveBeenCalledWith("dblclick", expect.any(Function));
    });

    it("calls cleanup handlers", () => {
      mockIsExternalUrl.mockReturnValue(true);
      const mockCleanup = vi.fn();
      mockAttachMediaLoadHandlers.mockReturnValue(mockCleanup);
      createNodeView({ src: "https://example.com/photo.png" });
      nodeView.destroy();
      expect(mockCleanup).toHaveBeenCalled();
    });
  });

  describe("stopEvent()", () => {
    it("returns true for mousedown on img", () => {
      createNodeView();
      const img = nodeView.dom.querySelector("img")!;
      const event = new MouseEvent("mousedown");
      Object.defineProperty(event, "target", { value: img });
      expect(nodeView.stopEvent(event)).toBe(true);
    });

    it("returns true for mousedown on dom", () => {
      createNodeView();
      const event = new MouseEvent("mousedown");
      Object.defineProperty(event, "target", { value: nodeView.dom });
      expect(nodeView.stopEvent(event)).toBe(true);
    });

    it("returns true for click on img", () => {
      createNodeView();
      const img = nodeView.dom.querySelector("img")!;
      const event = new MouseEvent("click");
      Object.defineProperty(event, "target", { value: img });
      expect(nodeView.stopEvent(event)).toBe(true);
    });

    it("returns false for other events", () => {
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
    it("opens media popup on dblclick", () => {
      createNodeView({ src: "photo.png" });
      const img = nodeView.dom.querySelector("img")!;
      img.getBoundingClientRect = vi.fn(() => ({
        top: 100, left: 200, bottom: 300, right: 500,
        width: 300, height: 200, x: 200, y: 100,
        toJSON: () => ({}),
      }));
      Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
      Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });

      nodeView.dom.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

      expect(mockSelectMediaNode).toHaveBeenCalled();
      expect(mockOpenPopup).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaSrc: "photo.png",
          mediaNodeType: "block_image",
          mediaNodePos: 10,
          mediaDimensions: { width: 800, height: 600 },
        }),
      );
    });

    it("sends null dimensions when naturalWidth is 0", () => {
      createNodeView({ src: "photo.png" });
      const img = nodeView.dom.querySelector("img")!;
      img.getBoundingClientRect = vi.fn(() => ({
        top: 0, left: 0, bottom: 0, right: 0,
        width: 0, height: 0, x: 0, y: 0,
        toJSON: () => ({}),
      }));
      Object.defineProperty(img, "naturalWidth", { value: 0, configurable: true });
      Object.defineProperty(img, "naturalHeight", { value: 0, configurable: true });

      nodeView.dom.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

      expect(mockOpenPopup).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaDimensions: null,
        }),
      );
    });

    it("does not open popup when getPos returns undefined", () => {
      getPos.mockReturnValue(undefined);
      createNodeView({ src: "photo.png" });
      nodeView.dom.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      expect(mockOpenPopup).not.toHaveBeenCalled();
    });
  });

  describe("updateSrc additional branches", () => {
    it("restores original title when updateSrc is called after an error set data-original-title (lines 125-126)", async () => {
      // Simulate an error first so data-original-title is set, then call updateSrc with a new src
      mockIsExternalUrl.mockReturnValue(false);
      mockResolveMediaSrc.mockRejectedValue(new Error("not found"));
      createNodeView({ src: "bad.png", title: "My Title" });

      // Wait for error handler to run
      await vi.waitFor(() => expect(mockShowMediaError).toHaveBeenCalled());

      // Now update with a new src — updateSrc should restore the title
      vi.clearAllMocks();
      const img = nodeView.dom.querySelector("img")!;
      img.setAttribute("data-original-title", "My Title");

      mockIsExternalUrl.mockReturnValue(false);
      mockResolveMediaSrc.mockResolvedValue("resolved://new.png");
      nodeView.update(createMockNode({ src: "new.png", title: "My Title" }));

      // The data-original-title attribute should be removed
      await vi.waitFor(() => {
        expect(img.getAttribute("data-original-title")).toBeNull();
      });
    });

    it("fast-paths external URL that is already cached (lines 141-144)", () => {
      mockIsExternalUrl.mockReturnValue(true);
      const mockCleanup = vi.fn();
      mockAttachMediaLoadHandlers.mockReturnValue(mockCleanup);

      createNodeView({ src: "https://example.com/cached.png" });
      const img = nodeView.dom.querySelector("img")!;

      // Simulate an already-loaded image (naturalWidth > 0, complete)
      Object.defineProperty(img, "complete", { value: true, configurable: true });
      Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });

      // Re-call update to trigger updateSrc again with the same external src
      vi.clearAllMocks();
      mockIsExternalUrl.mockReturnValue(true);
      mockAttachMediaLoadHandlers.mockReturnValue(mockCleanup);

      nodeView.update(createMockNode({ src: "https://example.com/cached2.png" }));

      // Fast-path: attachMediaLoadHandlers was called but then cleanup was called for the cached image
      expect(mockAttachMediaLoadHandlers).toHaveBeenCalled();
    });

    it("ignores stale request in catch handler (line 163)", async () => {
      mockIsExternalUrl.mockReturnValue(false);
      let reject1: (e: Error) => void;
      mockResolveMediaSrc
        .mockReturnValueOnce(new Promise((_, r) => { reject1 = r; }))
        .mockResolvedValueOnce("resolved://second.png");

      createNodeView({ src: "first.png" });

      // Issue a second request (increments resolveRequestId)
      nodeView.update(createMockNode({ src: "second.png" }));
      await vi.waitFor(() => expect(mockAttachMediaLoadHandlers).toHaveBeenCalled());

      // Now reject the first request — stale, should be ignored
      vi.clearAllMocks();
      reject1!(new Error("stale error"));
      await Promise.resolve();

      // showMediaError should NOT have been called for the stale rejection
      expect(mockShowMediaError).not.toHaveBeenCalled();
    });

    it("success callback in setupLoadHandlers sets opacity to 1 (lines 174-175)", () => {
      mockIsExternalUrl.mockReturnValue(true);

      let capturedOnLoad: (() => void) | undefined;
      mockAttachMediaLoadHandlers.mockImplementation(
        (_img: unknown, _dom: unknown, _config: unknown, onLoad: () => void) => {
          capturedOnLoad = onLoad;
          return vi.fn();
        }
      );

      createNodeView({ src: "https://example.com/photo.png" });
      const img = nodeView.dom.querySelector("img")!;
      img.style.opacity = "0";

      // Invoke the captured onLoad callback
      expect(capturedOnLoad).toBeDefined();
      capturedOnLoad!();
      expect(img.style.opacity).toBe("1");
    });
  });

  describe("null attrs nullish-coalescing branches", () => {
    it("uses empty string when src attr is null (line 58: src ?? '')", () => {
      // Pass null explicitly to trigger the ?? fallback
      const node = {
        type: { name: "block_image" },
        attrs: { src: null, alt: null, title: null },
      } as unknown as import("@tiptap/pm/model").Node;
      nodeView = new BlockImageNodeView(node, getPos, mockEditor);
      document.body.appendChild(nodeView.dom);
      // Constructor should not throw; img.alt and title coerced to ""
      const img = nodeView.dom.querySelector("img")!;
      expect(img.alt).toBe("");
      expect(img.title).toBe("");
    });

    it("uses empty string for mediaAlt when img.alt is empty on dblclick (line 102: alt ?? '')", () => {
      const node = {
        type: { name: "block_image" },
        attrs: { src: "photo.png", alt: null, title: null },
      } as unknown as import("@tiptap/pm/model").Node;
      nodeView = new BlockImageNodeView(node, getPos, mockEditor);
      document.body.appendChild(nodeView.dom);

      const img = nodeView.dom.querySelector("img")!;
      img.getBoundingClientRect = vi.fn(() => ({
        top: 0, left: 0, bottom: 0, right: 0,
        width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
      }));

      nodeView.dom.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      expect(mockOpenPopup).toHaveBeenCalledWith(
        expect.objectContaining({ mediaAlt: "" }),
      );
    });
  });

  describe("context menu", () => {
    it("opens image context menu on right-click", () => {
      createNodeView({ src: "photo.png" });
      const img = nodeView.dom.querySelector("img")!;
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 150,
        clientY: 250,
      });
      img.dispatchEvent(event);

      expect(mockOpenMenu).toHaveBeenCalledWith({
        position: { x: 150, y: 250 },
        imageSrc: "photo.png",
        imageNodePos: 10,
      });
    });

    it("does not open context menu when getPos returns undefined", () => {
      getPos.mockReturnValue(undefined);
      createNodeView({ src: "photo.png" });
      const img = nodeView.dom.querySelector("img")!;
      img.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
      expect(mockOpenMenu).not.toHaveBeenCalled();
    });
  });
});
