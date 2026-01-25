/**
 * Footnote Popup View Tests
 *
 * Tests for the footnote editing popup including:
 * - Store subscription lifecycle
 * - Textarea auto-resize
 * - Goto button visibility
 * - Mouse leave handling
 * - Editing mode state
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createMockRect } from "@/test/popupTestUtils";

// Mock stores and utilities before importing the view
const mockClosePopup = vi.fn();
const mockSetContent = vi.fn();

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

vi.mock("@/utils/popupComponents", () => ({
  handlePopupTabNavigation: vi.fn(),
}));

vi.mock("@/plugins/sourcePopup", () => ({
  getPopupHostForDom: (dom: HTMLElement) => dom.closest(".editor-container"),
  toHostCoordsForDom: (_host: HTMLElement, pos: { top: number; left: number }) => pos,
}));

vi.mock("../tiptapDomUtils", () => ({
  scrollToPosition: vi.fn(),
}));

vi.mock("../footnotePopupDom", () => ({
  AUTOFOCUS_DELAY_MS: 50,
  BLUR_CHECK_DELAY_MS: 50,
  DEFAULT_POPUP_HEIGHT: 100,
  DEFAULT_POPUP_WIDTH: 280,
  POPUP_GAP_PX: 6,
  TEXTAREA_MAX_HEIGHT: 200,
  createFootnotePopupDom: vi.fn(({ onInputChange, onInputKeydown, onTextareaClick, onTextareaBlur, onGoto, onSave, onDelete }) => {
    const container = document.createElement("div");
    container.className = "footnote-popup";

    const textarea = document.createElement("textarea");
    textarea.className = "footnote-popup-textarea";
    textarea.addEventListener("input", () => onInputChange());
    textarea.addEventListener("keydown", onInputKeydown);
    textarea.addEventListener("click", onTextareaClick);
    textarea.addEventListener("blur", onTextareaBlur);

    const gotoBtn = document.createElement("button");
    gotoBtn.className = "footnote-popup-btn-goto";
    gotoBtn.addEventListener("click", onGoto);

    const saveBtn = document.createElement("button");
    saveBtn.className = "footnote-popup-btn-save";
    saveBtn.addEventListener("click", onSave);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "footnote-popup-btn-delete";
    deleteBtn.addEventListener("click", onDelete);

    container.appendChild(textarea);
    container.appendChild(gotoBtn);
    container.appendChild(saveBtn);
    container.appendChild(deleteBtn);

    return { container: container as HTMLDivElement, textarea };
  }),
}));

// Import after mocking
import { FootnotePopupView } from "../FootnotePopupView";

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
          type: { name: "footnote_definition" },
          attrs: { label: "1" },
          nodeSize: 10,
        })),
      },
      schema: {
        text: vi.fn((content: string) => ({ type: "text", content })),
        nodes: {
          paragraph: { create: vi.fn((_, content) => ({ type: "paragraph", content })) },
        },
      },
      tr: {
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
    label: "",
    content: "",
    anchorRect: null,
    definitionPos: null,
    referencePos: null,
    autoFocus: false,
    closePopup: mockClosePopup,
    setContent: mockSetContent,
  };
  subscribers.length = 0;
}

describe("FootnotePopupView", () => {
  let dom: ReturnType<typeof createEditorContainer>;
  let view: ReturnType<typeof createMockView>;
  let popup: FootnotePopupView;
  const anchorRect = createMockRect({ top: 200, left: 150, bottom: 220, right: 250 });

  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    vi.clearAllMocks();
    dom = createEditorContainer();
    view = createMockView(dom.editorDom);
    popup = new FootnotePopupView(view as unknown as ConstructorParameters<typeof FootnotePopupView>[0]);
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
        label: "1",
        content: "Footnote text",
        anchorRect,
        definitionPos: 500,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".footnote-popup");
      expect(popupEl).not.toBeNull();
      expect((popupEl as HTMLElement).style.display).toBe("flex");
    });

    it("hides popup when store closes", async () => {
      emitStateChange({ isOpen: true, label: "1", content: "Test", anchorRect, definitionPos: 100 });
      await new Promise((r) => requestAnimationFrame(r));

      emitStateChange({ isOpen: false, anchorRect: null });

      const popupEl = dom.container.querySelector(".footnote-popup");
      expect((popupEl as HTMLElement).style.display).toBe("none");
    });

    it("unsubscribes on destroy", () => {
      expect(subscribers.length).toBe(1);
      popup.destroy();
      expect(subscribers.length).toBe(0);
    });
  });

  describe("Input synchronization", () => {
    it("populates textarea with content from store", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "This is a footnote",
        anchorRect,
        definitionPos: 500,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const textarea = dom.container.querySelector(".footnote-popup-textarea") as HTMLTextAreaElement;
      expect(textarea.value).toBe("This is a footnote");
    });

    it("calls setContent on input change", async () => {
      emitStateChange({ isOpen: true, label: "1", content: "", anchorRect, definitionPos: 100 });
      await new Promise((r) => requestAnimationFrame(r));

      const textarea = dom.container.querySelector(".footnote-popup-textarea") as HTMLTextAreaElement;
      textarea.value = "New content";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      expect(mockSetContent).toHaveBeenCalledWith("New content");
    });
  });

  describe("Goto button visibility", () => {
    it("shows goto button when definitionPos exists", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const gotoBtn = dom.container.querySelector(".footnote-popup-btn-goto") as HTMLElement;
      expect(gotoBtn.style.display).toBe("flex");
    });

    it("hides goto button when definitionPos is null", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: null,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const gotoBtn = dom.container.querySelector(".footnote-popup-btn-goto") as HTMLElement;
      expect(gotoBtn.style.display).toBe("none");
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
      const textarea = dom.container.querySelector(".footnote-popup-textarea") as HTMLTextAreaElement;
      textarea.focus();

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      textarea.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("closes on Escape", () => {
      const textarea = dom.container.querySelector(".footnote-popup-textarea") as HTMLTextAreaElement;
      textarea.focus();

      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      textarea.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.focus).toHaveBeenCalled();
    });
  });

  describe("Mouse leave handling", () => {
    it("closes popup on mouse leave when not editing", async () => {
      emitStateChange({ isOpen: true, label: "1", content: "Test", anchorRect, definitionPos: 100 });
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".footnote-popup") as HTMLElement;
      const leaveEvent = new MouseEvent("mouseleave", { bubbles: true });
      popupEl.dispatchEvent(leaveEvent);

      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("does not close on mouse leave when editing", async () => {
      emitStateChange({ isOpen: true, label: "1", content: "Test", anchorRect, definitionPos: 100 });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".footnote-popup") as HTMLElement;
      popupEl.classList.add("editing");

      const leaveEvent = new MouseEvent("mouseleave", { bubbles: true });
      popupEl.dispatchEvent(leaveEvent);

      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("AutoFocus", () => {
    it("adds editing class when autoFocus is true", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "",
        anchorRect,
        definitionPos: 500,
        autoFocus: true,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".footnote-popup") as HTMLElement;
      expect(popupEl.classList.contains("editing")).toBe(true);
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

    it("save button closes popup", () => {
      const saveBtn = dom.container.querySelector(".footnote-popup-btn-save") as HTMLElement;
      saveBtn.click();

      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("delete button closes popup", () => {
      const deleteBtn = dom.container.querySelector(".footnote-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Mounting", () => {
    it("mounts inside editor-container", async () => {
      emitStateChange({ isOpen: true, label: "1", content: "Test", anchorRect, definitionPos: 100 });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".footnote-popup");
      expect(popupEl).not.toBeNull();
      expect(dom.container.contains(popupEl)).toBe(true);
    });

    it("cleans up on destroy", async () => {
      emitStateChange({ isOpen: true, label: "1", content: "Test", anchorRect, definitionPos: 100 });
      await new Promise((r) => requestAnimationFrame(r));

      expect(dom.container.querySelector(".footnote-popup")).not.toBeNull();

      popup.destroy();

      expect(document.querySelector(".footnote-popup")).toBeNull();
    });
  });
});
