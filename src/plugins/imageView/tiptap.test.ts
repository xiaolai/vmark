/**
 * Tests for imageView tiptap extension — extension configuration and NodeView integration.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  dirname: vi.fn((path: string) =>
    Promise.resolve(path.split("/").slice(0, -1).join("/") || "/")
  ),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: vi.fn(() => ({
      getDocument: vi.fn(() => ({ filePath: "/test/doc.md" })),
    })),
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: vi.fn(() => ({
      activeTabId: { main: "tab-1" },
    })),
  },
}));

vi.mock("@/stores/imageContextMenuStore", () => ({
  useImageContextMenuStore: {
    getState: vi.fn(() => ({
      openMenu: vi.fn(),
    })),
  },
}));

vi.mock("@/stores/mediaPopupStore", () => ({
  useMediaPopupStore: {
    getState: vi.fn(() => ({
      openPopup: vi.fn(),
    })),
  },
}));

vi.mock("@/services/navigation/windowFocus", () => ({
  getWindowLabel: vi.fn(() => "main"),
}));

vi.mock("@/utils/debug", () => ({
  imageViewWarn: vi.fn(),
}));

vi.mock("@/utils/markdownUrl", () => ({
  decodeMarkdownUrl: vi.fn((url: string) => decodeURIComponent(url)),
}));

import { imageViewExtension } from "./tiptap";
import { ImageNodeView } from "./index";

describe("imageViewExtension", () => {
  it("has the correct name (inherits from Image)", () => {
    expect(imageViewExtension.name).toBe("image");
  });

  it("is configured as inline", () => {
    // The extension is configured with inline: true
    expect(imageViewExtension.options.inline).toBe(true);
  });

  it("defines addNodeView", () => {
    expect(imageViewExtension.config.addNodeView).toBeDefined();
  });

  it("addNodeView factory creates an ImageNodeView instance", () => {
    const factory = imageViewExtension.config.addNodeView!.call({
      name: "image",
      options: { inline: true },
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "node" as never,
    });
    const mockNode = {
      attrs: { src: "https://example.com/img.png", alt: "a", title: "t" },
      type: { name: "image" },
    };
    const mockGetPos = () => 0;
    const mockEditor = {
      view: {
        state: { doc: { nodeSize: 10 }, tr: { setSelection: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() } },
        dispatch: vi.fn(),
      },
    };
    const nodeView = factory!({
      node: mockNode as never,
      getPos: mockGetPos as never,
      editor: mockEditor as never,
      HTMLAttributes: {},
      decorations: [] as never,
      innerDecorations: {} as never,
      extension: imageViewExtension as never,
    });
    expect(nodeView).toBeDefined();
    expect((nodeView as unknown as { dom: HTMLElement }).dom).toBeInstanceOf(HTMLImageElement);
  });
});

describe("ImageNodeView", () => {
  let nodeView: ImageNodeView;
  const mockEditor = {
    view: {
      state: {
        doc: { nodeSize: 10 },
        tr: {
          setSelection: vi.fn().mockReturnThis(),
          setMeta: vi.fn().mockReturnThis(),
        },
      },
      dispatch: vi.fn(),
    },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an img element as dom", () => {
    const node = {
      attrs: { src: "https://example.com/image.png", alt: "test", title: "title" },
      type: { name: "image" },
    } as never;
    nodeView = new ImageNodeView(node, () => 0, mockEditor);

    expect(nodeView.dom).toBeInstanceOf(HTMLImageElement);
    expect(nodeView.dom.classList.contains("inline-image")).toBe(true);
    expect(nodeView.dom.alt).toBe("test");
    expect(nodeView.dom.title).toBe("title");
  });

  it("sets external URL src directly", () => {
    const node = {
      attrs: { src: "https://example.com/image.png", alt: "", title: "" },
      type: { name: "image" },
    } as never;
    nodeView = new ImageNodeView(node, () => 0, mockEditor);

    expect(nodeView.dom.src).toBe("https://example.com/image.png");
  });

  it("handles empty src", () => {
    const node = {
      attrs: { src: "", alt: "", title: "" },
      type: { name: "image" },
    } as never;
    nodeView = new ImageNodeView(node, () => 0, mockEditor);

    expect(nodeView.dom.classList.contains("image-error")).toBe(true);
  });

  it("handles null attrs gracefully", () => {
    const node = {
      attrs: { src: null, alt: null, title: null },
      type: { name: "image" },
    } as never;
    nodeView = new ImageNodeView(node, () => 0, mockEditor);

    expect(nodeView.dom.alt).toBe("");
    // Title is set to error message when src is empty/null
    expect(nodeView.dom.title).toContain("No image source");
  });

  it("update returns false for non-image nodes", () => {
    const node = {
      attrs: { src: "https://example.com/image.png", alt: "", title: "" },
      type: { name: "image" },
    } as never;
    nodeView = new ImageNodeView(node, () => 0, mockEditor);

    const otherNode = {
      type: { name: "paragraph" },
      attrs: {},
    } as never;
    expect(nodeView.update(otherNode)).toBe(false);
  });

  it("update returns true and updates attrs for image nodes", () => {
    const node = {
      attrs: { src: "https://example.com/old.png", alt: "old", title: "old" },
      type: { name: "image" },
    } as never;
    nodeView = new ImageNodeView(node, () => 0, mockEditor);

    const newNode = {
      type: { name: "image" },
      attrs: { src: "https://example.com/new.png", alt: "new", title: "new" },
    } as never;
    expect(nodeView.update(newNode)).toBe(true);
    expect(nodeView.dom.alt).toBe("new");
    expect(nodeView.dom.title).toBe("new");
  });

  it("update does not re-resolve when src unchanged", () => {
    const node = {
      attrs: { src: "https://example.com/image.png", alt: "test", title: "" },
      type: { name: "image" },
    } as never;
    nodeView = new ImageNodeView(node, () => 0, mockEditor);

    const sameNode = {
      type: { name: "image" },
      attrs: { src: "https://example.com/image.png", alt: "updated", title: "" },
    } as never;
    expect(nodeView.update(sameNode)).toBe(true);
    expect(nodeView.dom.alt).toBe("updated");
  });

  it("stopEvent returns true for mousedown and click", () => {
    const node = {
      attrs: { src: "https://example.com/image.png", alt: "", title: "" },
      type: { name: "image" },
    } as never;
    nodeView = new ImageNodeView(node, () => 0, mockEditor);

    expect(nodeView.stopEvent(new MouseEvent("mousedown"))).toBe(true);
    expect(nodeView.stopEvent(new MouseEvent("click"))).toBe(true);
  });

  it("stopEvent returns false for other events", () => {
    const node = {
      attrs: { src: "https://example.com/image.png", alt: "", title: "" },
      type: { name: "image" },
    } as never;
    nodeView = new ImageNodeView(node, () => 0, mockEditor);

    expect(nodeView.stopEvent(new KeyboardEvent("keydown"))).toBe(false);
    expect(nodeView.stopEvent(new Event("focus"))).toBe(false);
  });

  it("selectNode adds ProseMirror-selectednode class", () => {
    const node = {
      attrs: { src: "https://example.com/image.png", alt: "", title: "" },
      type: { name: "image" },
    } as never;
    nodeView = new ImageNodeView(node, () => 0, mockEditor);

    nodeView.selectNode();
    expect(nodeView.dom.classList.contains("ProseMirror-selectednode")).toBe(true);
  });

  it("deselectNode removes ProseMirror-selectednode class", () => {
    const node = {
      attrs: { src: "https://example.com/image.png", alt: "", title: "" },
      type: { name: "image" },
    } as never;
    nodeView = new ImageNodeView(node, () => 0, mockEditor);

    nodeView.selectNode();
    nodeView.deselectNode();
    expect(nodeView.dom.classList.contains("ProseMirror-selectednode")).toBe(false);
  });

  it("destroy cleans up event listeners", () => {
    const node = {
      attrs: { src: "https://example.com/image.png", alt: "", title: "" },
      type: { name: "image" },
    } as never;
    nodeView = new ImageNodeView(node, () => 0, mockEditor);

    const removeEventListenerSpy = vi.spyOn(nodeView.dom, "removeEventListener");
    nodeView.destroy();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("contextmenu", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("dblclick", expect.any(Function));
  });

  it("handles data: URLs as external", () => {
    const node = {
      attrs: { src: "data:image/png;base64,abc123", alt: "", title: "" },
      type: { name: "image" },
    } as never;
    nodeView = new ImageNodeView(node, () => 0, mockEditor);

    expect(nodeView.dom.src).toBe("data:image/png;base64,abc123");
  });
});
