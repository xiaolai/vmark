/**
 * Source Wiki Link Popup View Tests
 *
 * Tests for the source mode wiki link popup including:
 * - Store subscription lifecycle
 * - Input synchronization
 * - Open button state
 * - Keyboard shortcuts
 * - Action buttons
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import type { AnchorRect } from "@/utils/popupPosition";

// Mock stores and utilities
const mockClosePopup = vi.fn();
const mockUpdateTarget = vi.fn();
const mockOpenPopup = vi.fn();

let storeState = {
  isOpen: false,
  target: "",
  nodePos: null as number | null,
  anchorRect: null as AnchorRect | null,
  closePopup: mockClosePopup,
  updateTarget: mockUpdateTarget,
  openPopup: mockOpenPopup,
};
const subscribers: Array<(state: typeof storeState) => void> = [];

vi.mock("@/stores/wikiLinkPopupStore", () => ({
  useWikiLinkPopupStore: {
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

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({ rootPath: "/workspace" }),
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

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("../sourceWikiLinkActions", () => ({
  openWikiLink: vi.fn(),
  copyWikiLinkTarget: vi.fn(),
  removeWikiLink: vi.fn(),
  saveWikiLinkChanges: vi.fn(),
}));

// Import after mocking
import { SourceWikiLinkPopupView } from "../SourceWikiLinkPopupView";
import { openWikiLink, copyWikiLinkTarget, removeWikiLink, saveWikiLinkChanges } from "../sourceWikiLinkActions";

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
    target: "",
    nodePos: null,
    anchorRect: null,
    closePopup: mockClosePopup,
    updateTarget: mockUpdateTarget,
    openPopup: mockOpenPopup,
  };
  subscribers.length = 0;
}

describe("SourceWikiLinkPopupView", () => {
  let view: EditorView;
  let popup: SourceWikiLinkPopupView;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    vi.clearAllMocks();
    view = createMockView();
    popup = new SourceWikiLinkPopupView(
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
        target: "MyPage",
        nodePos: 10,
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = document.querySelector(".source-wiki-link-popup");
      expect(popupEl).not.toBeNull();
      expect((popupEl as HTMLElement).style.display).toBe("flex");
    });

    it("hides popup when store closes", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      emitStateChange({ isOpen: false, anchorRect: null });

      const popupEl = document.querySelector(".source-wiki-link-popup");
      expect((popupEl as HTMLElement).style.display).toBe("none");
    });

    it("unsubscribes on destroy", () => {
      expect(subscribers.length).toBe(1);
      popup.destroy();
      expect(subscribers.length).toBe(0);
    });
  });

  describe("Input synchronization", () => {
    it("populates input with target from store", async () => {
      emitStateChange({
        isOpen: true,
        target: "docs/readme",
        nodePos: 5,
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const input = document.querySelector(".source-wiki-link-popup-target") as HTMLInputElement;
      expect(input.value).toBe("docs/readme");
    });

    it("calls updateTarget on input change", async () => {
      emitStateChange({ isOpen: true, target: "", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = document.querySelector(".source-wiki-link-popup-target") as HTMLInputElement;
      input.value = "NewPage";
      input.dispatchEvent(new Event("input", { bubbles: true }));

      expect(mockUpdateTarget).toHaveBeenCalledWith("NewPage");
    });
  });

  describe("Open button state", () => {
    it("disables open button when target is empty", async () => {
      emitStateChange({
        isOpen: true,
        target: "",
        nodePos: 10,
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const openBtn = document.querySelector(".source-wiki-link-popup-btn-open") as HTMLButtonElement;
      expect(openBtn.disabled).toBe(true);
      expect(openBtn.style.opacity).toBe("0.4");
    });

    it("enables open button when target has value", async () => {
      emitStateChange({
        isOpen: true,
        target: "SomePage",
        nodePos: 10,
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const openBtn = document.querySelector(".source-wiki-link-popup-btn-open") as HTMLButtonElement;
      expect(openBtn.disabled).toBe(false);
      expect(openBtn.style.opacity).toBe("1");
    });

    it("updates open button state on input change", async () => {
      emitStateChange({
        isOpen: true,
        target: "",
        nodePos: 10,
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const input = document.querySelector(".source-wiki-link-popup-target") as HTMLInputElement;
      const openBtn = document.querySelector(".source-wiki-link-popup-btn-open") as HTMLButtonElement;

      expect(openBtn.disabled).toBe(true);

      input.value = "NewPage";
      input.dispatchEvent(new Event("input", { bubbles: true }));

      expect(openBtn.disabled).toBe(false);
    });
  });

  describe("Keyboard shortcuts", () => {
    beforeEach(async () => {
      emitStateChange({
        isOpen: true,
        target: "TestPage",
        nodePos: 10,
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));
    });

    it("saves on Enter", () => {
      const input = document.querySelector(".source-wiki-link-popup-target") as HTMLInputElement;
      input.focus();

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      input.dispatchEvent(event);

      expect(saveWikiLinkChanges).toHaveBeenCalled();
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
        target: "TestPage",
        nodePos: 10,
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));
    });

    it("open button calls openWikiLink", () => {
      const openBtn = document.querySelector(".source-wiki-link-popup-btn-open") as HTMLElement;
      openBtn.click();

      expect(openWikiLink).toHaveBeenCalled();
    });

    it("copy button calls copyWikiLinkTarget", () => {
      const copyBtn = document.querySelector('button[title="Copy target"]') as HTMLElement;
      copyBtn.click();

      expect(copyWikiLinkTarget).toHaveBeenCalled();
    });

    it("delete button removes wiki link and closes popup", () => {
      const deleteBtn = document.querySelector(".source-wiki-link-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(removeWikiLink).toHaveBeenCalledWith(view);
      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Empty target handling", () => {
    it("removes wiki link when saving empty target", async () => {
      emitStateChange({
        isOpen: true,
        target: "",
        nodePos: 10,
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const input = document.querySelector(".source-wiki-link-popup-target") as HTMLInputElement;
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      input.dispatchEvent(event);

      expect(removeWikiLink).toHaveBeenCalledWith(view);
    });
  });

  describe("Cleanup", () => {
    it("clears input on hide", async () => {
      emitStateChange({
        isOpen: true,
        target: "TestPage",
        nodePos: 10,
        anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const input = document.querySelector(".source-wiki-link-popup-target") as HTMLInputElement;
      expect(input.value).toBe("TestPage");

      emitStateChange({ isOpen: false, anchorRect: null });

      expect(input.value).toBe("");
    });

    it("removes container on destroy", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      expect(document.querySelector(".source-wiki-link-popup")).not.toBeNull();

      popup.destroy();

      expect(document.querySelector(".source-wiki-link-popup")).toBeNull();
    });
  });
});
