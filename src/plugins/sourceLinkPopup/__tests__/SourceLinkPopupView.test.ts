/**
 * Source Link Popup View Tests
 *
 * Tests for the source mode link popup including:
 * - Store subscription lifecycle
 * - Input synchronization
 * - Bookmark link handling
 * - Keyboard shortcuts
 * - Action buttons
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import type { AnchorRect } from "@/utils/popupPosition";

// Mock stores and utilities
const mockClosePopup = vi.fn();
const mockSetHref = vi.fn();
const mockOpenPopup = vi.fn();

let storeState = {
  isOpen: false,
  href: "",
  linkFrom: 0,
  linkTo: 0,
  anchorRect: null as AnchorRect | null,
  closePopup: mockClosePopup,
  setHref: mockSetHref,
  openPopup: mockOpenPopup,
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

vi.mock("../sourceLinkActions", () => ({
  openLink: vi.fn(),
  copyLinkHref: vi.fn(),
  removeLink: vi.fn(),
  saveLinkChanges: vi.fn(),
}));

// Import after mocking
import { SourceLinkPopupView } from "../SourceLinkPopupView";
import { openLink, copyLinkHref, removeLink, saveLinkChanges } from "../sourceLinkActions";

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
    href: "",
    linkFrom: 0,
    linkTo: 0,
    anchorRect: null,
    closePopup: mockClosePopup,
    setHref: mockSetHref,
    openPopup: mockOpenPopup,
  };
  subscribers.length = 0;
}

describe("SourceLinkPopupView", () => {
  let view: EditorView;
  let popup: SourceLinkPopupView;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    vi.clearAllMocks();
    view = createMockView();
    popup = new SourceLinkPopupView(
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
        href: "https://example.com",
        linkFrom: 10,
        linkTo: 20,
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = document.querySelector(".source-link-popup");
      expect(popupEl).not.toBeNull();
      expect((popupEl as HTMLElement).style.display).toBe("flex");
    });

    it("hides popup when store closes", async () => {
      emitStateChange({ isOpen: true, href: "test", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      emitStateChange({ isOpen: false, anchorRect: null });

      const popupEl = document.querySelector(".source-link-popup");
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
        href: "https://example.com/path",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const input = document.querySelector(".source-link-popup-href") as HTMLInputElement;
      expect(input.value).toBe("https://example.com/path");
    });

    it("calls setHref on input change", async () => {
      emitStateChange({ isOpen: true, href: "", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = document.querySelector(".source-link-popup-href") as HTMLInputElement;
      input.value = "https://new-url.com";
      input.dispatchEvent(new Event("input", { bubbles: true }));

      expect(mockSetHref).toHaveBeenCalledWith("https://new-url.com");
    });
  });

  describe("Bookmark links", () => {
    it("disables input for bookmark links", async () => {
      emitStateChange({
        isOpen: true,
        href: "#heading-id",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const input = document.querySelector(".source-link-popup-href") as HTMLInputElement;
      expect(input.disabled).toBe(true);
      expect(input.classList.contains("disabled")).toBe(true);
    });

    it("changes open button title for bookmark links", async () => {
      emitStateChange({
        isOpen: true,
        href: "#heading-id",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const openBtn = document.querySelector(".source-link-popup-btn-open") as HTMLElement;
      expect(openBtn.title).toBe("Go to heading");
    });

    it("enables input for regular links", async () => {
      emitStateChange({
        isOpen: true,
        href: "https://example.com",
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const input = document.querySelector(".source-link-popup-href") as HTMLInputElement;
      expect(input.disabled).toBe(false);

      const openBtn = document.querySelector(".source-link-popup-btn-open") as HTMLElement;
      expect(openBtn.title).toBe("Open link");
    });
  });

  describe("Keyboard shortcuts", () => {
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

    it("saves on Enter", () => {
      const input = document.querySelector(".source-link-popup-href") as HTMLInputElement;
      input.focus();

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      input.dispatchEvent(event);

      expect(saveLinkChanges).toHaveBeenCalled();
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
        href: "https://test.com",
        linkFrom: 5,
        linkTo: 15,
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));
    });

    it("open button calls openLink", () => {
      const openBtn = document.querySelector(".source-link-popup-btn-open") as HTMLElement;
      openBtn.click();

      expect(openLink).toHaveBeenCalledWith(view);
    });

    it("copy button calls copyLinkHref", () => {
      const copyBtn = document.querySelector('button[title="Copy URL"]') as HTMLElement;
      copyBtn.click();

      expect(copyLinkHref).toHaveBeenCalled();
    });

    it("delete button removes link and closes popup", () => {
      const deleteBtn = document.querySelector(".source-link-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(removeLink).toHaveBeenCalledWith(view);
      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Empty URL handling", () => {
    it("removes link when saving empty URL", async () => {
      emitStateChange({
        isOpen: true,
        href: "",
        linkFrom: 5,
        linkTo: 15,
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const input = document.querySelector(".source-link-popup-href") as HTMLInputElement;
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      input.dispatchEvent(event);

      expect(removeLink).toHaveBeenCalledWith(view);
    });
  });

  describe("Cleanup", () => {
    it("removes container on destroy", async () => {
      emitStateChange({ isOpen: true, href: "test", anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      expect(document.querySelector(".source-link-popup")).not.toBeNull();

      popup.destroy();

      expect(document.querySelector(".source-link-popup")).toBeNull();
    });
  });
});
