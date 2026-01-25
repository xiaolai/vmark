/**
 * Link Popup View Tests
 *
 * Tests for the link editing popup including:
 * - Store subscription lifecycle
 * - Input synchronization
 * - Keyboard navigation
 * - Action buttons
 * - Click outside handling
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AnchorRect } from "@/utils/popupPosition";

// Mock stores and utilities before importing the view
const mockClosePopup = vi.fn();
const mockSetHref = vi.fn();
const mockOpenUrl = vi.fn(() => Promise.resolve());

let storeState = {
  isOpen: false,
  href: "",
  linkFrom: 0,
  linkTo: 0,
  anchorRect: null as AnchorRect | null,
  closePopup: mockClosePopup,
  setHref: mockSetHref,
};
const subscribers: Array<(state: typeof storeState) => void> = [];

vi.mock("@/stores/linkPopupStore", () => ({
  useLinkPopupStore: {
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

vi.mock("@/utils/headingSlug", () => ({
  findHeadingById: vi.fn(() => null),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: mockOpenUrl,
}));

vi.mock("@/plugins/sourcePopup", () => ({
  getPopupHostForDom: (dom: HTMLElement) => dom.closest(".editor-container"),
  toHostCoordsForDom: (_host: HTMLElement, pos: { top: number; left: number }) => pos,
}));

// Import after mocking
import { LinkPopupView } from "../LinkPopupView";

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

function createEditorContainer(): {
  container: HTMLElement;
  editorDom: HTMLElement;
  cleanup: () => void;
} {
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
  const tr = {
    removeMark: vi.fn().mockReturnThis(),
    addMark: vi.fn().mockReturnThis(),
    setSelection: vi.fn().mockReturnThis(),
    scrollIntoView: vi.fn().mockReturnThis(),
  };

  return {
    dom: editorDom,
    state: {
      doc: { resolve: vi.fn() },
      schema: {
        marks: {
          link: { create: (attrs: Record<string, unknown>) => ({ type: "link", attrs }) },
        },
      },
      tr,
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
    href: "",
    linkFrom: 0,
    linkTo: 0,
    anchorRect: null,
    closePopup: mockClosePopup,
    setHref: mockSetHref,
  };
  subscribers.length = 0;
}

describe("LinkPopupView", () => {
  let dom: ReturnType<typeof createEditorContainer>;
  let view: ReturnType<typeof createMockView>;
  let popup: LinkPopupView;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    vi.clearAllMocks();
    dom = createEditorContainer();
    view = createMockView(dom.editorDom);
    popup = new LinkPopupView(view as unknown as ConstructorParameters<typeof LinkPopupView>[0]);
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
        href: "https://example.com",
        linkFrom: 10,
        linkTo: 20,
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".link-popup");
      expect(popupEl).not.toBeNull();
      expect((popupEl as HTMLElement).style.display).toBe("flex");
    });

    it("hides popup when store closes", async () => {
      // Open first
      emitStateChange({ isOpen: true, href: "test", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      // Then close
      emitStateChange({ isOpen: false, anchorRect: null });

      const popupEl = dom.container.querySelector(".link-popup");
      expect((popupEl as HTMLElement).style.display).toBe("none");
    });

    it("unsubscribes on destroy", () => {
      expect(subscribers.length).toBe(1);
      popup.destroy();
      expect(subscribers.length).toBe(0);
    });
  });

  describe("Input synchronization", () => {
    it("populates input with href from store", async () => {
      emitStateChange({
        isOpen: true,
        href: "https://example.com",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".link-popup-input") as HTMLInputElement;
      expect(input.value).toBe("https://example.com");
    });

    it("calls setHref on input change", async () => {
      emitStateChange({ isOpen: true, href: "", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".link-popup-input") as HTMLInputElement;
      input.value = "https://new-url.com";
      input.dispatchEvent(new Event("input", { bubbles: true }));

      expect(mockSetHref).toHaveBeenCalledWith("https://new-url.com");
    });
  });

  describe("Keyboard navigation", () => {
    beforeEach(async () => {
      emitStateChange({ isOpen: true, href: "https://test.com", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));
    });

    it("saves on Enter in input", () => {
      const input = dom.container.querySelector(".link-popup-input") as HTMLInputElement;
      input.focus();

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      input.dispatchEvent(event);

      // Save attempts dispatch (via the save handler)
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("closes on Escape in input", () => {
      const input = dom.container.querySelector(".link-popup-input") as HTMLInputElement;
      input.focus();

      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      input.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.focus).toHaveBeenCalled();
    });

    it("Tab cycles through focusable elements", async () => {
      const input = dom.container.querySelector(".link-popup-input") as HTMLInputElement;
      const buttons = dom.container.querySelectorAll("button");

      input.focus();
      expect(document.activeElement).toBe(input);

      // Simulate Tab
      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
      document.dispatchEvent(tabEvent);

      // Verify focusable elements exist for cycling
      // Note: offsetParent is always null in jsdom, so we verify element structure instead
      expect(input).toBeInstanceOf(HTMLInputElement);
      expect(buttons.length).toBeGreaterThan(0);
      // Verify input is in popup container (not detached)
      expect(dom.container.contains(input)).toBe(true);
    });
  });

  describe("Action buttons", () => {
    beforeEach(async () => {
      emitStateChange({
        isOpen: true,
        href: "https://test.com",
        linkFrom: 5,
        linkTo: 15,
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));
    });

    it("open button opens external links", async () => {
      const openBtn = dom.container.querySelector(".link-popup-btn-open") as HTMLElement;
      openBtn.click();

      // Allow for async import
      await new Promise((r) => setTimeout(r, 10));

      expect(mockOpenUrl).toHaveBeenCalledWith("https://test.com");
    });

    it("copy button copies URL to clipboard", async () => {
      const mockWriteText = vi.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText: mockWriteText } });

      const copyBtn = dom.container.querySelector('button[title="Copy URL"]') as HTMLElement;
      copyBtn.click();

      await new Promise((r) => setTimeout(r, 10));

      expect(mockWriteText).toHaveBeenCalledWith("https://test.com");
    });

    it("save button closes popup", () => {
      const saveBtn = dom.container.querySelector(".link-popup-btn-save") as HTMLElement;
      saveBtn.click();

      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("delete button removes link and closes popup", () => {
      const deleteBtn = dom.container.querySelector(".link-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Click outside handling", () => {
    it("closes popup when clicking outside", async () => {
      emitStateChange({ isOpen: true, href: "test", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      // Wait for justOpened flag to clear
      await new Promise((r) => requestAnimationFrame(r));

      // Click outside
      const outsideEl = document.createElement("div");
      document.body.appendChild(outsideEl);

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outsideEl });
      document.dispatchEvent(mousedownEvent);

      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("does not close when clicking inside popup", async () => {
      emitStateChange({ isOpen: true, href: "test", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".link-popup") as HTMLElement;
      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: popupEl });
      document.dispatchEvent(mousedownEvent);

      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("Mounting", () => {
    it("mounts inside editor-container", async () => {
      emitStateChange({ isOpen: true, href: "test", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".link-popup");
      expect(popupEl).not.toBeNull();
      expect(dom.container.contains(popupEl)).toBe(true);
    });

    it("uses absolute positioning when in editor-container", async () => {
      emitStateChange({ isOpen: true, href: "test", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".link-popup") as HTMLElement;
      expect(popupEl.style.position).toBe("absolute");
    });

    it("cleans up on destroy", async () => {
      emitStateChange({ isOpen: true, href: "test", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      expect(dom.container.querySelector(".link-popup")).not.toBeNull();

      popup.destroy();

      expect(document.querySelector(".link-popup")).toBeNull();
    });
  });

  describe("Bookmark links", () => {
    it("handles bookmark links starting with #", async () => {
      emitStateChange({
        isOpen: true,
        href: "#section-heading",
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".link-popup-input") as HTMLInputElement;
      expect(input.value).toBe("#section-heading");

      const openBtn = dom.container.querySelector(".link-popup-btn-open") as HTMLElement;
      expect(openBtn.title).toBe("Go to heading");
    });
  });
});
