/**
 * VideoEmbedNodeView Tests
 *
 * Tests for the video embed node view including:
 * - Constructor creates correct DOM structure (figure > wrapper > iframe + overlay)
 * - Provider-specific rendering (YouTube, Vimeo, Bilibili)
 * - Update method handles attribute changes
 * - Destroy cleanup
 * - stopEvent behavior
 * - selectNode / deselectNode (overlay hide/show)
 * - Click on overlay triggers node selection
 * - Edge cases (missing videoId, unknown provider)
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";

// Mock dependencies before imports
const mockBuildEmbedUrl = vi.fn();
const mockGetProviderConfig = vi.fn();

vi.mock("@/utils/videoProviderRegistry", () => ({
  buildEmbedUrl: (...args: unknown[]) => mockBuildEmbedUrl(...args),
  getProviderConfig: (...args: unknown[]) => mockGetProviderConfig(...args),
}));

vi.mock("@tiptap/pm/state", () => ({
  NodeSelection: {
    create: vi.fn(() => ({ from: 0, to: 1 })),
  },
}));

import { VideoEmbedNodeView } from "../VideoEmbedNodeView";

// --- Helpers ---

function createMockNode(attrs: Record<string, unknown> = {}): PMNode {
  return {
    type: { name: "video_embed" },
    attrs: {
      provider: attrs.provider ?? "youtube",
      videoId: attrs.videoId ?? "abc123",
      width: attrs.width ?? undefined,
      height: attrs.height ?? undefined,
      ...attrs,
    },
  } as unknown as PMNode;
}

function createMockEditor() {
  const mockDispatch = vi.fn();
  return {
    view: {
      state: {
        doc: { nodeSize: 100 },
        tr: {
          setSelection: vi.fn().mockReturnThis(),
          setMeta: vi.fn().mockReturnThis(),
        },
      },
      dispatch: mockDispatch,
    },
    _dispatch: mockDispatch,
  };
}

describe("VideoEmbedNodeView", () => {
  let nodeView: VideoEmbedNodeView;
  let mockEditor: ReturnType<typeof createMockEditor>;
  let getPos: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.textContent = "";

    mockGetProviderConfig.mockReturnValue({
      name: "youtube",
      aspectRatio: "56.25%",
      defaultWidth: 560,
      defaultHeight: 315,
    });
    mockBuildEmbedUrl.mockReturnValue("https://www.youtube-nocookie.com/embed/abc123");

    mockEditor = createMockEditor();
    getPos = vi.fn(() => 12);
  });

  afterEach(() => {
    nodeView?.destroy();
  });

  function createNodeView(attrs: Record<string, unknown> = {}) {
    const node = createMockNode(attrs);
    nodeView = new VideoEmbedNodeView(
      node,
      getPos,
      mockEditor as unknown as import("@tiptap/core").Editor,
    );
    document.body.appendChild(nodeView.dom);
    return nodeView;
  }

  describe("dimension + config hardening", () => {
    it("falls back to provider defaults for invalid width/height", () => {
      const view = createNodeView({ width: -50, height: "junk" });
      const iframe = view.dom.querySelector("iframe")!;
      expect(iframe.getAttribute("width")).toBe("560");
      expect(iframe.getAttribute("height")).toBe("315");
    });

    it("clears a stale aspect ratio when the provider config goes missing", () => {
      const view = createNodeView({});
      const wrapper = view.dom.querySelector(".video-embed-wrapper") as HTMLElement;
      expect(wrapper.style.paddingBottom).toBe("56.25%");
      mockGetProviderConfig.mockReturnValue(undefined);
      view.update(createMockNode({ provider: "bogus" }) as never);
      expect(wrapper.style.paddingBottom).toBe("");
    });
  });

  describe("DOM Structure", () => {
    it("creates a figure element as dom", () => {
      createNodeView();
      expect(nodeView.dom.tagName).toBe("FIGURE");
    });

    it("sets correct className", () => {
      createNodeView();
      expect(nodeView.dom.className).toBe("video-embed");
    });

    it("sets data-type attribute", () => {
      createNodeView();
      expect(nodeView.dom.getAttribute("data-type")).toBe("video_embed");
    });

    it("sets data-provider attribute", () => {
      createNodeView({ provider: "vimeo" });
      expect(nodeView.dom.getAttribute("data-provider")).toBe("vimeo");
    });

    it("contains a wrapper div", () => {
      createNodeView();
      const wrapper = nodeView.dom.querySelector(".video-embed-wrapper");
      expect(wrapper).not.toBeNull();
    });

    it("sets paddingBottom from provider config", () => {
      mockGetProviderConfig.mockReturnValue({
        name: "youtube",
        aspectRatio: "56.25%",
        defaultWidth: 560,
        defaultHeight: 315,
      });
      createNodeView();
      const wrapper = nodeView.dom.querySelector(".video-embed-wrapper") as HTMLElement;
      expect(wrapper.style.paddingBottom).toBe("56.25%");
    });

    it("contains an iframe", () => {
      createNodeView();
      const iframe = nodeView.dom.querySelector("iframe");
      expect(iframe).not.toBeNull();
    });

    it("sets iframe src from buildEmbedUrl", () => {
      mockBuildEmbedUrl.mockReturnValue("https://www.youtube-nocookie.com/embed/xyz");
      createNodeView({ videoId: "xyz" });
      const iframe = nodeView.dom.querySelector("iframe")!;
      expect(iframe.src).toBe("https://www.youtube-nocookie.com/embed/xyz");
    });

    it("passes the node's privacyHash to buildEmbedUrl (WI-6)", () => {
      mockBuildEmbedUrl.mockReturnValue("https://player.vimeo.com/video/9?h=beef");
      createNodeView({ provider: "vimeo", videoId: "9", privacyHash: "beef" });
      expect(mockBuildEmbedUrl).toHaveBeenCalledWith("vimeo", "9", { privacyHash: "beef" });
    });

    it("sets iframe src to about:blank when videoId is empty", () => {
      createNodeView({ videoId: "" });
      const iframe = nodeView.dom.querySelector("iframe")!;
      expect(iframe.src).toContain("about:blank");
    });

    it("sets iframe width and height from attrs", () => {
      createNodeView({ width: 800, height: 450 });
      const iframe = nodeView.dom.querySelector("iframe")!;
      expect(iframe.width).toBe("800");
      expect(iframe.height).toBe("450");
    });

    it("uses provider defaults for width/height when not specified", () => {
      mockGetProviderConfig.mockReturnValue({
        name: "youtube",
        aspectRatio: "56.25%",
        defaultWidth: 560,
        defaultHeight: 315,
      });
      createNodeView({ width: undefined, height: undefined });
      const iframe = nodeView.dom.querySelector("iframe")!;
      expect(iframe.width).toBe("560");
      expect(iframe.height).toBe("315");
    });

    it("sets frameborder and allowfullscreen on iframe", () => {
      createNodeView();
      const iframe = nodeView.dom.querySelector("iframe")!;
      expect(iframe.getAttribute("frameborder")).toBe("0");
      expect(iframe.getAttribute("allowfullscreen")).toBe("true");
    });

    it("sets allow attribute on iframe", () => {
      createNodeView();
      const iframe = nodeView.dom.querySelector("iframe")!;
      expect(iframe.getAttribute("allow")).toContain("autoplay");
    });

    it("contains an overlay div", () => {
      createNodeView();
      const overlay = nodeView.dom.querySelector(".video-embed-overlay");
      expect(overlay).not.toBeNull();
    });
  });

  describe("Provider handling", () => {
    it("defaults to youtube when provider is not set", () => {
      createNodeView({ provider: undefined });
      expect(mockGetProviderConfig).toHaveBeenCalledWith("youtube");
    });

    it("handles null provider config gracefully", () => {
      mockGetProviderConfig.mockReturnValue(null);
      expect(() => createNodeView()).not.toThrow();
    });

    it("passes provider to getProviderConfig", () => {
      createNodeView({ provider: "bilibili" });
      expect(mockGetProviderConfig).toHaveBeenCalledWith("bilibili");
    });
  });

  describe("update()", () => {
    it("returns true for video_embed node type", () => {
      createNodeView();
      expect(nodeView.update(createMockNode({ videoId: "new123" }))).toBe(true);
    });

    it("returns false for different node type", () => {
      createNodeView();
      const wrongNode = { type: { name: "paragraph" }, attrs: {} } as unknown as PMNode;
      expect(nodeView.update(wrongNode)).toBe(false);
    });

    it("updates iframe src when videoId changes", () => {
      mockBuildEmbedUrl.mockReturnValue("https://www.youtube-nocookie.com/embed/abc123");
      createNodeView({ videoId: "abc123" });
      const iframe = nodeView.dom.querySelector("iframe")!;

      mockBuildEmbedUrl.mockReturnValue("https://www.youtube-nocookie.com/embed/new456");
      nodeView.update(createMockNode({ videoId: "new456" }));
      expect(iframe.src).toBe("https://www.youtube-nocookie.com/embed/new456");
    });

    it("does not update iframe src when it stays the same", () => {
      const embedUrl = "https://www.youtube-nocookie.com/embed/abc123";
      mockBuildEmbedUrl.mockReturnValue(embedUrl);
      createNodeView({ videoId: "abc123" });
      const iframe = nodeView.dom.querySelector("iframe")!;
      const setSrcSpy = vi.spyOn(iframe, "src", "set");

      nodeView.update(createMockNode({ videoId: "abc123" }));
      expect(setSrcSpy).not.toHaveBeenCalled();
    });

    it("updates iframe dimensions", () => {
      createNodeView({ width: 560, height: 315 });
      const iframe = nodeView.dom.querySelector("iframe")!;

      nodeView.update(createMockNode({ width: 800, height: 450 }));
      expect(iframe.width).toBe("800");
      expect(iframe.height).toBe("450");
    });

    it("updates wrapper aspect ratio", () => {
      createNodeView();
      const wrapper = nodeView.dom.querySelector(".video-embed-wrapper") as HTMLElement;

      mockGetProviderConfig.mockReturnValue({
        name: "vimeo",
        aspectRatio: "75%",
        defaultWidth: 640,
        defaultHeight: 480,
      });
      nodeView.update(createMockNode({ provider: "vimeo" }));
      expect(wrapper.style.paddingBottom).toBe("75%");
    });

    it("updates data-provider attribute", () => {
      createNodeView({ provider: "youtube" });
      nodeView.update(createMockNode({ provider: "vimeo" }));
      expect(nodeView.dom.getAttribute("data-provider")).toBe("vimeo");
    });

    it("sets iframe to about:blank when videoId becomes empty", () => {
      mockBuildEmbedUrl.mockReturnValue("https://www.youtube-nocookie.com/embed/abc123");
      createNodeView({ videoId: "abc123" });

      nodeView.update(createMockNode({ videoId: "" }));
      const iframe = nodeView.dom.querySelector("iframe")!;
      expect(iframe.src).toContain("about:blank");
    });
  });

  describe("destroy()", () => {
    it("removes click listener from overlay", () => {
      createNodeView();
      const overlay = nodeView.dom.querySelector(".video-embed-overlay")!;
      const spy = vi.spyOn(overlay, "removeEventListener");
      nodeView.destroy();
      expect(spy).toHaveBeenCalledWith("click", expect.any(Function));
    });
  });

  describe("stopEvent()", () => {
    it("returns true for mousedown events", () => {
      createNodeView();
      const event = new MouseEvent("mousedown");
      expect(nodeView.stopEvent(event)).toBe(true);
    });

    it("returns true for click events", () => {
      createNodeView();
      const event = new MouseEvent("click");
      expect(nodeView.stopEvent(event)).toBe(true);
    });

    it("returns false for other events", () => {
      createNodeView();
      const event = new Event("keydown");
      expect(nodeView.stopEvent(event)).toBe(false);
    });
  });

  describe("selectNode / deselectNode", () => {
    it("adds ProseMirror-selectednode class on select", () => {
      createNodeView();
      nodeView.selectNode();
      expect(nodeView.dom.classList.contains("ProseMirror-selectednode")).toBe(true);
    });

    it("hides overlay on select for iframe interaction", () => {
      createNodeView();
      const overlay = nodeView.dom.querySelector(".video-embed-overlay") as HTMLElement;
      nodeView.selectNode();
      expect(overlay.style.display).toBe("none");
    });

    it("removes ProseMirror-selectednode class on deselect", () => {
      createNodeView();
      nodeView.selectNode();
      nodeView.deselectNode();
      expect(nodeView.dom.classList.contains("ProseMirror-selectednode")).toBe(false);
    });

    it("shows overlay on deselect", () => {
      createNodeView();
      nodeView.selectNode();
      const overlay = nodeView.dom.querySelector(".video-embed-overlay") as HTMLElement;
      nodeView.deselectNode();
      expect(overlay.style.display).toBe("");
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

  describe("overlay click", () => {
    it("dispatches node selection on overlay click", () => {
      createNodeView();
      const overlay = nodeView.dom.querySelector(".video-embed-overlay") as HTMLElement;
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(mockEditor._dispatch).toHaveBeenCalled();
    });

    it("does not dispatch when getPos returns undefined", () => {
      getPos.mockReturnValue(undefined);
      createNodeView();
      const overlay = nodeView.dom.querySelector(".video-embed-overlay") as HTMLElement;
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(mockEditor._dispatch).not.toHaveBeenCalled();
    });
  });

  describe("nullish coalescing fallback branches", () => {
    it("uses empty string when videoId is null in constructor (line 36 ?? branch)", () => {
      const node = {
        type: { name: "video_embed" },
        attrs: { provider: "youtube", videoId: null, width: undefined, height: undefined },
      } as unknown as import("@tiptap/pm/model").Node;
      nodeView = new VideoEmbedNodeView(
        node,
        getPos,
        mockEditor as unknown as import("@tiptap/core").Editor,
      );
      document.body.appendChild(nodeView.dom);
      // null videoId → "" → falsy → about:blank
      const iframe = nodeView.dom.querySelector("iframe") as HTMLIFrameElement;
      expect(iframe.src).toBe("about:blank");
    });

    it("uses 'youtube' fallback and empty videoId when provider/videoId are null in update() (lines 85-86 ?? branches)", () => {
      createNodeView();
      const updatedNode = {
        type: { name: "video_embed" },
        attrs: { provider: null, videoId: null, width: undefined, height: undefined },
      } as unknown as import("@tiptap/pm/model").Node;
      mockBuildEmbedUrl.mockReturnValue("https://www.youtube-nocookie.com/embed/");
      const result = nodeView.update(updatedNode);
      expect(result).toBe(true);
      // provider null → "youtube" fallback; videoId null → "" → falsy → about:blank
      const iframe = nodeView.dom.querySelector("iframe") as HTMLIFrameElement;
      expect(iframe.src).toBe("about:blank");
    });

    it("uses 560/315 defaults when config is null and width/height are undefined (lines 93-94 ?? branches)", () => {
      // Return null config so config?.defaultWidth and config?.defaultHeight are undefined
      mockGetProviderConfig.mockReturnValue(null);
      createNodeView();
      const updatedNode = {
        type: { name: "video_embed" },
        attrs: { provider: "youtube", videoId: "xyz", width: undefined, height: undefined },
      } as unknown as import("@tiptap/pm/model").Node;
      nodeView.update(updatedNode);
      const iframe = nodeView.dom.querySelector("iframe") as HTMLIFrameElement;
      expect(iframe.width).toBe("560");
      expect(iframe.height).toBe("315");
    });
  });
});
