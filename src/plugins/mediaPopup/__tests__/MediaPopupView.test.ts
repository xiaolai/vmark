/**
 * Media Popup View Tests
 *
 * Tests for the unified media editing popup including:
 * - Store subscription lifecycle
 * - justOpened guard prevents immediate close
 * - Enter-to-save behavior
 * - IME composing Enter ignored
 * - Escape close + focus editor
 * - Outside click deferred close via rAF
 * - Scroll close
 * - Pending close rAF cancelled on reopen
 * - Image-specific: alt row, toggle button, dimensions
 * - Video/audio-specific: title row, poster row
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnchorRect } from "@/utils/popupPosition";
import type { ImageDimensions } from "@/types/image";

// Mock stores and utilities before importing the view
const mockClosePopup = vi.fn();
const mockSetSrc = vi.fn();
const mockSetAlt = vi.fn();
const mockSetTitle = vi.fn();
const mockSetPoster = vi.fn();
const mockSetNodeType = vi.fn();

type MediaNodeType = "image" | "block_image" | "block_video" | "block_audio";

let storeState = {
  isOpen: false,
  mediaSrc: "",
  mediaAlt: "",
  mediaTitle: "",
  mediaNodePos: -1,
  mediaNodeType: "block_video" as MediaNodeType,
  mediaPoster: "",
  mediaDimensions: null as ImageDimensions | null,
  anchorRect: null as AnchorRect | null,
  closePopup: mockClosePopup,
  setSrc: mockSetSrc,
  setAlt: mockSetAlt,
  setTitle: mockSetTitle,
  setPoster: mockSetPoster,
  setNodeType: mockSetNodeType,
};
const subscribers: Array<(state: typeof storeState, prevState: typeof storeState) => void> = [];

vi.mock("@/stores/mediaPopupStore", () => ({
  useMediaPopupStore: {
    getState: () => storeState,
    subscribe: (fn: (state: typeof storeState, prevState: typeof storeState) => void) => {
      subscribers.push(fn);
      return () => {
        const idx = subscribers.indexOf(fn);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    },
  },
}));

let mockIsImeKeyEvent = false;
vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: () => mockIsImeKeyEvent,
}));

vi.mock("@/plugins/sourcePopup", () => ({
  getPopupHostForDom: (dom: HTMLElement) => dom.closest(".editor-container"),
  toHostCoordsForDom: (_host: HTMLElement, pos: { top: number; left: number }) => pos,
}));

vi.mock("../mediaPopupActions", () => ({
  browseAndReplaceMedia: vi.fn(() => Promise.resolve(false)),
}));

// Mock the DOM module — returns all fields the unified view expects
vi.mock("../mediaPopupDom", () => {
  const { createMockMediaPopupDom, installMockKeyboardNavigation, mockUpdateToggleButton } = (() => {
    function createMockMediaPopupDom(handlers: Record<string, unknown>) {
      void handlers.onToggle; // captured but not asserted here

      const container = document.createElement("div");
      container.className = "media-popup";
      container.style.display = "none";

      // Row 1: Source + buttons
      const row1 = document.createElement("div");
      row1.className = "media-popup-row";

      const srcInput = document.createElement("input");
      srcInput.className = "media-popup-src";
      srcInput.placeholder = "Media source path or URL...";
      srcInput.addEventListener("keydown", handlers.onInputKeydown as EventListener);

      const browseBtn = document.createElement("button");
      browseBtn.title = "Browse local file";
      browseBtn.addEventListener("click", handlers.onBrowse as EventListener);

      const copyBtn = document.createElement("button");
      copyBtn.title = "Copy path";
      copyBtn.addEventListener("click", handlers.onCopy as EventListener);

      const toggleBtn = document.createElement("button");
      toggleBtn.title = "Toggle block/inline";
      toggleBtn.className = "media-popup-btn-toggle";
      toggleBtn.addEventListener("click", handlers.onToggle as EventListener);

      const deleteBtn = document.createElement("button");
      deleteBtn.title = "Remove media";
      deleteBtn.className = "popup-icon-btn--danger";
      deleteBtn.addEventListener("click", handlers.onRemove as EventListener);

      row1.appendChild(srcInput);
      row1.appendChild(browseBtn);
      row1.appendChild(copyBtn);
      row1.appendChild(toggleBtn);
      row1.appendChild(deleteBtn);

      // Row 2a: Alt + dimensions (images)
      const altRow = document.createElement("div");
      altRow.className = "media-popup-row";

      const altInput = document.createElement("input");
      altInput.className = "media-popup-alt";
      altInput.placeholder = "Caption (alt text)...";
      altInput.addEventListener("keydown", handlers.onInputKeydown as EventListener);

      const dimensionsSpan = document.createElement("span");
      dimensionsSpan.className = "media-popup-dimensions";

      altRow.appendChild(altInput);
      altRow.appendChild(dimensionsSpan);

      // Row 2b: Title (video/audio)
      const titleRow = document.createElement("div");
      titleRow.className = "media-popup-row";

      const titleInput = document.createElement("input");
      titleInput.className = "media-popup-title";
      titleInput.placeholder = "Title (optional)...";
      titleInput.addEventListener("keydown", handlers.onInputKeydown as EventListener);
      titleRow.appendChild(titleInput);

      // Row 3: Poster (video only)
      const posterRow = document.createElement("div");
      posterRow.className = "media-popup-row";

      const posterInput = document.createElement("input");
      posterInput.className = "media-popup-poster";
      posterInput.placeholder = "Poster image (optional)...";
      posterInput.addEventListener("keydown", handlers.onInputKeydown as EventListener);
      posterRow.appendChild(posterInput);

      container.appendChild(row1);
      container.appendChild(altRow);
      container.appendChild(titleRow);
      container.appendChild(posterRow);

      return {
        container,
        srcInput,
        altRow,
        altInput,
        dimensionsSpan,
        titleRow,
        titleInput,
        posterRow,
        posterInput,
        toggleBtn,
      };
    }

    function installMockKeyboardNavigation(_container: HTMLElement, _onClose?: () => void) {
      return () => {};
    }

    function mockUpdateToggleButton(_btn: HTMLElement, _type: string) {
      // no-op for tests
    }

    return { createMockMediaPopupDom, installMockKeyboardNavigation, mockUpdateToggleButton };
  })();

  return {
    createMediaPopupDom: createMockMediaPopupDom,
    installMediaPopupKeyboardNavigation: installMockKeyboardNavigation,
    updateMediaPopupToggleButton: mockUpdateToggleButton,
  };
});

// Import after mocking
import { MediaPopupView } from "../MediaPopupView";

// Helpers
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

function createMockView(editorDom: HTMLElement, nodeType = "block_video") {
  return {
    dom: editorDom,
    state: {
      doc: {
        nodeAt: vi.fn(() => ({
          type: { name: nodeType },
          attrs: { src: "", alt: "", title: "", poster: "" },
          nodeSize: 1,
        })),
      },
      schema: {
        nodes: {
          image: { create: vi.fn((attrs) => ({ type: { name: "image" }, attrs, nodeSize: 1 })) },
          block_image: { create: vi.fn((attrs) => ({ type: { name: "block_image" }, attrs, nodeSize: 1 })) },
        },
      },
      tr: {
        setNodeMarkup: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        replaceWith: vi.fn().mockReturnThis(),
      },
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
  };
}

function emitStateChange(newState: Partial<typeof storeState>) {
  const prevState = { ...storeState };
  storeState = { ...storeState, ...newState };
  subscribers.forEach((fn) => fn(storeState, prevState));
}

function resetState() {
  storeState = {
    isOpen: false,
    mediaSrc: "",
    mediaAlt: "",
    mediaTitle: "",
    mediaNodePos: -1,
    mediaNodeType: "block_video",
    mediaPoster: "",
    mediaDimensions: null,
    anchorRect: null,
    closePopup: mockClosePopup,
    setSrc: mockSetSrc,
    setAlt: mockSetAlt,
    setTitle: mockSetTitle,
    setPoster: mockSetPoster,
    setNodeType: mockSetNodeType,
  };
  subscribers.length = 0;
  mockIsImeKeyEvent = false;
}

describe("MediaPopupView", () => {
  let dom: ReturnType<typeof createEditorContainer>;
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    vi.clearAllMocks();
    dom = createEditorContainer();
    view = createMockView(dom.editorDom);
    popup = new MediaPopupView(view as unknown as ConstructorParameters<typeof MediaPopupView>[0]);
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
        mediaSrc: "/path/to/video.mp4",
        mediaTitle: "My Video",
        mediaNodePos: 42,
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".media-popup");
      expect(popupEl).not.toBeNull();
      expect((popupEl as HTMLElement).style.display).toBe("flex");
    });

    it("hides popup when store closes", async () => {
      emitStateChange({ isOpen: true, mediaSrc: "test.mp4", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      emitStateChange({ isOpen: false, anchorRect: null });

      const popupEl = dom.container.querySelector(".media-popup");
      expect((popupEl as HTMLElement).style.display).toBe("none");
    });

    it("unsubscribes on destroy", () => {
      expect(subscribers.length).toBe(1);
      popup.destroy();
      expect(subscribers.length).toBe(0);
    });
  });

  describe("Input synchronization", () => {
    it("populates src input with mediaSrc from store", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "/videos/clip.mp4",
        mediaTitle: "",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const srcInput = dom.container.querySelector(".media-popup-src") as HTMLInputElement;
      expect(srcInput.value).toBe("/videos/clip.mp4");
    });

    it("populates title input with mediaTitle from store", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "test.mp4",
        mediaTitle: "My Video Title",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const titleInput = dom.container.querySelector(".media-popup-title") as HTMLInputElement;
      expect(titleInput.value).toBe("My Video Title");
    });

    it("populates poster input with mediaPoster from store", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "test.mp4",
        mediaPoster: "/images/poster.jpg",
        mediaNodeType: "block_video",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const posterInput = dom.container.querySelector(".media-popup-poster") as HTMLInputElement;
      expect(posterInput.value).toBe("/images/poster.jpg");
    });

    it("populates alt input with mediaAlt for image types", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "/path/to/image.png",
        mediaAlt: "Test image alt",
        mediaNodeType: "image",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const altInput = dom.container.querySelector(".media-popup-alt") as HTMLInputElement;
      expect(altInput.value).toBe("Test image alt");
    });
  });

  describe("Conditional row visibility", () => {
    it("shows alt row and hides title row for image type", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "/image.png",
        mediaAlt: "Alt text",
        mediaNodeType: "image",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const altRow = dom.container.querySelectorAll(".media-popup-row")[1] as HTMLElement;
      const titleRow = dom.container.querySelectorAll(".media-popup-row")[2] as HTMLElement;
      expect(altRow.style.display).not.toBe("none");
      expect(titleRow.style.display).toBe("none");
    });

    it("shows alt row and hides title row for block_image type", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "/image.png",
        mediaAlt: "Alt text",
        mediaNodeType: "block_image",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const altRow = dom.container.querySelectorAll(".media-popup-row")[1] as HTMLElement;
      const titleRow = dom.container.querySelectorAll(".media-popup-row")[2] as HTMLElement;
      expect(altRow.style.display).not.toBe("none");
      expect(titleRow.style.display).toBe("none");
    });

    it("shows title row and hides alt row for video type", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "test.mp4",
        mediaNodeType: "block_video",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const altRow = dom.container.querySelectorAll(".media-popup-row")[1] as HTMLElement;
      const titleRow = dom.container.querySelectorAll(".media-popup-row")[2] as HTMLElement;
      expect(altRow.style.display).toBe("none");
      expect(titleRow.style.display).not.toBe("none");
    });

    it("shows title row and hides alt row for audio type", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "test.mp3",
        mediaNodeType: "block_audio",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const altRow = dom.container.querySelectorAll(".media-popup-row")[1] as HTMLElement;
      const titleRow = dom.container.querySelectorAll(".media-popup-row")[2] as HTMLElement;
      expect(altRow.style.display).toBe("none");
      expect(titleRow.style.display).not.toBe("none");
    });

    it("shows poster row for video", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "test.mp4",
        mediaNodeType: "block_video",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const posterRow = dom.container.querySelectorAll(".media-popup-row")[3] as HTMLElement;
      expect(posterRow.style.display).not.toBe("none");
    });

    it("hides poster row for audio", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "test.mp3",
        mediaNodeType: "block_audio",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const posterRow = dom.container.querySelectorAll(".media-popup-row")[3] as HTMLElement;
      expect(posterRow.style.display).toBe("none");
    });

    it("hides poster row for image types", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "/image.png",
        mediaNodeType: "image",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const posterRow = dom.container.querySelectorAll(".media-popup-row")[3] as HTMLElement;
      expect(posterRow.style.display).toBe("none");
    });

    it("shows toggle button for image type", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "/image.png",
        mediaNodeType: "image",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const toggleBtn = dom.container.querySelector(".media-popup-btn-toggle") as HTMLElement;
      expect(toggleBtn.style.display).not.toBe("none");
    });

    it("hides toggle button for video type", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "test.mp4",
        mediaNodeType: "block_video",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const toggleBtn = dom.container.querySelector(".media-popup-btn-toggle") as HTMLElement;
      expect(toggleBtn.style.display).toBe("none");
    });

    it("hides toggle button for audio type", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "test.mp3",
        mediaNodeType: "block_audio",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const toggleBtn = dom.container.querySelector(".media-popup-btn-toggle") as HTMLElement;
      expect(toggleBtn.style.display).toBe("none");
    });
  });

  describe("Dimensions display", () => {
    it("shows dimensions for image with valid values", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "/image.png",
        mediaNodeType: "image",
        mediaDimensions: { width: 800, height: 600 },
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const dims = dom.container.querySelector(".media-popup-dimensions") as HTMLElement;
      expect(dims.textContent).toBe("800 × 600 px");
      expect(dims.style.display).not.toBe("none");
    });

    it("hides dimensions when not available", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "/image.png",
        mediaNodeType: "image",
        mediaDimensions: null,
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const dims = dom.container.querySelector(".media-popup-dimensions") as HTMLElement;
      expect(dims.style.display).toBe("none");
    });

    it("hides dimensions for non-image types", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "test.mp4",
        mediaNodeType: "block_video",
        mediaDimensions: null,
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const dims = dom.container.querySelector(".media-popup-dimensions") as HTMLElement;
      expect(dims.style.display).toBe("none");
    });
  });

  describe("justOpened guard", () => {
    it("prevents immediate close from same click event", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "test.mp4",
        mediaNodePos: 10,
        anchorRect,
      });

      // Fire outside click BEFORE rAF clears the justOpened flag
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outside });
      document.dispatchEvent(mousedownEvent);

      // Wait for potential rAF close
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      expect(mockClosePopup).not.toHaveBeenCalled();
      outside.remove();
    });
  });

  describe("Keyboard behavior", () => {
    beforeEach(async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "/test.mp4",
        mediaTitle: "Test",
        mediaNodePos: 10,
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));
      // Wait for justOpened to clear
      await new Promise((r) => requestAnimationFrame(r));
    });

    it("Escape closes popup and focuses editor", () => {
      const srcInput = dom.container.querySelector(".media-popup-src") as HTMLInputElement;
      srcInput.focus();

      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      srcInput.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.focus).toHaveBeenCalled();
    });

    it("Enter saves and closes", () => {
      const srcInput = dom.container.querySelector(".media-popup-src") as HTMLInputElement;
      srcInput.focus();
      srcInput.value = "/new-video.mp4";

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      srcInput.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("IME composing Enter does NOT save", () => {
      mockIsImeKeyEvent = true;

      const srcInput = dom.container.querySelector(".media-popup-src") as HTMLInputElement;
      srcInput.focus();

      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
      });
      srcInput.dispatchEvent(event);

      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("Click outside handling", () => {
    it("does not close when clicking inside popup", async () => {
      emitStateChange({ isOpen: true, mediaSrc: "test.mp4", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".media-popup") as HTMLElement;
      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: popupEl });
      document.dispatchEvent(mousedownEvent);

      await new Promise((r) => requestAnimationFrame(r));

      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("Scroll close", () => {
    it("closes popup on editor container scroll", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "test.mp4",
        mediaNodePos: 10,
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      dom.container.dispatchEvent(new Event("scroll", { bubbles: false }));

      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Action buttons", () => {
    beforeEach(async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "/path/video.mp4",
        mediaTitle: "Test video",
        mediaNodePos: 10,
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));
    });

    it("copy button copies src to clipboard", async () => {
      const mockWriteText = vi.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText: mockWriteText } });

      const copyBtn = dom.container.querySelector('button[title="Copy path"]') as HTMLElement;
      copyBtn.click();

      await new Promise((r) => setTimeout(r, 10));

      expect(mockWriteText).toHaveBeenCalledWith("/path/video.mp4");
    });

    it("delete button removes media node", () => {
      const deleteBtn = dom.container.querySelector('button[title="Remove media"]') as HTMLElement;
      deleteBtn.click();

      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Mounting", () => {
    it("mounts inside editor-container", async () => {
      emitStateChange({ isOpen: true, mediaSrc: "test.mp4", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".media-popup");
      expect(popupEl).not.toBeNull();
      expect(dom.container.contains(popupEl)).toBe(true);
    });

    it("uses absolute positioning when in editor-container", async () => {
      emitStateChange({ isOpen: true, mediaSrc: "test.mp4", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".media-popup") as HTMLElement;
      expect(popupEl.style.position).toBe("absolute");
    });

    it("cleans up on destroy", async () => {
      emitStateChange({ isOpen: true, mediaSrc: "test.mp4", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      expect(dom.container.querySelector(".media-popup")).not.toBeNull();

      popup.destroy();

      expect(document.querySelector(".media-popup")).toBeNull();
    });
  });

  describe("Pending close rAF cancelled on reopen", () => {
    it("cancels pending close when popup is reopened", async () => {
      emitStateChange({
        isOpen: true,
        mediaSrc: "video1.mp4",
        mediaNodePos: 10,
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      // Trigger outside click to start deferred close
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outside });
      document.dispatchEvent(mousedownEvent);

      // Before rAF fires, reopen with different media
      emitStateChange({
        isOpen: true,
        mediaSrc: "video2.mp4",
        mediaNodePos: 20,
        anchorRect: { top: 300, left: 150, bottom: 320, right: 250 },
      });

      // Wait for rAF to fire — should not close because we reopened
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      // Popup should still be visible
      const popupEl = dom.container.querySelector(".media-popup") as HTMLElement;
      expect(popupEl.style.display).toBe("flex");
      outside.remove();
    });
  });
});
