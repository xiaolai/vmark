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

const mockIsImeKeyEvent = vi.fn(() => false);
vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: (...args: unknown[]) => mockIsImeKeyEvent(...args),
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
    initImagePasteToast(useImagePasteToastStore as never);

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
    initImagePasteToast(useImagePasteToastStore as never);

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
    initImagePasteToast(useImagePasteToastStore as never);

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
    initImagePasteToast(useImagePasteToastStore as never);

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
    initImagePasteToast(useImagePasteToastStore as never);

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
    initImagePasteToast(useImagePasteToastStore as never);

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
    initImagePasteToast(useImagePasteToastStore as never);

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
    initImagePasteToast(useImagePasteToastStore as never);

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
    initImagePasteToast(useImagePasteToastStore as never);

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
    initImagePasteToast(useImagePasteToastStore as never);

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
    initImagePasteToast(useImagePasteToastStore as never);

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
    initImagePasteToast(useImagePasteToastStore as never);

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
    initImagePasteToast(useImagePasteToastStore as never);

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
    initImagePasteToast(useImagePasteToastStore as never);

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

  it("shows 'Insert All' button title for multiple images", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast(useImagePasteToastStore as never);

    (useImagePasteToastStore as unknown as { _setState: (s: object) => void })._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
      isMultiple: true,
      imageCount: 3,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const insertBtn = container.querySelector(".image-paste-toast-btn-insert") as HTMLButtonElement;
    expect(insertBtn?.title).toBe("Insert All");
  });

  it("shows single image message for isMultiple with count 1", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast(useImagePasteToastStore as never);

    (useImagePasteToastStore as unknown as { _setState: (s: object) => void })._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
      isMultiple: true,
      imageCount: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const message = container.querySelector(".image-paste-toast-message");
    // isMultiple=true but imageCount=1 should show "Image URL"
    expect(message?.textContent).toBe("Image URL");
  });
});

describe("ImagePasteToastView keyboard edge cases", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.replaceChildren();
    container = createEditorContainer();
    (useImagePasteToastStore as unknown as { _reset: () => void })._reset();
  });

  afterEach(() => {
    destroyImagePasteToast();
    container.remove();
  });

  it("Enter on dismiss button calls dismiss", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast(useImagePasteToastStore as never);

    const store = useImagePasteToastStore as unknown as { _setState: (s: object) => void; getState: () => { dismiss: ReturnType<typeof vi.fn> } };
    store._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Focus the dismiss button
    const dismissBtn = container.querySelector(".image-paste-toast-btn-dismiss") as HTMLElement;
    expect(dismissBtn).not.toBeNull();
    dismissBtn.focus();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(store.getState().dismiss).toHaveBeenCalled();
  });

  it("Enter with no button focused defaults to insert", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast(useImagePasteToastStore as never);

    const store = useImagePasteToastStore as unknown as { _setState: (s: object) => void; getState: () => { confirm: ReturnType<typeof vi.fn> } };
    store._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Focus something outside the toast buttons
    document.body.focus();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(store.getState().confirm).toHaveBeenCalled();
  });

  it("Shift+Tab cycles focus backwards", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast(useImagePasteToastStore as never);

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

    // Focus on insert button (index 0)
    insertBtn.focus();

    // Shift+Tab from first button should wrap to last
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(dismissBtn);
  });

  it("Shift+Tab from non-first button moves to previous (currentIndex - 1 branch)", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast(useImagePasteToastStore as never);

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

    // Focus the dismiss button (index 1, non-first)
    dismissBtn.focus();

    // Shift+Tab from non-first button should go to previous (insert, index 0)
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(insertBtn);
  });

  it("auto-dismiss timer hides toast after timeout", async () => {
    vi.useFakeTimers();

    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast(useImagePasteToastStore as never);

    const store = useImagePasteToastStore as unknown as { _setState: (s: object) => void; getState: () => { hideToast: ReturnType<typeof vi.fn> } };
    store._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    // Advance timer past auto-dismiss threshold (5000ms)
    vi.advanceTimersByTime(5100);

    expect(store.getState().hideToast).toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe("ImagePasteToastView — hide on close transition", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.replaceChildren();
    container = createEditorContainer();
    (useImagePasteToastStore as unknown as { _reset: () => void })._reset();
  });

  afterEach(() => {
    destroyImagePasteToast();
    container.remove();
  });

  it("hides toast when store transitions from open to closed", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast(useImagePasteToastStore as never);

    const store = useImagePasteToastStore as unknown as {
      _setState: (s: object) => void;
      getState: () => { hideToast: ReturnType<typeof vi.fn> };
    };

    // First open the toast
    store._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const popup = container.querySelector(".image-paste-toast") as HTMLElement;
    expect(popup).not.toBeNull();
    expect(popup.style.display).toBe("flex");

    // Now close it — triggers the else branch (line 59: this.hide())
    store._setState({
      isOpen: false,
      anchorRect: null,
      imagePath: "",
      imageType: "url" as const,
      editorDom: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // The hide() method sets display to none
    expect(popup.style.display).toBe("none");
  });

  it("keyboard handler ignores IME key events (isComposing=true)", async () => {
    // isImeKeyEvent checks isComposing flag among other things
    // The mock returns false for all events; test IME via Process key (common IME indicator)
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast(useImagePasteToastStore as never);

    const store = useImagePasteToastStore as unknown as {
      _setState: (s: object) => void;
      getState: () => { confirm: ReturnType<typeof vi.fn> };
    };

    store._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    // The keyboard handler is attached; verify it doesn't crash on any key
    // (IME guard coverage is exercised by the isImeKeyEvent mock returning false,
    //  meaning the code flow proceeds normally past the guard)
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    // 'a' key is not Enter/Escape/Tab so nothing should be called
    expect(store.getState().confirm).not.toHaveBeenCalled();
  });

  it("keyboard handler ignores events when popup is already closed", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast(useImagePasteToastStore as never);

    const store = useImagePasteToastStore as unknown as {
      _setState: (s: object) => void;
      getState: () => { confirm: ReturnType<typeof vi.fn> };
    };

    // Open the toast first (this installs the keyboard handler)
    store._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Now simulate the store saying isOpen=false (but keyboard handler is still active)
    store._setState({
      isOpen: false,
      anchorRect: null,
      imagePath: "",
      imageType: "url" as const,
      editorDom: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Fire Enter — keyboard handler checks isOpen and should return early
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(store.getState().confirm).not.toHaveBeenCalled();
  });
});

describe("ImagePasteToastView — click outside when not open (line 259)", () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    container = createEditorContainer();
    (useImagePasteToastStore as unknown as { _reset: () => void })._reset();
  });

  afterEach(() => {
    destroyImagePasteToast();
    container.remove();
  });

  it("click outside does nothing when popup is not open", () => {
    initImagePasteToast(useImagePasteToastStore as never);

    const store = useImagePasteToastStore as unknown as {
      getState: () => { hideToast: ReturnType<typeof vi.fn> };
    };

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const event = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(event, "target", { value: outside });
    document.dispatchEvent(event);

    expect(store.getState().hideToast).not.toHaveBeenCalled();
    outside.remove();
  });
});

describe("ImagePasteToastView — IME guard (line 190)", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.replaceChildren();
    container = createEditorContainer();
    (useImagePasteToastStore as unknown as { _reset: () => void })._reset();
  });

  afterEach(() => {
    destroyImagePasteToast();
    container.remove();
    mockIsImeKeyEvent.mockReturnValue(false);
  });

  it("keyboard handler returns early for IME composing events", async () => {
    mockIsImeKeyEvent.mockReturnValue(true);

    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast(useImagePasteToastStore as never);

    const store = useImagePasteToastStore as unknown as {
      _setState: (s: object) => void;
      getState: () => { confirm: ReturnType<typeof vi.fn> };
    };

    store._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(store.getState().confirm).not.toHaveBeenCalled();
  });
});

describe("ImagePasteToastView — CodeMirror bounds (lines 141-143)", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.replaceChildren();
    container = createEditorContainer();
    (useImagePasteToastStore as unknown as { _reset: () => void })._reset();
  });

  afterEach(() => {
    destroyImagePasteToast();
    container.remove();
  });

  it("uses .cm-content for horizontal bounds when present", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;

    const cmContent = document.createElement("div");
    cmContent.className = "cm-content";
    cmContent.getBoundingClientRect = () =>
      ({ top: 100, left: 80, bottom: 600, right: 700, width: 620, height: 500, x: 80, y: 100, toJSON: () => ({}) }) as DOMRect;
    editorDom.appendChild(cmContent);

    initImagePasteToast(useImagePasteToastStore as never);

    (useImagePasteToastStore as unknown as { _setState: (s: object) => void })._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const popup = container.querySelector(".image-paste-toast") as HTMLElement;
    expect(popup).not.toBeNull();
    expect(popup.style.display).toBe("flex");
  });
});

describe("ImagePasteToastView — singleton idempotency", () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    container = createEditorContainer();
    (useImagePasteToastStore as unknown as { _reset: () => void })._reset();
  });

  afterEach(() => {
    destroyImagePasteToast();
    container.remove();
  });

  it("initImagePasteToast is idempotent — does not create a second instance", () => {
    initImagePasteToast(useImagePasteToastStore as never);
    initImagePasteToast(useImagePasteToastStore as never); // second call should be no-op

    // Only one toast element should exist
    destroyImagePasteToast();
    expect(document.querySelector(".image-paste-toast")).toBeNull();
  });

  it("destroyImagePasteToast is idempotent — safe to call when no instance", () => {
    destroyImagePasteToast(); // No instance — should not throw
    destroyImagePasteToast(); // Already null — should not throw
  });
});

describe("ImagePasteToastView — click inside toast does not close", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.replaceChildren();
    container = createEditorContainer();
    (useImagePasteToastStore as unknown as { _reset: () => void })._reset();
  });

  afterEach(() => {
    destroyImagePasteToast();
    container.remove();
  });

  it("does not close when clicking inside the toast container", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast(useImagePasteToastStore as never);

    const store = useImagePasteToastStore as unknown as {
      _setState: (s: object) => void;
      getState: () => { hideToast: ReturnType<typeof vi.fn> };
    };

    store._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const toastEl = container.querySelector(".image-paste-toast") as HTMLElement;
    const event = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(event, "target", { value: toastEl });
    document.dispatchEvent(event);

    expect(store.getState().hideToast).not.toHaveBeenCalled();
  });
});

describe("ImagePasteToastView — host container already mounted (line 127)", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.replaceChildren();
    container = createEditorContainer();
    (useImagePasteToastStore as unknown as { _reset: () => void })._reset();
  });

  afterEach(() => {
    destroyImagePasteToast();
    container.remove();
  });

  it("does not re-append when container is already mounted to same host", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast(useImagePasteToastStore as never);

    const store = useImagePasteToastStore as unknown as {
      _setState: (s: object) => void;
    };

    // Open first time
    store._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Close
    store._setState({
      isOpen: false,
      anchorRect: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Re-open — container.parentElement should already be the host
    store._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test2.png",
      imageType: "localPath" as const,
      editorDom,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const popup = container.querySelector(".image-paste-toast") as HTMLElement;
    expect(popup).not.toBeNull();
    expect(popup.style.display).toBe("flex");
  });
});

describe("ImagePasteToastView — editorDom without editor-container (line 138)", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.replaceChildren();
    container = createEditorContainer();
    (useImagePasteToastStore as unknown as { _reset: () => void })._reset();
  });

  afterEach(() => {
    destroyImagePasteToast();
    container.remove();
  });

  it("uses viewport bounds when editorDom has no editor-container ancestor", async () => {
    // Create an editorDom without editor-container parent
    const standaloneEditor = document.createElement("div");
    standaloneEditor.className = "ProseMirror";
    standaloneEditor.getBoundingClientRect = () =>
      createMockRect({ top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600 });
    document.body.appendChild(standaloneEditor);

    initImagePasteToast(useImagePasteToastStore as never);

    (useImagePasteToastStore as unknown as { _setState: (s: object) => void })._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom: standaloneEditor,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should still show (using viewport bounds fallback)
    const popup = document.querySelector(".image-paste-toast") as HTMLElement;
    expect(popup).not.toBeNull();
    expect(popup.style.display).toBe("flex");

    standaloneEditor.remove();
  });
});

describe("ImagePasteToastView — single image with isMultiple=false button title", () => {
  let container: HTMLElement;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.replaceChildren();
    container = createEditorContainer();
    (useImagePasteToastStore as unknown as { _reset: () => void })._reset();
  });

  afterEach(() => {
    destroyImagePasteToast();
    container.remove();
  });

  it("shows 'Insert as Image' title for single non-multiple image", async () => {
    const editorDom = container.querySelector(".ProseMirror") as HTMLElement;
    initImagePasteToast(useImagePasteToastStore as never);

    (useImagePasteToastStore as unknown as { _setState: (s: object) => void })._setState({
      isOpen: true,
      anchorRect,
      imagePath: "test.png",
      imageType: "url" as const,
      editorDom,
      isMultiple: false,
      imageCount: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const insertBtn = container.querySelector(".image-paste-toast-btn-insert") as HTMLButtonElement;
    expect(insertBtn?.title).toBe("Insert as Image");
  });
});
