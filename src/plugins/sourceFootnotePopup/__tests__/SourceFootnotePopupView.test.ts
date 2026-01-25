/**
 * Source Footnote Popup View Tests
 *
 * Tests for the source mode footnote popup including:
 * - Store subscription lifecycle
 * - Textarea auto-resize
 * - Goto button visibility
 * - Keyboard shortcuts
 * - Action buttons
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";

// Mock stores and utilities
const mockClosePopup = vi.fn();
const mockSetContent = vi.fn();
const mockOpenPopup = vi.fn();

let storeState = {
  isOpen: false,
  label: "",
  content: "",
  anchorRect: null as DOMRect | null,
  definitionPos: null as number | null,
  referencePos: null as number | null,
  autoFocus: false,
  closePopup: mockClosePopup,
  setContent: mockSetContent,
  openPopup: mockOpenPopup,
};
const subscribers: Array<(state: typeof storeState) => void> = [];

vi.mock("@/stores/footnotePopupStore", () => ({
  useFootnotePopupStore: {
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
  popupIcons: { open: "<svg></svg>", copy: "<svg></svg>", save: "<svg></svg>", delete: "<svg></svg>", close: "<svg></svg>", folder: "<svg></svg>", goto: "<svg></svg>", toggle: "<svg></svg>", link: "<svg></svg>", image: "<svg></svg>", blockImage: "<svg></svg>", inlineImage: "<svg></svg>", type: "<svg></svg>" },
  handlePopupTabNavigation: vi.fn(),
}));

vi.mock("../sourceFootnoteActions", () => ({
  saveFootnoteContent: vi.fn(),
  gotoFootnoteTarget: vi.fn(),
  removeFootnote: vi.fn(),
}));

// Import after mocking
import { SourceFootnotePopupView } from "../SourceFootnotePopupView";
import { saveFootnoteContent, gotoFootnoteTarget, removeFootnote } from "../sourceFootnoteActions";

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
    label: "",
    content: "",
    anchorRect: null,
    definitionPos: null,
    referencePos: null,
    autoFocus: false,
    closePopup: mockClosePopup,
    setContent: mockSetContent,
    openPopup: mockOpenPopup,
  };
  subscribers.length = 0;
}

describe("SourceFootnotePopupView", () => {
  let view: EditorView;
  let popup: SourceFootnotePopupView;
  const anchorRect = createMockRect({ top: 200, left: 150, bottom: 220, right: 250 });

  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    vi.clearAllMocks();
    view = createMockView();
    popup = new SourceFootnotePopupView(
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
        label: "1",
        content: "Footnote text",
        anchorRect,
        definitionPos: 500,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = document.querySelector(".source-footnote-popup");
      expect(popupEl).not.toBeNull();
      expect((popupEl as HTMLElement).style.display).toBe("flex");
    });

    it("hides popup when store closes", async () => {
      emitStateChange({ isOpen: true, label: "1", content: "Test", anchorRect, definitionPos: 100 });
      await new Promise((r) => requestAnimationFrame(r));

      emitStateChange({ isOpen: false, anchorRect: null });

      const popupEl = document.querySelector(".source-footnote-popup");
      expect((popupEl as HTMLElement).style.display).toBe("none");
    });

    it("unsubscribes on destroy", () => {
      expect(subscribers.length).toBe(1);
      popup.destroy();
      expect(subscribers.length).toBe(0);
    });
  });

  describe("Input synchronization", () => {
    it("populates label display with label from store", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test content",
        anchorRect,
        definitionPos: 500,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const labelSpan = document.querySelector(".source-footnote-popup-label") as HTMLSpanElement;
      expect(labelSpan.textContent).toBe("[^1]");
    });

    it("populates textarea with content from store", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "This is a footnote",
        anchorRect,
        definitionPos: 500,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const textarea = document.querySelector(".source-footnote-popup-textarea") as HTMLTextAreaElement;
      expect(textarea.value).toBe("This is a footnote");
    });

    it("calls setContent on textarea input", async () => {
      emitStateChange({ isOpen: true, label: "1", content: "", anchorRect, definitionPos: 100 });
      await new Promise((r) => requestAnimationFrame(r));

      const textarea = document.querySelector(".source-footnote-popup-textarea") as HTMLTextAreaElement;
      textarea.value = "New content";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      expect(mockSetContent).toHaveBeenCalledWith("New content");
    });
  });

  describe("Goto button visibility", () => {
    it("shows goto button when definitionPos exists (opened on reference)", async () => {
      popup.setOpenedOnReference(true);
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const gotoBtn = document.querySelector(".source-footnote-popup-btn-goto") as HTMLElement;
      expect(gotoBtn.style.display).toBe("flex");
      expect(gotoBtn.title).toBe("Go to definition");
    });

    it("hides goto button when definitionPos is null", async () => {
      popup.setOpenedOnReference(true);
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: null,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const gotoBtn = document.querySelector(".source-footnote-popup-btn-goto") as HTMLElement;
      expect(gotoBtn.style.display).toBe("none");
    });

    it("shows goto button with reference title when opened on definition", async () => {
      popup.setOpenedOnReference(false);
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        referencePos: 50,
        definitionPos: null,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const gotoBtn = document.querySelector(".source-footnote-popup-btn-goto") as HTMLElement;
      expect(gotoBtn.style.display).toBe("flex");
      expect(gotoBtn.title).toBe("Go to reference");
    });
  });

  describe("Keyboard shortcuts", () => {
    beforeEach(async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test content",
        anchorRect,
        definitionPos: 500,
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));
    });

    it("saves on Enter (without Shift)", () => {
      const textarea = document.querySelector(".source-footnote-popup-textarea") as HTMLTextAreaElement;
      textarea.focus();

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      textarea.dispatchEvent(event);

      expect(saveFootnoteContent).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("allows newline with Shift+Enter", () => {
      const textarea = document.querySelector(".source-footnote-popup-textarea") as HTMLTextAreaElement;
      textarea.focus();

      const event = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true });
      const prevented = !textarea.dispatchEvent(event);

      // Shift+Enter should NOT prevent default (allows newline)
      expect(prevented).toBe(false);
      expect(saveFootnoteContent).not.toHaveBeenCalled();
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
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));
    });

    it("save button saves and closes popup", () => {
      const saveBtn = document.querySelector(".source-footnote-popup-btn-save") as HTMLElement;
      saveBtn.click();

      expect(saveFootnoteContent).toHaveBeenCalledWith(view);
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("goto button navigates and closes popup", () => {
      const gotoBtn = document.querySelector(".source-footnote-popup-btn-goto") as HTMLElement;
      gotoBtn.click();

      expect(gotoFootnoteTarget).toHaveBeenCalledWith(view, true);
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("delete button removes footnote and closes popup", () => {
      const deleteBtn = document.querySelector(".source-footnote-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(removeFootnote).toHaveBeenCalledWith(view);
      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Cleanup", () => {
    it("clears textarea and label on hide", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test content",
        anchorRect,
        definitionPos: 500,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const textarea = document.querySelector(".source-footnote-popup-textarea") as HTMLTextAreaElement;
      const labelSpan = document.querySelector(".source-footnote-popup-label") as HTMLSpanElement;
      expect(textarea.value).toBe("Test content");
      expect(labelSpan.textContent).toBe("[^1]");

      emitStateChange({ isOpen: false, anchorRect: null });

      expect(textarea.value).toBe("");
      expect(labelSpan.textContent).toBe("");
    });

    it("removes container on destroy", async () => {
      emitStateChange({ isOpen: true, label: "1", content: "Test", anchorRect, definitionPos: 100 });
      await new Promise((r) => requestAnimationFrame(r));

      expect(document.querySelector(".source-footnote-popup")).not.toBeNull();

      popup.destroy();

      expect(document.querySelector(".source-footnote-popup")).toBeNull();
    });
  });
});
