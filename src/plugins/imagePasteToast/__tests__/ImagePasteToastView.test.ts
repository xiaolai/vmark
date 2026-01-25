/**
 * Image Paste Toast View Mounting Tests
 *
 * Tests for mounting ImagePasteToastView inside editor container.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AnchorRect } from "@/utils/popupPosition";

// Mock store before importing the module
vi.mock("@/stores/imagePasteToastStore", () => {
  type Subscriber = (state: MockState) => void;
  interface MockState {
    isOpen: boolean;
    anchorRect: AnchorRect | null;
    imagePath: string;
    imageType: "url" | "localPath";
    editorDom: HTMLElement | null;
    isMultiple: boolean;
    imageCount: number;
    hideToast: () => void;
    confirm: () => void;
    dismiss: () => void;
  }
  let subscribers: Subscriber[] = [];
  let state: MockState = {
    isOpen: false,
    anchorRect: null,
    imagePath: "",
    imageType: "url",
    editorDom: null,
    isMultiple: false,
    imageCount: 1,
    hideToast: vi.fn(),
    confirm: vi.fn(),
    dismiss: vi.fn(),
  };

  return {
    useImagePasteToastStore: {
      getState: () => state,
      subscribe: (fn: Subscriber) => {
        subscribers.push(fn);
        return () => {
          subscribers = subscribers.filter((s) => s !== fn);
        };
      },
      // Test helper to update state and notify subscribers
      _setState: (newState: Partial<MockState>) => {
        state = { ...state, ...newState };
        subscribers.forEach((s) => s(state));
      },
      _reset: () => {
        state = {
          isOpen: false,
          anchorRect: null,
          imagePath: "",
          imageType: "url",
          editorDom: null,
          isMultiple: false,
          imageCount: 1,
          hideToast: vi.fn(),
          confirm: vi.fn(),
          dismiss: vi.fn(),
        };
        subscribers = [];
      },
    },
  };
});

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: () => false,
}));

// Import after mocking
import { initImagePasteToast, destroyImagePasteToast } from "../ImagePasteToastView";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";

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

describe("ImagePasteToastView mounting", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
    // Reset the mock store
    (useImagePasteToastStore as unknown as { _reset: () => void })._reset();
  });

  afterEach(() => {
    destroyImagePasteToast();
    container.remove();
  });

  it("mounts inside editor-container when editorDom provided", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast();

    // Trigger show via store
    (useImagePasteToastStore as unknown as { _setState: (s: object) => void })._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    // Wait for the subscription to trigger
    await new Promise((resolve) => setTimeout(resolve, 10));

    const popup = container.querySelector(".image-paste-toast");
    expect(popup).not.toBeNull();
    expect(container.contains(popup)).toBe(true);
  });

  it("falls back to document.body when no editorDom", async () => {
    initImagePasteToast();

    // Trigger show via store without editorDom
    (useImagePasteToastStore as unknown as { _setState: (s: object) => void })._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const popup = document.body.querySelector(":scope > .image-paste-toast");
    expect(popup).not.toBeNull();
  });

  it("uses absolute positioning when mounted in editor-container", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast();

    (useImagePasteToastStore as unknown as { _setState: (s: object) => void })._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const popup = container.querySelector(".image-paste-toast") as HTMLElement;
    expect(popup.style.position).toBe("absolute");
  });

  it("uses fixed positioning when mounted in document.body", async () => {
    initImagePasteToast();

    (useImagePasteToastStore as unknown as { _setState: (s: object) => void })._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const popup = document.querySelector(".image-paste-toast") as HTMLElement;
    expect(popup.style.position).toBe("fixed");
  });

  it("cleans up properly on destroy", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast();

    (useImagePasteToastStore as unknown as { _setState: (s: object) => void })._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(container.querySelector(".image-paste-toast")).not.toBeNull();

    destroyImagePasteToast();
    expect(document.querySelector(".image-paste-toast")).toBeNull();
  });
});
