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
import { ImagePreviewView, getImagePreviewView } from "../ImagePreviewView";

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
