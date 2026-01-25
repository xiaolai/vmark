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

describe("ImagePasteToastView keyboard navigation", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
    (useImagePasteToastStore as unknown as { _reset: () => void })._reset();
  });

  afterEach(() => {
    destroyImagePasteToast();
    container.remove();
  });

  it("Enter on insert button calls confirm", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast();

    const store = useImagePasteToastStore as unknown as { _setState: (s: object) => void; getState: () => { confirm: ReturnType<typeof vi.fn> } };
    store._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Focus should be on insert button by default
    const insertBtn = container.querySelector(".image-paste-toast-btn-insert") as HTMLElement;
    expect(insertBtn).not.toBeNull();
    insertBtn.focus();

    // Dispatch Enter keydown
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(store.getState().confirm).toHaveBeenCalled();
  });

  it("Escape closes the toast", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast();

    const store = useImagePasteToastStore as unknown as { _setState: (s: object) => void; getState: () => { hideToast: ReturnType<typeof vi.fn> } };
    store._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(store.getState().hideToast).toHaveBeenCalled();
  });

  it("Tab cycles focus between buttons", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast();

    (useImagePasteToastStore as unknown as { _setState: (s: object) => void })._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const insertBtn = container.querySelector(".image-paste-toast-btn-insert") as HTMLElement;
    const dismissBtn = container.querySelector(".image-paste-toast-btn-dismiss") as HTMLElement;
    insertBtn.focus();

    // Tab should move to dismiss button
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(dismissBtn);

    // Tab again should cycle back to insert
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(insertBtn);
  });
});

describe("ImagePasteToastView actions", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
    (useImagePasteToastStore as unknown as { _reset: () => void })._reset();
  });

  afterEach(() => {
    destroyImagePasteToast();
    container.remove();
  });

  it("clicking insert button calls confirm", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast();

    const store = useImagePasteToastStore as unknown as { _setState: (s: object) => void; getState: () => { confirm: ReturnType<typeof vi.fn> } };
    store._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const insertBtn = container.querySelector(".image-paste-toast-btn-insert") as HTMLElement;
    insertBtn.click();

    expect(store.getState().confirm).toHaveBeenCalled();
  });

  it("clicking dismiss button calls dismiss", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast();

    const store = useImagePasteToastStore as unknown as { _setState: (s: object) => void; getState: () => { dismiss: ReturnType<typeof vi.fn> } };
    store._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const dismissBtn = container.querySelector(".image-paste-toast-btn-dismiss") as HTMLElement;
    dismissBtn.click();

    expect(store.getState().dismiss).toHaveBeenCalled();
  });

  it("click outside closes toast", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast();

    const store = useImagePasteToastStore as unknown as { _setState: (s: object) => void; getState: () => { hideToast: ReturnType<typeof vi.fn> } };
    store._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Click outside
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const event = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(event, "target", { value: outside });
    document.dispatchEvent(event);

    expect(store.getState().hideToast).toHaveBeenCalled();
  });
});

describe("ImagePasteToastView message display", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    container = createEditorContainer();
    (useImagePasteToastStore as unknown as { _reset: () => void })._reset();
  });

  afterEach(() => {
    destroyImagePasteToast();
    container.remove();
  });

  it("shows 'Image URL' for url type", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast();

    (useImagePasteToastStore as unknown as { _setState: (s: object) => void })._setState({
      isOpen: true,
      anchorRect,
      imagePath: "https://example.com/image.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const message = container.querySelector(".image-paste-toast-message");
    expect(message?.textContent).toBe("Image URL");
  });

  it("shows 'Image path' for localPath type", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast();

    (useImagePasteToastStore as unknown as { _setState: (s: object) => void })._setState({
      isOpen: true,
      anchorRect,
      imagePath: "/path/to/image.png",
      imageType: "localPath" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const message = container.querySelector(".image-paste-toast-message");
    expect(message?.textContent).toBe("Image path");
  });

  it("shows count for multiple images", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast();

    (useImagePasteToastStore as unknown as { _setState: (s: object) => void })._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
      isMultiple: true,
      imageCount: 5,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const message = container.querySelector(".image-paste-toast-message");
    expect(message?.textContent).toBe("5 images");
  });
});
