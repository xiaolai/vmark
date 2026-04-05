import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";

// Mock external dependencies
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve(null)),
  message: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/path", () => ({
  dirname: vi.fn((p: string) => Promise.resolve(p.replace(/\/[^/]+$/, ""))),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      getDocument: vi.fn(() => ({ filePath: "/test/doc.md" })),
    }),
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      activeTabId: { main: "tab1" },
    }),
  },
}));

vi.mock("@/hooks/useWindowFocus", () => ({
  getWindowLabel: () => "main",
}));

vi.mock("@/hooks/useImageOperations", () => ({
  copyImageToAssets: vi.fn(() => Promise.resolve("./assets/image.png")),
}));

vi.mock("@/utils/reentryGuard", () => ({
  withReentryGuard: vi.fn(async (_label: string, _key: string, fn: () => Promise<unknown>) => fn()),
}));

import { saveImageChanges, copyImagePath, removeImage } from "../sourceImageActions";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

function createView(doc: string): EditorView {
  const parent = document.createElement("div");
  const state = EditorState.create({ doc });
  return new EditorView({ state, parent });
}

describe("source image actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    useMediaPopupStore.getState().closePopup();
  });

  describe("saveImageChanges", () => {
    it("preserves title and angle-bracket destination when saving", () => {
      const doc = 'Image ![alt](<path with space> "Title") end.';
      const imageText = '![alt](<path with space> "Title")';
      const imageFrom = doc.indexOf(imageText);
      const view = createView(doc);

      useMediaPopupStore.setState({
        isOpen: true,
        mediaSrc: "new path",
        mediaAlt: "alt",
        mediaNodePos: imageFrom,
        mediaNodeType: "image",
        anchorRect: null,
      });

      saveImageChanges(view);

      expect(view.state.doc.toString()).toBe(
        'Image ![alt](<new path> "Title") end.'
      );

      view.destroy();
    });

    it("saves a simple image without title", () => {
      const doc = "Before ![photo](old.png) after.";
      const imageText = "![photo](old.png)";
      const imageFrom = doc.indexOf(imageText);
      const view = createView(doc);

      useMediaPopupStore.setState({
        isOpen: true,
        mediaSrc: "new.png",
        mediaAlt: "photo",
        mediaNodePos: imageFrom,
        mediaNodeType: "image",
        anchorRect: null,
      });

      saveImageChanges(view);

      expect(view.state.doc.toString()).toBe("Before ![photo](new.png) after.");
      view.destroy();
    });

    it("does nothing when image not found at position", () => {
      const doc = "No image here";
      const view = createView(doc);

      useMediaPopupStore.setState({
        isOpen: true,
        mediaSrc: "image.png",
        mediaAlt: "alt",
        mediaNodePos: -1,
        mediaNodeType: "image",
        anchorRect: null,
      });

      saveImageChanges(view);

      expect(view.state.doc.toString()).toBe("No image here");
      view.destroy();
    });

    it("wraps src in angle brackets when it contains spaces", () => {
      const doc = "![alt](old.png)";
      const view = createView(doc);

      useMediaPopupStore.setState({
        isOpen: true,
        mediaSrc: "path with spaces.png",
        mediaAlt: "alt",
        mediaNodePos: 0,
        mediaNodeType: "image",
        anchorRect: null,
      });

      saveImageChanges(view);

      expect(view.state.doc.toString()).toBe("![alt](<path with spaces.png>)");
      view.destroy();
    });

    it("updates alt text when changed", () => {
      const doc = "![old alt](image.png)";
      const view = createView(doc);

      useMediaPopupStore.setState({
        isOpen: true,
        mediaSrc: "image.png",
        mediaAlt: "new alt",
        mediaNodePos: 0,
        mediaNodeType: "image",
        anchorRect: null,
      });

      saveImageChanges(view);

      expect(view.state.doc.toString()).toBe("![new alt](image.png)");
      view.destroy();
    });
  });

  describe("copyImagePath", () => {
    it("resolves relative path to absolute before copying", async () => {
      useMediaPopupStore.setState({
        isOpen: true,
        mediaSrc: "./assets/photo.png",
        mediaAlt: "photo",
        mediaNodePos: 0,
        mediaNodeType: "image",
        anchorRect: null,
      });

      await copyImagePath();

      // ./assets/photo.png → dirname("/test/doc.md") = "/test" → join("/test", "assets/photo.png")
      expect(writeText).toHaveBeenCalledWith("/test/assets/photo.png");
    });

    it("does nothing when imageSrc is empty", async () => {
      useMediaPopupStore.setState({
        isOpen: true,
        mediaSrc: "",
        mediaAlt: "alt",
        mediaNodePos: 0,
        mediaNodeType: "image",
        anchorRect: null,
      });

      await copyImagePath();

      expect(writeText).not.toHaveBeenCalled();
    });

    it("handles clipboard write failure gracefully", async () => {
      vi.mocked(writeText).mockRejectedValueOnce(new Error("clipboard error"));

      useMediaPopupStore.setState({
        isOpen: true,
        mediaSrc: "image.png",
        mediaAlt: "alt",
        mediaNodePos: 0,
        mediaNodeType: "image",
        anchorRect: null,
      });

      await expect(copyImagePath()).resolves.toBeUndefined();
    });
  });

  describe("removeImage", () => {
    it("removes image markdown entirely", () => {
      const doc = "Before ![alt](image.png) after.";
      const imageText = "![alt](image.png)";
      const imageFrom = doc.indexOf(imageText);
      const view = createView(doc);

      useMediaPopupStore.setState({
        isOpen: true,
        mediaSrc: "image.png",
        mediaAlt: "alt",
        mediaNodePos: imageFrom,
        mediaNodeType: "image",
        anchorRect: null,
      });

      removeImage(view);

      expect(view.state.doc.toString()).toBe("Before  after.");
      view.destroy();
    });

    it("does nothing when image not found", () => {
      const doc = "No image here";
      const view = createView(doc);

      useMediaPopupStore.setState({
        isOpen: true,
        mediaSrc: "image.png",
        mediaAlt: "alt",
        mediaNodePos: -1,
        mediaNodeType: "image",
        anchorRect: null,
      });

      removeImage(view);

      expect(view.state.doc.toString()).toBe("No image here");
      view.destroy();
    });

    it("removes image with title and angle brackets", () => {
      const doc = '![alt](<path with space> "Title")';
      const view = createView(doc);

      useMediaPopupStore.setState({
        isOpen: true,
        mediaSrc: "path with space",
        mediaAlt: "alt",
        mediaNodePos: 0,
        mediaNodeType: "image",
        anchorRect: null,
      });

      removeImage(view);

      expect(view.state.doc.toString()).toBe("");
      view.destroy();
    });
  });
});
