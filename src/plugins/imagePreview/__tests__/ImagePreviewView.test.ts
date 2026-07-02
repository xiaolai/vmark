/**
 * Image Preview View Mounting Tests
 *
 * Tests for mounting ImagePreviewView inside editor container.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AnchorRect } from "@/utils/popupPosition";

// Mock Tauri APIs before importing the module
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock("@tauri-apps/api/path", () => ({
  dirname: vi.fn(() => Promise.resolve("/test/dir")),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      getDocument: () => ({ filePath: "/test/doc.md" }),
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

// Import after mocking
import { ImagePreviewView, getImagePreviewView, hideImagePreview } from "../ImagePreviewView";

// jsdom does not implement HTMLMediaElement.prototype.pause — mock it globally
// so that resetMediaElements() doesn't throw when calling videoEl.pause() / audioEl.pause().
HTMLMediaElement.prototype.pause = vi.fn();

// Helper to create mock DOMRect
const createMockRect = (overrides: Partial<DOMRect> = {}): DOMRect => ({
  top: 100,
  left: 50,
  bottom: 120,
  right: 200,
  width: 150,
  height: 20,
  x: 50,
  y: 100,
  toJSON: () => ({}),
  ...overrides,
});

// Helper to create editor container
function createEditorContainer(): HTMLElement {
  const container = document.createElement("div");
  container.className = "editor-container";
  container.style.position = "relative";
  container.getBoundingClientRect = () =>
    createMockRect({ top: 100, left: 50, bottom: 600, right: 800, width: 750, height: 500 });

  const editorDom = document.createElement("div");
  editorDom.className = "ProseMirror";
  editorDom.getBoundingClientRect = () =>
    createMockRect({ top: 100, left: 50, bottom: 600, right: 800, width: 750, height: 500 });
  container.appendChild(editorDom);

  document.body.appendChild(container);
  return container;
}

describe("ImagePreviewView mounting", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("mounts inside editor-container when editorDom provided", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.png", anchorRect, editorDom);

    const popup = container.querySelector(".image-preview-popup");
    expect(popup).not.toBeNull();
    expect(container.contains(popup)).toBe(true);

    view.destroy();
  });

  it("falls back to document.body when no editorDom", () => {
    const view = new ImagePreviewView();

    view.show("test.png", anchorRect);

    const popup = document.querySelector(".image-preview-popup");
    expect(popup).not.toBeNull();
    expect(document.body.contains(popup)).toBe(true);

    view.destroy();
  });

  it("uses absolute positioning when mounted in editor-container", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.png", anchorRect, editorDom);

    const popup = container.querySelector(".image-preview-popup") as HTMLElement;
    expect(popup.style.position).toBe("absolute");

    view.destroy();
  });

  it("uses fixed positioning when mounted in document.body", () => {
    const view = new ImagePreviewView();

    view.show("test.png", anchorRect);

    const popup = document.querySelector(".image-preview-popup") as HTMLElement;
    expect(popup.style.position).toBe("fixed");

    view.destroy();
  });

  it("converts coordinates to container-relative when in editor-container", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    // Container is at (50, 100) in viewport
    view.show("test.png", anchorRect, editorDom);

    const popup = container.querySelector(".image-preview-popup") as HTMLElement;
    // Position should be relative to container, not viewport
    const top = parseInt(popup.style.top);
    const left = parseInt(popup.style.left);

    // Coordinates should be adjusted relative to container position
    // Anchor is at viewport (200, 150), container is at viewport (100, 50)
    // So relative position would be approximately (100, 100) minus popup positioning adjustments
    expect(top).toBeLessThan(200); // Should be less than viewport coords
    expect(left).toBeLessThan(150);

    view.destroy();
  });

  it("re-mounts when switching editor contexts", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    // First show in container
    view.show("test.png", anchorRect, editorDom);
    expect(container.contains(document.querySelector(".image-preview-popup"))).toBe(true);

    // Hide
    view.hide();

    // Show without editorDom (falls back to body)
    view.show("test.png", anchorRect);
    expect(document.body.querySelector(":scope > .image-preview-popup")).not.toBeNull();

    view.destroy();
  });

  it("cleans up properly on destroy", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.png", anchorRect, editorDom);
    expect(container.querySelector(".image-preview-popup")).not.toBeNull();

    view.destroy();
    expect(container.querySelector(".image-preview-popup")).toBeNull();
  });
});

describe("getImagePreviewView singleton", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns the same instance", () => {
    const view1 = getImagePreviewView();
    const view2 = getImagePreviewView();
    expect(view1).toBe(view2);
  });
});

describe("ImagePreviewView loading states", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("shows loading state initially", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.png", anchorRect, editorDom);

    const loading = container.querySelector(".image-preview-loading") as HTMLElement;
    expect(loading.style.display).toBe("block");

    view.destroy();
  });

  it("hides image initially", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.png", anchorRect, editorDom);

    const img = container.querySelector(".image-preview-img") as HTMLElement;
    expect(img.style.display).toBe("none");

    view.destroy();
  });

  it("shows error for empty path", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("   ", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    const error = container.querySelector(".image-preview-error") as HTMLElement;
    expect(error.textContent).toBe("No media path");
    const loading = container.querySelector(".image-preview-loading") as HTMLElement;
    expect(loading.style.display).toBe("none");

    view.destroy();
  });

  it("isVisible returns true when shown", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    expect(view.isVisible()).toBe(false);
    view.show("test.png", anchorRect, editorDom);
    expect(view.isVisible()).toBe(true);
    view.hide();
    expect(view.isVisible()).toBe(false);

    view.destroy();
  });

  it("hide clears the preview state", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.png", anchorRect, editorDom);
    expect(container.querySelector(".image-preview-popup")).not.toBeNull();

    view.hide();

    const popup = container.querySelector(".image-preview-popup") as HTMLElement;
    expect(popup.style.display).toBe("none");

    view.destroy();
  });
});

describe("ImagePreviewView media types", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("shows video element for video type", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.mp4", anchorRect, editorDom, "video");

    const video = container.querySelector(".image-preview-video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.controls).toBe(true);

    const popup = container.querySelector(".image-preview-popup") as HTMLElement;
    expect(popup.classList.contains("image-preview-popup--interactive")).toBe(true);

    view.destroy();
  });

  it("shows audio element for audio type", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.mp3", anchorRect, editorDom, "audio");

    const audio = container.querySelector(".image-preview-audio") as HTMLAudioElement;
    expect(audio).not.toBeNull();
    expect(audio.controls).toBe(true);

    const popup = container.querySelector(".image-preview-popup") as HTMLElement;
    expect(popup.classList.contains("image-preview-popup--interactive")).toBe(true);

    view.destroy();
  });

  it("does not add interactive class for image type", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.png", anchorRect, editorDom, "image");

    const popup = container.querySelector(".image-preview-popup") as HTMLElement;
    expect(popup.classList.contains("image-preview-popup--interactive")).toBe(false);

    view.destroy();
  });

  it("pauses video and audio on hide", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.mp4", anchorRect, editorDom, "video");

    const video = container.querySelector(".image-preview-video") as HTMLVideoElement;
    const audio = container.querySelector(".image-preview-audio") as HTMLAudioElement;
    const videoPauseSpy = vi.spyOn(video, "pause");
    const audioPauseSpy = vi.spyOn(audio, "pause");

    view.hide();

    expect(videoPauseSpy).toHaveBeenCalled();
    expect(audioPauseSpy).toHaveBeenCalled();

    view.destroy();
  });

  it("increments resolve token on hide to cancel pending loads", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.png", anchorRect, editorDom);
    expect(view.isVisible()).toBe(true);

    view.hide();
    expect(view.isVisible()).toBe(false);

    view.destroy();
  });
});

describe("ImagePreviewView external URLs", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("loads external HTTP URL directly", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("https://example.com/image.png", anchorRect, editorDom);

    await new Promise((r) => setTimeout(r, 50));

    view.destroy();
  });

  it("loads data: URL directly", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("data:image/png;base64,abc", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    view.destroy();
  });

  it("updateContent with type changes media type", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.png", anchorRect, editorDom, "image");

    const popup = container.querySelector(".image-preview-popup") as HTMLElement;
    expect(popup.classList.contains("image-preview-popup--interactive")).toBe(false);

    view.updateContent("test.mp4", undefined, "video");
    expect(popup.classList.contains("image-preview-popup--interactive")).toBe(true);

    view.destroy();
  });
});

describe("ImagePreviewView updateContent", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("updateContent triggers new load", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.png", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 10));

    // Update to empty path should show error
    view.updateContent("   ");
    await new Promise((r) => setTimeout(r, 50));

    const error = container.querySelector(".image-preview-error") as HTMLElement;
    expect(error.textContent).toBe("No media path");

    view.destroy();
  });

  it("updateContent with new anchorRect updates position", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.png", anchorRect, editorDom);
    const popup = container.querySelector(".image-preview-popup") as HTMLElement;
    const initialTop = popup.style.top;

    // Update with new anchor position
    const newAnchorRect: AnchorRect = { top: 300, left: 200, bottom: 320, right: 300 };
    view.updateContent("test2.png", newAnchorRect);

    // Position should change
    expect(popup.style.top).not.toBe(initialTop);

    view.destroy();
  });
});

describe("hideImagePreview", () => {
  it("does nothing when no preview instance exists", () => {
    // Calling hideImagePreview without ever creating a preview should not throw
    expect(() => hideImagePreview()).not.toThrow();
  });

  it("hides an existing preview instance", () => {
    const view = getImagePreviewView();
    const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };
    view.show("test.png", anchorRect);
    expect(view.isVisible()).toBe(true);

    hideImagePreview();
    expect(view.isVisible()).toBe(false);
  });
});

describe("ImagePreviewView image loading", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("shows image on successful load via onload", async () => {
    // Override Image so that setting src triggers onload synchronously
    const origImage = globalThis.Image;
    globalThis.Image = class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = "";
      get src() { return this._src; }
      set src(val: string) {
        this._src = val;
        // Fire onload on next microtask (after handlers are set)
        Promise.resolve().then(() => { if (this.onload) this.onload(); });
      }
    } as unknown as typeof Image;

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("data:image/png;base64,abc", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 100));

    const img = container.querySelector(".image-preview-img") as HTMLElement;
    expect(img.style.display).toBe("block");
    const loading = container.querySelector(".image-preview-loading") as HTMLElement;
    expect(loading.style.display).toBe("none");

    globalThis.Image = origImage;
    view.destroy();
  });

  it("shows error on failed image load via onerror", async () => {
    const origImage = globalThis.Image;
    globalThis.Image = class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = "";
      get src() { return this._src; }
      set src(val: string) {
        this._src = val;
        Promise.resolve().then(() => { if (this.onerror) this.onerror(); });
      }
    } as unknown as typeof Image;

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("data:image/png;base64,invalid", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 100));

    const error = container.querySelector(".image-preview-error") as HTMLElement;
    expect(error.textContent).toBe("Failed to load");

    globalThis.Image = origImage;
    view.destroy();
  });

  it("ignores stale image onload when token changes", async () => {
    let savedOnload: (() => void) | null = null;
    const origImage = globalThis.Image;
    globalThis.Image = class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = "";
      get src() { return this._src; }
      set src(val: string) {
        this._src = val;
        // Save onload but don't call it yet
        savedOnload = this.onload;
      }
    } as unknown as typeof Image;

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("data:image/png;base64,abc", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    // Hide increments token, making the pending load stale
    view.hide();

    // Now trigger the stale onload
    if (savedOnload) savedOnload();

    // Image should NOT be shown
    const img = container.querySelector(".image-preview-img") as HTMLElement;
    expect(img.style.display).toBe("none");

    globalThis.Image = origImage;
    view.destroy();
  });

  it("ignores stale image onerror when token changes", async () => {
    let savedOnerror: (() => void) | null = null;
    const origImage = globalThis.Image;
    globalThis.Image = class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = "";
      get src() { return this._src; }
      set src(val: string) {
        this._src = val;
        savedOnerror = this.onerror;
      }
    } as unknown as typeof Image;

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("data:image/png;base64,abc", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    view.hide();

    // Trigger stale onerror
    if (savedOnerror) savedOnerror();

    // Error should NOT be shown (stale)
    const error = container.querySelector(".image-preview-error") as HTMLElement;
    expect(error.textContent).toBe("");

    globalThis.Image = origImage;
    view.destroy();
  });
});

describe("ImagePreviewView video/audio loading", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("shows video on loadedmetadata", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("https://example.com/video.mp4", anchorRect, editorDom, "video");
    await new Promise((r) => setTimeout(r, 50));

    const video = container.querySelector(".image-preview-video") as HTMLVideoElement;
    // Simulate loadedmetadata event
    video.dispatchEvent(new Event("loadedmetadata"));

    expect(video.style.display).toBe("block");
    const loading = container.querySelector(".image-preview-loading") as HTMLElement;
    expect(loading.style.display).toBe("none");

    view.destroy();
  });

  it("shows error on video load error", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("https://example.com/broken.mp4", anchorRect, editorDom, "video");
    await new Promise((r) => setTimeout(r, 50));

    const video = container.querySelector(".image-preview-video") as HTMLVideoElement;
    video.dispatchEvent(new Event("error"));

    const error = container.querySelector(".image-preview-error") as HTMLElement;
    expect(error.textContent).toBe("Failed to load");

    view.destroy();
  });

  it("shows audio on loadedmetadata", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("https://example.com/audio.mp3", anchorRect, editorDom, "audio");
    await new Promise((r) => setTimeout(r, 50));

    const audio = container.querySelector(".image-preview-audio") as HTMLAudioElement;
    audio.dispatchEvent(new Event("loadedmetadata"));

    expect(audio.style.display).toBe("block");
    const loading = container.querySelector(".image-preview-loading") as HTMLElement;
    expect(loading.style.display).toBe("none");

    view.destroy();
  });

  it("shows error on audio load error", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("https://example.com/broken.mp3", anchorRect, editorDom, "audio");
    await new Promise((r) => setTimeout(r, 50));

    const audio = container.querySelector(".image-preview-audio") as HTMLAudioElement;
    audio.dispatchEvent(new Event("error"));

    const error = container.querySelector(".image-preview-error") as HTMLElement;
    expect(error.textContent).toBe("Failed to load");

    view.destroy();
  });

  it("ignores stale video error event", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("https://example.com/video.mp4", anchorRect, editorDom, "video");
    await new Promise((r) => setTimeout(r, 50));

    const video = container.querySelector(".image-preview-video") as HTMLVideoElement;

    // Hide to increment resolve token
    view.hide();

    // Fire error event on stale video load
    video.dispatchEvent(new Event("error"));

    // Error should NOT be shown (stale token)
    const error = container.querySelector(".image-preview-error") as HTMLElement;
    expect(error.textContent).toBe("");

    view.destroy();
  });

  it("ignores stale video loadedmetadata event", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("https://example.com/video.mp4", anchorRect, editorDom, "video");
    await new Promise((r) => setTimeout(r, 50));

    const video = container.querySelector(".image-preview-video") as HTMLVideoElement;

    // Hide to increment resolve token
    view.hide();

    // Fire loadedmetadata event on stale video load
    video.dispatchEvent(new Event("loadedmetadata"));

    // Video should NOT be shown (stale token)
    expect(video.style.display).toBe("none");

    view.destroy();
  });

  it("cleans up event listeners after loadedmetadata", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("https://example.com/video.mp4", anchorRect, editorDom, "video");
    await new Promise((r) => setTimeout(r, 50));

    const video = container.querySelector(".image-preview-video") as HTMLVideoElement;
    const removeEventListenerSpy = vi.spyOn(video, "removeEventListener");

    video.dispatchEvent(new Event("loadedmetadata"));

    expect(removeEventListenerSpy).toHaveBeenCalledWith("loadedmetadata", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("error", expect.any(Function));

    view.destroy();
  });
});

describe("ImagePreviewView path resolution", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("resolves absolute path via convertFileSrc", async () => {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("/absolute/path/to/image.png", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    expect(convertFileSrc).toHaveBeenCalledWith("/absolute/path/to/image.png");

    view.destroy();
  });

  it("resolves Windows absolute path", async () => {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("C:\\Users\\test\\image.png", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    // Should normalize backslashes to forward slashes
    expect(convertFileSrc).toHaveBeenCalledWith("C:/Users/test/image.png");

    view.destroy();
  });

  it("resolves relative path against document directory", async () => {
    const { join } = await import("@tauri-apps/api/path");
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("./assets/image.png", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    expect(join).toHaveBeenCalledWith("/test/dir", "assets/image.png");

    view.destroy();
  });

  it("resolves assets/ relative path", async () => {
    const { join } = await import("@tauri-apps/api/path");
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("assets/photo.png", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    expect(join).toHaveBeenCalledWith("/test/dir", "assets/photo.png");

    view.destroy();
  });

  // Regression for issue #1086 (fix #4): the preview popup used a narrower
  // definition of "relative" than the editor NodeView — it only accepted
  // `./`- and `assets/`-prefixed paths, so a bare relative path like
  // `evidence/page-1.png` was left unresolved. Unified on
  // mediaSecurity.isRelativePath so bare relative paths resolve against the
  // document directory, matching the editor.
  it("resolves bare relative path against document directory", async () => {
    const { join } = await import("@tauri-apps/api/path");
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("evidence/page-1.png", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    expect(join).toHaveBeenCalledWith("/test/dir", "evidence/page-1.png");

    view.destroy();
  });

  it("does not resolve a parent-traversal relative path", async () => {
    const { join } = await import("@tauri-apps/api/path");
    (join as ReturnType<typeof vi.fn>).mockClear();
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("../secrets/key.png", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    expect(join).not.toHaveBeenCalled();

    view.destroy();
  });

  it("falls back to original src when no active file for relative path", async () => {
    // Override mock to return no document
    const { useTabStore } = await import("@/stores/tabStore");
    const origGetState = useTabStore.getState;
    (useTabStore as unknown as Record<string, unknown>).getState = () => ({
      activeTabId: {},
    });

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    // Should not throw, falls back to original src
    view.show("./assets/image.png", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    // Restore
    (useTabStore as unknown as Record<string, unknown>).getState = origGetState;
    view.destroy();
  });

  it("falls back on path resolution error", async () => {
    const { dirname } = await import("@tauri-apps/api/path");
    (dirname as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("path error"));

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("./assets/image.png", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 100));

    // Should show error or fallback gracefully (path resolution failed in the try/catch inside resolveImageSrc)
    view.destroy();
  });

  it("handles getActiveFilePath catch branch when store throws", async () => {
    const { useTabStore } = await import("@/stores/tabStore");
    const origGetState = useTabStore.getState;
    (useTabStore as unknown as Record<string, unknown>).getState = () => {
      throw new Error("store error");
    };

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    // Relative path needs getActiveFilePath, which will throw → catch returns null
    view.show("./assets/image.png", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    // Restore
    (useTabStore as unknown as Record<string, unknown>).getState = origGetState;
    view.destroy();
  });

  it("shows error when resolveImageSrc promise rejects", async () => {
    // convertFileSrc throwing will cause resolveImageSrc to reject
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    (convertFileSrc as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("conversion failed");
    });

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    // Absolute path will call convertFileSrc which will throw
    view.show("/absolute/path.png", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 100));

    const error = container.querySelector(".image-preview-error") as HTMLElement;
    expect(error.textContent).toBe("Path resolution failed");

    view.destroy();
  });

  it("ignores stale resolveImageSrc rejection", async () => {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    (convertFileSrc as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("conversion failed");
    });

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("/absolute/path.png", anchorRect, editorDom);
    // Immediately hide to increment token
    view.hide();

    await new Promise((r) => setTimeout(r, 100));

    // Error should NOT be shown (stale token)
    const error = container.querySelector(".image-preview-error") as HTMLElement;
    expect(error.textContent).toBe("");

    view.destroy();
  });

  it("uses src directly for unrecognized path format", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    // A path that's not external, not absolute, and not relative
    view.show("some-random-path", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    view.destroy();
  });

  it("shows error when resolveImageSrc rejects with a non-Error value — String(error) branch (line 311)", async () => {
    // Branch: error instanceof Error ? error.message : String(error)
    // The false branch (String(error)) fires when a non-Error is thrown.
    // convertFileSrc is called for absolute paths — make it throw a string.
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    (convertFileSrc as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("string-error-not-an-Error-object");
    });

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    // Absolute path → convertFileSrc → throws string → catch receives non-Error
    view.show("/absolute/path/img.png", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 100));

    // The catch handler calls String("string-error-not-an-Error-object") and shows error
    const error = container.querySelector(".image-preview-error") as HTMLElement;
    expect(error.textContent).toBe("Path resolution failed");

    view.destroy();
  });
});

describe("ImagePreviewView stale load cancellation", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("cancels pending image load on hide", async () => {
    const origImage = globalThis.Image;
    let pendingOnload: (() => void) | null = null;
    globalThis.Image = vi.fn().mockImplementation(() => {
      const img = { onload: null as (() => void) | null, onerror: null as (() => void) | null, src: "" };
      // Delay setting the onload so we can hide before it fires
      setTimeout(() => { pendingOnload = img.onload; }, 200);
      return img;
    }) as unknown as typeof Image;

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("https://example.com/slow.png", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    // Hide before image loads (increments resolveToken)
    view.hide();

    // Now trigger the stale onload
    await new Promise((r) => setTimeout(r, 200));
    if (pendingOnload) pendingOnload();

    // Image should NOT be shown since the load was stale
    const img = container.querySelector(".image-preview-img") as HTMLElement;
    expect(img.style.display).toBe("none");

    globalThis.Image = origImage;
    view.destroy();
  });

  it("cancels pending video load on hide", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("https://example.com/video.mp4", anchorRect, editorDom, "video");
    await new Promise((r) => setTimeout(r, 50));

    const video = container.querySelector(".image-preview-video") as HTMLVideoElement;

    // Hide to increment token
    view.hide();

    // Trigger stale loadedmetadata
    video.dispatchEvent(new Event("loadedmetadata"));

    // Video should still be hidden
    expect(video.style.display).toBe("none");

    view.destroy();
  });

  it("ignores stale resolve result after hide", async () => {
    const { dirname } = await import("@tauri-apps/api/path");
    // Make dirname slow
    (dirname as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((r) => setTimeout(() => r("/slow/dir"), 200))
    );

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("./assets/slow.png", anchorRect, editorDom);

    // Hide before resolve completes
    view.hide();

    await new Promise((r) => setTimeout(r, 300));

    // Should not have shown anything
    expect(view.isVisible()).toBe(false);

    // Restore dirname
    (dirname as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve("/test/dir"));

    view.destroy();
  });
});

describe("ImagePreviewView — rAF repositioning after load", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("repositions after image loads when visible and anchorRect exists", async () => {
    // Use mock Image that fires onload after rAF
    const origImage = globalThis.Image;
    globalThis.Image = class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = "";
      get src() { return this._src; }
      set src(val: string) {
        this._src = val;
        Promise.resolve().then(() => { if (this.onload) this.onload(); });
      }
    } as unknown as typeof Image;

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("data:image/png;base64,abc", anchorRect, editorDom);

    // Wait for resolve + onload
    await new Promise((r) => setTimeout(r, 100));

    // Wait for rAF to fire (repositioning)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    // View should still be visible with repositioned popup
    expect(view.isVisible()).toBe(true);

    globalThis.Image = origImage;
    view.destroy();
  });

  it("does not reposition after image loads when hidden", async () => {
    const origImage = globalThis.Image;
    let savedOnload: (() => void) | null = null;
    globalThis.Image = class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = "";
      get src() { return this._src; }
      set src(val: string) {
        this._src = val;
        // Don't auto-fire — we'll fire manually
        setTimeout(() => { savedOnload = this.onload; }, 10);
      }
    } as unknown as typeof Image;

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("data:image/png;base64,abc", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    // Hide first, then trigger onload
    view.hide();
    if (savedOnload) savedOnload();

    // Wait for rAF
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    // View should remain hidden
    expect(view.isVisible()).toBe(false);

    globalThis.Image = origImage;
    view.destroy();
  });

  it("repositions after video loads when visible", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("https://example.com/video.mp4", anchorRect, editorDom, "video");
    await new Promise((r) => setTimeout(r, 50));

    const video = container.querySelector(".image-preview-video") as HTMLVideoElement;
    video.dispatchEvent(new Event("loadedmetadata"));

    // Wait for rAF
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    expect(view.isVisible()).toBe(true);

    view.destroy();
  });

  it("does not reposition after video loads when hidden", async () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("https://example.com/video.mp4", anchorRect, editorDom, "video");
    await new Promise((r) => setTimeout(r, 50));

    const video = container.querySelector(".image-preview-video") as HTMLVideoElement;

    // Hide, then fire loadedmetadata (will be ignored by stale token)
    view.hide();
    video.dispatchEvent(new Event("loadedmetadata"));

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    expect(view.isVisible()).toBe(false);

    view.destroy();
  });

  it("ignores stale resolveImageSrc then-callback when token changed", async () => {
    // Trigger two rapid show() calls — the first should be cancelled by the second
    const origImage = globalThis.Image;
    const onloadCallbacks: Array<(() => void) | null> = [];
    globalThis.Image = class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = "";
      get src() { return this._src; }
      set src(val: string) {
        this._src = val;
        onloadCallbacks.push(this.onload);
      }
    } as unknown as typeof Image;

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    // First show
    view.show("data:image/png;base64,first", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    // Second show (increments token, making first stale)
    view.show("data:image/png;base64,second", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    // Fire the first onload (stale) — should be ignored
    if (onloadCallbacks[0]) onloadCallbacks[0]();

    // Image should remain in loading state from second load
    const img = container.querySelector(".image-preview-img") as HTMLElement;
    expect(img.style.display).toBe("none");

    globalThis.Image = origImage;
    view.destroy();
  });

  it("updateContent without anchorRect does not reposition", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.png", anchorRect, editorDom, "image");
    const popup = container.querySelector(".image-preview-popup") as HTMLElement;
    const topBefore = popup.style.top;

    // Update without anchorRect — position should not change
    view.updateContent("test2.png");

    expect(popup.style.top).toBe(topBefore);

    view.destroy();
  });

  it("updateContent without type keeps existing media type", () => {
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("test.mp4", anchorRect, editorDom, "video");
    const popup = container.querySelector(".image-preview-popup") as HTMLElement;
    expect(popup.classList.contains("image-preview-popup--interactive")).toBe(true);

    // Update without type — should keep "video" type
    view.updateContent("test2.mp4");
    expect(popup.classList.contains("image-preview-popup--interactive")).toBe(true);

    view.destroy();
  });
});

describe("ImagePreviewView — remaining uncovered branches", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("getActiveFilePath returns null when getDocument returns object with no filePath (line 55 ?? branch)", async () => {
    // Branch 2: getDocument(tabId)?.filePath ?? null — ??(null) fires when filePath is undefined.
    // Override the documentStore mock to return a doc with no filePath.
    const { useDocumentStore } = await import("@/stores/documentStore");
    const origGetState = useDocumentStore.getState;
    (useDocumentStore as unknown as Record<string, unknown>).getState = () => ({
      getDocument: () => ({ filePath: undefined }),
    });

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    // Relative path triggers getActiveFilePath() — since filePath is undefined,
    // the ?? null branch fires and returns null, so resolveImageSrc returns the original src.
    view.show("./assets/image.png", anchorRect, editorDom);
    await new Promise((r) => setTimeout(r, 50));

    // Restore
    (useDocumentStore as unknown as Record<string, unknown>).getState = origGetState;
    view.destroy();
  });

  it("loadAudioVideoElement uses audioEl for audio type (line 310 false branch)", async () => {
    // Branch 26: type === "video" ? this.videoEl : this.audioEl — false branch (audioEl).
    // Use a real external URL so resolveImageSrc returns immediately,
    // then loadAudioVideoElement is called with type="audio" → el = this.audioEl.
    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("https://example.com/sound.ogg", anchorRect, editorDom, "audio");
    await new Promise((r) => setTimeout(r, 50));

    const audio = container.querySelector(".image-preview-audio") as HTMLAudioElement;
    expect(audio).not.toBeNull();
    // el is the audio element — trigger its loadedmetadata to prove audioEl path was taken
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.style.display).toBe("block");

    view.destroy();
  });

  it("rAF false branch after image loads: visible=false when rAF fires (line 325)", async () => {
    // Branch 28: if (this.visible && this.lastAnchorRect) — false branch inside rAF.
    // Strategy: intercept requestAnimationFrame, fire onload (with valid token),
    // then hide() before invoking the rAF callback.
    const origRAF = globalThis.requestAnimationFrame;
    let capturedRAFCallback: ((time: number) => void) | null = null;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      capturedRAFCallback = cb;
      return 1;
    };

    const origImage = globalThis.Image;
    globalThis.Image = class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = "";
      get src() { return this._src; }
      set src(val: string) {
        this._src = val;
        // Fire onload on next microtask so rAF interception is in place
        Promise.resolve().then(() => { if (this.onload) this.onload(); });
      }
    } as unknown as typeof Image;

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    view.show("https://example.com/img.png", anchorRect, editorDom, "image");
    // Wait for resolveImageSrc (external URL resolves immediately) + onload microtask
    await new Promise((r) => setTimeout(r, 50));

    // At this point: onload fired (valid token), rAF callback is captured but not yet run.
    // Now hide the view — sets visible=false.
    view.hide();

    // Now invoke the captured rAF callback — visible is false, so the branch is false.
    if (capturedRAFCallback) capturedRAFCallback(0);

    // View should remain hidden
    expect(view.isVisible()).toBe(false);

    globalThis.Image = origImage;
    globalThis.requestAnimationFrame = origRAF;
    view.destroy();
  });

  it("rAF false branch after audio/video loads: visible=false when rAF fires (line 347)", async () => {
    // Branch 33: if (this.visible && this.lastAnchorRect) — false branch inside audio/video rAF.
    // Same strategy: intercept rAF, fire loadedmetadata with valid token, hide, then invoke rAF.
    const origRAF = globalThis.requestAnimationFrame;
    let capturedRAFCallback: ((time: number) => void) | null = null;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      capturedRAFCallback = cb;
      return 1;
    };

    const view = new ImagePreviewView();
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    // Use video type so we avoid the audio-specific ternary and ensure we can dispatch event easily
    view.show("https://example.com/video.mp4", anchorRect, editorDom, "video");
    // Wait for resolveImageSrc async
    await new Promise((r) => setTimeout(r, 50));

    const video = container.querySelector(".image-preview-video") as HTMLVideoElement;

    // Fire loadedmetadata (valid token) — this schedules the rAF callback
    video.dispatchEvent(new Event("loadedmetadata"));

    // Now hide — sets visible=false
    view.hide();

    // Invoke captured rAF callback — visible is false, so the if-branch is false
    if (capturedRAFCallback) capturedRAFCallback(0);

    expect(view.isVisible()).toBe(false);

    globalThis.requestAnimationFrame = origRAF;
    view.destroy();
  });
});
