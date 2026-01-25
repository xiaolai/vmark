/**
 * Source Image Popup View Tests
 *
 * Tests for the source mode image popup including:
 * - Store subscription lifecycle
 * - Input synchronization (src/alt)
 * - Keyboard shortcuts
 * - Action buttons
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import type { AnchorRect } from "@/utils/popupPosition";

// Mock stores and utilities
const mockClosePopup = vi.fn();
const mockSetSrc = vi.fn();
const mockSetAlt = vi.fn();
const mockOpenPopup = vi.fn();
const mockSetNodeType = vi.fn();

let storeState = {
  isOpen: false,
  imageSrc: "",
  imageAlt: "",
  imageNodePos: -1,
  imageNodeType: "image" as const,
  anchorRect: null as AnchorRect | null,
  closePopup: mockClosePopup,
  setSrc: mockSetSrc,
  setAlt: mockSetAlt,
  openPopup: mockOpenPopup,
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

vi.mock("@/plugins/sourcePopup/sourcePopupUtils", () => ({
  getPopupHostForDom: () => null,
  toHostCoordsForDom: (_host: HTMLElement, pos: { top: number; left: number }) => pos,
  getEditorBounds: () => ({
    horizontal: { left: 0, right: 800 },
    vertical: { top: 0, bottom: 600 },
  }),
}));

vi.mock("@/utils/popupPosition", () => ({
  calculatePopupPosition: () => ({ top: 200, left: 150 }),
}));

vi.mock("@/utils/popupComponents", () => ({
  handlePopupTabNavigation: vi.fn(),
}));

vi.mock("../sourceImageActions", () => ({
  browseImage: vi.fn(),
  copyImagePath: vi.fn(),
  removeImage: vi.fn(),
  saveImageChanges: vi.fn(),
}));

// Import after mocking
import { SourceImagePopupView } from "../SourceImagePopupView";
import { browseImage, copyImagePath, removeImage, saveImageChanges } from "../sourceImageActions";

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

function createMockView(): EditorView {
  const contentDOM = document.createElement("div");
  contentDOM.contentEditable = "true";

  const editorDom = document.createElement("div");
  editorDom.className = "cm-editor";
  editorDom.appendChild(contentDOM);
  editorDom.getBoundingClientRect = () => createMockRect();
  document.body.appendChild(editorDom);

  return {
    dom: editorDom,
    contentDOM,
    focus: vi.fn(),
  } as unknown as EditorView;
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
    openPopup: mockOpenPopup,
    setNodeType: mockSetNodeType,
  };
  subscribers.length = 0;
}

describe("SourceImagePopupView", () => {
  let view: EditorView;
  let popup: SourceImagePopupView;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    vi.clearAllMocks();
    view = createMockView();
    popup = new SourceImagePopupView(
      view,
      { getState: () => storeState, subscribe: (fn) => { subscribers.push(fn); return () => { const idx = subscribers.indexOf(fn); if (idx >= 0) subscribers.splice(idx, 1); }; } }
    );
  });

  afterEach(() => {
    popup.destroy();
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
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = document.querySelector(".source-image-popup");
      expect(popupEl).not.toBeNull();
      expect((popupEl as HTMLElement).style.display).toBe("flex");
    });

    it("hides popup when store closes", async () => {
      emitStateChange({ isOpen: true, imageSrc: "test.png", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      emitStateChange({ isOpen: false, anchorRect: null });

      const popupEl = document.querySelector(".source-image-popup");
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

      const srcInput = document.querySelector(".source-image-popup-src") as HTMLInputElement;
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

      const altInput = document.querySelector(".source-image-popup-alt") as HTMLInputElement;
      expect(altInput.value).toBe("A beautiful sunset");
    });

    it("calls setSrc on src input change", async () => {
      emitStateChange({ isOpen: true, imageSrc: "", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const srcInput = document.querySelector(".source-image-popup-src") as HTMLInputElement;
      srcInput.value = "/new-image.png";
      srcInput.dispatchEvent(new Event("input", { bubbles: true }));

      expect(mockSetSrc).toHaveBeenCalledWith("/new-image.png");
    });

    it("calls setAlt on alt input change", async () => {
      emitStateChange({ isOpen: true, imageSrc: "test.png", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const altInput = document.querySelector(".source-image-popup-alt") as HTMLInputElement;
      altInput.value = "New alt text";
      altInput.dispatchEvent(new Event("input", { bubbles: true }));

      expect(mockSetAlt).toHaveBeenCalledWith("New alt text");
    });
  });

  describe("Keyboard shortcuts", () => {
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

    it("saves on Enter in src input", () => {
      const srcInput = document.querySelector(".source-image-popup-src") as HTMLInputElement;
      srcInput.focus();

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      srcInput.dispatchEvent(event);

      expect(saveImageChanges).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("saves on Enter in alt input", () => {
      const altInput = document.querySelector(".source-image-popup-alt") as HTMLInputElement;
      altInput.focus();

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      altInput.dispatchEvent(event);

      expect(saveImageChanges).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("closes on Escape", () => {
      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      document.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.focus).toHaveBeenCalled();
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

    it("browse button calls browseImage", () => {
      const browseBtn = document.querySelector('button[title="Browse local file"]') as HTMLElement;
      browseBtn.click();

      expect(browseImage).toHaveBeenCalledWith(view);
    });

    it("copy button calls copyImagePath", () => {
      const copyBtn = document.querySelector('button[title="Copy path"]') as HTMLElement;
      copyBtn.click();

      expect(copyImagePath).toHaveBeenCalled();
    });

    it("delete button removes image and closes popup", () => {
      const deleteBtn = document.querySelector(".source-image-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(removeImage).toHaveBeenCalledWith(view);
      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Cleanup", () => {
    it("clears inputs on hide", async () => {
      emitStateChange({
        isOpen: true,
        imageSrc: "test.png",
        imageAlt: "Test",
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const srcInput = document.querySelector(".source-image-popup-src") as HTMLInputElement;
      const altInput = document.querySelector(".source-image-popup-alt") as HTMLInputElement;
      expect(srcInput.value).toBe("test.png");
      expect(altInput.value).toBe("Test");

      emitStateChange({ isOpen: false, anchorRect: null });

      expect(srcInput.value).toBe("");
      expect(altInput.value).toBe("");
    });

    it("removes container on destroy", async () => {
      emitStateChange({ isOpen: true, imageSrc: "test.png", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      expect(document.querySelector(".source-image-popup")).not.toBeNull();

      popup.destroy();

      expect(document.querySelector(".source-image-popup")).toBeNull();
    });
  });
});
