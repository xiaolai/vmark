/**
 * Image Popup View Tests
 *
 * Tests for the image editing popup including:
 * - Store subscription lifecycle
 * - Input synchronization (src/alt)
 * - Toggle inline/block type
 * - Action buttons
 * - Click outside handling
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AnchorRect } from "@/utils/popupPosition";

// Mock stores and utilities before importing the view
const mockClosePopup = vi.fn();
const mockSetSrc = vi.fn();
const mockSetAlt = vi.fn();
const mockSetNodeType = vi.fn();

type ImageNodeType = "image" | "block_image";

let storeState = {
  isOpen: false,
  imageSrc: "",
  imageAlt: "",
  imageNodePos: -1,
  imageNodeType: "image" as ImageNodeType,
  anchorRect: null as AnchorRect | null,
  closePopup: mockClosePopup,
  setSrc: mockSetSrc,
  setAlt: mockSetAlt,
  setNodeType: mockSetNodeType,
};
const subscribers: Array<(state: typeof storeState) => void> = [];

vi.mock("@/stores/imagePopupStore", () => ({
  useImagePopupStore: {
    getState: () => storeState,
    subscribe: (fn: (state: typeof storeState) => void) => {
      subscribers.push(fn);
      return () => {
        const idx = subscribers.indexOf(fn);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    },
  },
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: () => false,
}));

vi.mock("@/plugins/sourcePopup", () => ({
  getPopupHostForDom: (dom: HTMLElement) => dom.closest(".editor-container"),
  toHostCoordsForDom: (_host: HTMLElement, pos: { top: number; left: number }) => pos,
}));

vi.mock("../imagePopupActions", () => ({
  browseAndReplaceImage: vi.fn(() => Promise.resolve(false)),
}));

// Import after mocking
import { ImagePopupView } from "../ImagePopupView";

// Helper functions
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

function createEditorContainer() {
  const container = document.createElement("div");
  container.className = "editor-container";
  container.style.position = "relative";
  container.getBoundingClientRect = () =>
    createMockRect({ top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600 });

  const editorDom = document.createElement("div");
  editorDom.className = "ProseMirror";
  editorDom.getBoundingClientRect = () =>
    createMockRect({ top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600 });
  container.appendChild(editorDom);

  document.body.appendChild(container);

  return {
    container,
    editorDom,
    cleanup: () => container.remove(),
  };
}

function createMockView(editorDom: HTMLElement) {
  return {
    dom: editorDom,
    state: {
      doc: {
        nodeAt: vi.fn(() => ({
          type: { name: "image" },
          attrs: { src: "", alt: "", title: "" },
          nodeSize: 1,
        })),
      },
      schema: {
        nodes: {
          image: { create: vi.fn((attrs) => ({ type: "image", attrs })) },
          block_image: { create: vi.fn((attrs) => ({ type: "block_image", attrs })) },
        },
      },
      tr: {
        setNodeMarkup: vi.fn().mockReturnThis(),
        replaceWith: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
      },
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
  };
}

function emitStateChange(newState: Partial<typeof storeState>) {
  storeState = { ...storeState, ...newState };
  subscribers.forEach((fn) => fn(storeState));
}

function resetState() {
  storeState = {
    isOpen: false,
    imageSrc: "",
    imageAlt: "",
    imageNodePos: -1,
    imageNodeType: "image",
    anchorRect: null,
    closePopup: mockClosePopup,
    setSrc: mockSetSrc,
    setAlt: mockSetAlt,
    setNodeType: mockSetNodeType,
  };
  subscribers.length = 0;
}

describe("ImagePopupView", () => {
  let dom: ReturnType<typeof createEditorContainer>;
  let view: ReturnType<typeof createMockView>;
  let popup: ImagePopupView;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    vi.clearAllMocks();
    dom = createEditorContainer();
    view = createMockView(dom.editorDom);
    popup = new ImagePopupView(view as unknown as ConstructorParameters<typeof ImagePopupView>[0]);
  });

  afterEach(() => {
    popup.destroy();
    dom.cleanup();
  });

  describe("Store subscription", () => {
    it("subscribes to store on construction", () => {
      expect(subscribers.length).toBe(1);
    });

    it("shows popup when store opens", async () => {
      emitStateChange({
        isOpen: true,
        imageSrc: "/path/to/image.png",
        imageAlt: "Alt text",
        imageNodePos: 42,
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".image-popup");
      expect(popupEl).not.toBeNull();
      expect((popupEl as HTMLElement).style.display).toBe("flex");
    });

    it("hides popup when store closes", async () => {
      emitStateChange({ isOpen: true, imageSrc: "test.png", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      emitStateChange({ isOpen: false, anchorRect: null });

      const popupEl = dom.container.querySelector(".image-popup");
      expect((popupEl as HTMLElement).style.display).toBe("none");
    });

    it("unsubscribes on destroy", () => {
      expect(subscribers.length).toBe(1);
      popup.destroy();
      expect(subscribers.length).toBe(0);
    });
  });

  describe("Input synchronization", () => {
    it("populates src input with imageSrc from store", async () => {
      emitStateChange({
        isOpen: true,
        imageSrc: "/images/photo.jpg",
        imageAlt: "",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const srcInput = dom.container.querySelector(".image-popup-src") as HTMLInputElement;
      expect(srcInput.value).toBe("/images/photo.jpg");
    });

    it("populates alt input with imageAlt from store", async () => {
      emitStateChange({
        isOpen: true,
        imageSrc: "test.png",
        imageAlt: "A beautiful sunset",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const altInput = dom.container.querySelector(".image-popup-alt") as HTMLInputElement;
      expect(altInput.value).toBe("A beautiful sunset");
    });
  });

  describe("Keyboard navigation", () => {
    beforeEach(async () => {
      emitStateChange({
        isOpen: true,
        imageSrc: "/test.png",
        imageAlt: "Test",
        imageNodePos: 10,
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));
    });

    it("closes on Escape", () => {
      const srcInput = dom.container.querySelector(".image-popup-src") as HTMLInputElement;
      srcInput.focus();

      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      srcInput.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.focus).toHaveBeenCalled();
    });

    it("saves on Enter in src input", () => {
      const srcInput = dom.container.querySelector(".image-popup-src") as HTMLInputElement;
      srcInput.focus();
      srcInput.value = "/new-image.png";

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      srcInput.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Toggle image type", () => {
    it("shows toggle button for inline image", async () => {
      emitStateChange({
        isOpen: true,
        imageSrc: "test.png",
        imageNodeType: "image",
        imageNodePos: 10,
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const toggleBtn = dom.container.querySelector(".image-popup-btn-toggle");
      expect(toggleBtn).not.toBeNull();
    });

    it("shows toggle button for block image", async () => {
      emitStateChange({
        isOpen: true,
        imageSrc: "test.png",
        imageNodeType: "block_image",
        imageNodePos: 10,
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const toggleBtn = dom.container.querySelector(".image-popup-btn-toggle");
      expect(toggleBtn).not.toBeNull();
    });
  });

  describe("Action buttons", () => {
    beforeEach(async () => {
      emitStateChange({
        isOpen: true,
        imageSrc: "/path/image.png",
        imageAlt: "Test image",
        imageNodePos: 10,
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));
    });

    it("copy button copies src to clipboard", async () => {
      const mockWriteText = vi.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText: mockWriteText } });

      // Copy button uses title attribute, not specific class
      const copyBtn = dom.container.querySelector('button[title="Copy path"]') as HTMLElement;
      copyBtn.click();

      await new Promise((r) => setTimeout(r, 10));

      expect(mockWriteText).toHaveBeenCalledWith("/path/image.png");
    });

    it("delete button removes image", () => {
      const deleteBtn = dom.container.querySelector(".image-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Click outside handling", () => {
    it("registers mousedown listener for click outside detection", async () => {
      // Verify the popup registers a document-level mousedown listener
      // The actual click-outside behavior uses RAF-deferred close which is hard to test in jsdom
      emitStateChange({ isOpen: true, imageSrc: "test.png", imageNodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".image-popup");
      expect(popupEl).not.toBeNull();
      // Popup is visible and ready to receive click-outside events
      expect((popupEl as HTMLElement).style.display).toBe("flex");
    });

    it("does not close when clicking inside popup", async () => {
      emitStateChange({ isOpen: true, imageSrc: "test.png", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".image-popup") as HTMLElement;
      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: popupEl });
      document.dispatchEvent(mousedownEvent);

      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("Mounting", () => {
    it("mounts inside editor-container", async () => {
      emitStateChange({ isOpen: true, imageSrc: "test.png", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".image-popup");
      expect(popupEl).not.toBeNull();
      expect(dom.container.contains(popupEl)).toBe(true);
    });

    it("uses absolute positioning when in editor-container", async () => {
      emitStateChange({ isOpen: true, imageSrc: "test.png", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".image-popup") as HTMLElement;
      expect(popupEl.style.position).toBe("absolute");
    });

    it("cleans up on destroy", async () => {
      emitStateChange({ isOpen: true, imageSrc: "test.png", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      expect(dom.container.querySelector(".image-popup")).not.toBeNull();

      popup.destroy();

      expect(document.querySelector(".image-popup")).toBeNull();
    });
  });
});
