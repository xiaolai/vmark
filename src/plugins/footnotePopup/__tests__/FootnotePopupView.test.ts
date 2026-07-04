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
  popupIcons: { open: "<svg></svg>", copy: "<svg></svg>", save: "<svg></svg>", delete: "<svg></svg>", close: "<svg></svg>", folder: "<svg></svg>", goto: "<svg></svg>", toggle: "<svg></svg>", link: "<svg></svg>", image: "<svg></svg>", blockImage: "<svg></svg>", inlineImage: "<svg></svg>", type: "<svg></svg>" },
  handlePopupTabNavigation: vi.fn(),
}));

vi.mock("@/plugins/sourcePopup", () => ({
  getPopupHostForDom: (dom: HTMLElement) => dom.closest(".editor-container"),
  toHostCoordsForDom: (_host: HTMLElement, pos: { top: number; left: number }) => pos,
}));

vi.mock("../tiptapDomUtils", () => ({
  scrollToPosition: vi.fn(),
}));

// The real parser needs a real schema; the view tests use a mock schema,
// so return an empty parsed doc (normalization then builds an empty paragraph).
vi.mock("@/utils/markdownPipeline", () => ({
  parseMarkdown: vi.fn(() => ({ forEach: (_cb: (child: unknown) => void) => {} })),
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

  describe("Save logic", () => {
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

    it("save with null definitionPos just closes", () => {
      emitStateChange({ definitionPos: null });
      const saveBtn = dom.container.querySelector(".footnote-popup-btn-save") as HTMLElement;
      saveBtn.click();
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("goto navigates to definition position", () => {
      const gotoBtn = dom.container.querySelector(".footnote-popup-btn-goto") as HTMLElement;
      gotoBtn.click();
      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Delete logic", () => {
    it("delete with null referencePos just closes", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
        referencePos: null,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = dom.container.querySelector(".footnote-popup-btn-delete") as HTMLElement;
      deleteBtn.click();
      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Textarea click behavior", () => {
    it("adds editing class and focuses on textarea click", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const textarea = dom.container.querySelector(".footnote-popup-textarea") as HTMLTextAreaElement;
      textarea.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const popupEl = dom.container.querySelector(".footnote-popup") as HTMLElement;
      expect(popupEl.classList.contains("editing")).toBe(true);
    });
  });

  describe("Textarea blur behavior", () => {
    it("removes editing class when focus leaves popup", async () => {
      vi.useFakeTimers();
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
      });
      await vi.advanceTimersByTimeAsync(0); // rAF

      const popupEl = dom.container.querySelector(".footnote-popup") as HTMLElement;
      popupEl.classList.add("editing");

      const textarea = dom.container.querySelector(".footnote-popup-textarea") as HTMLTextAreaElement;
      textarea.dispatchEvent(new Event("blur", { bubbles: true }));

      vi.advanceTimersByTime(60); // past BLUR_CHECK_DELAY_MS

      expect(popupEl.classList.contains("editing")).toBe(false);
      vi.useRealTimers();
    });
  });

  describe("Shift+Enter in textarea", () => {
    it("does not save on Shift+Enter (allows newline)", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const textarea = dom.container.querySelector(".footnote-popup-textarea") as HTMLTextAreaElement;
      const event = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true });
      textarea.dispatchEvent(event);

      // Shift+Enter should NOT trigger save/close
      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("Click outside behavior", () => {
    it("does not close immediately after opening (justOpened guard)", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
      });

      // Click outside immediately (before rAF clears justOpened)
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(mockClosePopup).not.toHaveBeenCalled();
    });

    it("does not close when clicking inside popup", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
      });
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".footnote-popup") as HTMLElement;
      popupEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      expect(mockClosePopup).not.toHaveBeenCalled();
    });

    it("closes on click outside after popup is settled", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
      });
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Scroll behavior", () => {
    it("closes popup on scroll in editor container", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
      });
      await new Promise((r) => requestAnimationFrame(r));

      dom.container.dispatchEvent(new Event("scroll", { bubbles: true }));
      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Label change re-show", () => {
    it("re-shows popup when label changes", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Footnote 1",
        anchorRect,
        definitionPos: 500,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const textarea = dom.container.querySelector(".footnote-popup-textarea") as HTMLTextAreaElement;
      expect(textarea.value).toBe("Footnote 1");

      emitStateChange({
        label: "2",
        content: "Footnote 2",
      });
      await new Promise((r) => requestAnimationFrame(r));

      expect(textarea.value).toBe("Footnote 2");
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

  describe("Save logic - edge cases", () => {
    it("save with node type mismatch closes without dispatch", async () => {
      view.state.doc.nodeAt = vi.fn(() => ({
        type: { name: "paragraph" },
        attrs: { label: "1" },
        nodeSize: 10,
      }));
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const saveBtn = dom.container.querySelector(".footnote-popup-btn-save") as HTMLElement;
      saveBtn.click();

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.dispatch).not.toHaveBeenCalled();
    });

    it("save with label mismatch closes without dispatch", async () => {
      view.state.doc.nodeAt = vi.fn(() => ({
        type: { name: "footnote_definition" },
        attrs: { label: "99" }, // Different from store label "1"
        nodeSize: 10,
      }));
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const saveBtn = dom.container.querySelector(".footnote-popup-btn-save") as HTMLElement;
      saveBtn.click();

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.dispatch).not.toHaveBeenCalled();
    });

    it("save with null nodeAt closes without dispatch", async () => {
      view.state.doc.nodeAt = vi.fn(() => null);
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const saveBtn = dom.container.querySelector(".footnote-popup-btn-save") as HTMLElement;
      saveBtn.click();

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.dispatch).not.toHaveBeenCalled();
    });

    it("save failure keeps the popup open (user's edit is not lost)", async () => {
      view.state.doc.nodeAt = vi.fn(() => ({
        type: { name: "footnote_definition" },
        attrs: { label: "1" },
        nodeSize: 10,
      }));
      view.state.tr.replaceWith = vi.fn(() => { throw new Error("mock error"); });
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const saveBtn = dom.container.querySelector(".footnote-popup-btn-save") as HTMLElement;
      saveBtn.click();

      // Error is logged but the popup stays open so the text isn't discarded
      expect(consoleSpy).toHaveBeenCalled();
      expect(mockClosePopup).not.toHaveBeenCalled();
      const popupEl = dom.container.querySelector(".footnote-popup") as HTMLElement;
      expect(popupEl.style.display).toBe("flex");
      consoleSpy.mockRestore();
    });
  });

  describe("Delete logic - edge cases", () => {
    it("delete with refNode type mismatch closes without dispatch", async () => {
      view.state.doc.nodeAt = vi.fn(() => ({
        type: { name: "paragraph" },
        attrs: {},
        nodeSize: 5,
      }));
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = dom.container.querySelector(".footnote-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.dispatch).not.toHaveBeenCalled();
    });

    it("delete with null refNode closes without dispatch", async () => {
      view.state.doc.nodeAt = vi.fn(() => null);
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = dom.container.querySelector(".footnote-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.dispatch).not.toHaveBeenCalled();
    });

    it("delete with definition before reference handles both deletions", async () => {
      // nodeAt returns different nodes based on position
      view.state.doc.nodeAt = vi.fn((pos: number) => {
        if (pos === 10) return { type: { name: "footnote_reference" }, attrs: { label: "1" }, nodeSize: 3 };
        if (pos === 5) return { type: { name: "footnote_definition" }, attrs: { label: "1" }, nodeSize: 10 };
        return null;
      });
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 5, // before referencePos
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = dom.container.querySelector(".footnote-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(view.dispatch).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("delete with definition after reference handles both deletions", async () => {
      view.state.doc.nodeAt = vi.fn((pos: number) => {
        if (pos === 10) return { type: { name: "footnote_reference" }, attrs: { label: "1" }, nodeSize: 3 };
        if (pos === 500) return { type: { name: "footnote_definition" }, attrs: { label: "1" }, nodeSize: 10 };
        return null;
      });
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500, // after referencePos
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = dom.container.querySelector(".footnote-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(view.dispatch).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("delete with definition node not found only deletes reference", async () => {
      view.state.doc.nodeAt = vi.fn((pos: number) => {
        if (pos === 10) return { type: { name: "footnote_reference" }, attrs: { label: "1" }, nodeSize: 3 };
        if (pos === 500) return null; // definition not found
        return null;
      });
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = dom.container.querySelector(".footnote-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(view.dispatch).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("delete with defNode wrong type only deletes reference", async () => {
      view.state.doc.nodeAt = vi.fn((pos: number) => {
        if (pos === 10) return { type: { name: "footnote_reference" }, attrs: { label: "1" }, nodeSize: 3 };
        if (pos === 500) return { type: { name: "paragraph" }, attrs: {}, nodeSize: 5 };
        return null;
      });
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = dom.container.querySelector(".footnote-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(view.dispatch).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("delete with null definitionPos only deletes reference", async () => {
      view.state.doc.nodeAt = vi.fn(() => ({
        type: { name: "footnote_reference" },
        attrs: { label: "1" },
        nodeSize: 3,
      }));
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: null,
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = dom.container.querySelector(".footnote-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(view.dispatch).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("delete with stale reference label deletes only the matching definition", async () => {
      // The doc changed since the popup captured referencePos: the node at
      // referencePos is a footnote_reference, but for a DIFFERENT label.
      view.state.doc.nodeAt = vi.fn((pos: number) => {
        if (pos === 10) return { type: { name: "footnote_reference" }, attrs: { label: "2" }, nodeSize: 3 };
        if (pos === 500) return { type: { name: "footnote_definition" }, attrs: { label: "1" }, nodeSize: 10 };
        return null;
      });
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = dom.container.querySelector(".footnote-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      // Only the verified definition is deleted — never the mismatched reference
      expect(view.state.tr.delete).toHaveBeenCalledTimes(1);
      expect(view.state.tr.delete).toHaveBeenCalledWith(500, 510);
      expect(view.dispatch).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("delete with stale definition label deletes only the matching reference", async () => {
      view.state.doc.nodeAt = vi.fn((pos: number) => {
        if (pos === 10) return { type: { name: "footnote_reference" }, attrs: { label: "1" }, nodeSize: 3 };
        if (pos === 500) return { type: { name: "footnote_definition" }, attrs: { label: "9" }, nodeSize: 10 };
        return null;
      });
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = dom.container.querySelector(".footnote-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(view.state.tr.delete).toHaveBeenCalledTimes(1);
      expect(view.state.tr.delete).toHaveBeenCalledWith(10, 13);
      expect(view.dispatch).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("delete with both labels mismatched closes without deleting anything", async () => {
      view.state.doc.nodeAt = vi.fn((pos: number) => {
        if (pos === 10) return { type: { name: "footnote_reference" }, attrs: { label: "2" }, nodeSize: 3 };
        if (pos === 500) return { type: { name: "footnote_definition" }, attrs: { label: "3" }, nodeSize: 10 };
        return null;
      });
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = dom.container.querySelector(".footnote-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(view.state.tr.delete).not.toHaveBeenCalled();
      expect(view.dispatch).not.toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("delete catches error and closes", async () => {
      view.state.doc.nodeAt = vi.fn(() => ({
        type: { name: "footnote_reference" },
        attrs: { label: "1" },
        nodeSize: 3,
      }));
      view.state.tr.delete = vi.fn(() => { throw new Error("delete error"); });
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: null,
        referencePos: 10,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const deleteBtn = dom.container.querySelector(".footnote-popup-btn-delete") as HTMLElement;
      deleteBtn.click();

      expect(mockClosePopup).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("Update method", () => {
    it("update repositions popup when open", async () => {
      emitStateChange({ isOpen: true, label: "1", content: "Test", anchorRect, definitionPos: 100 });
      await new Promise((r) => requestAnimationFrame(r));

      popup.update();
      // Should not throw and popup should still be visible
      const popupEl = dom.container.querySelector(".footnote-popup") as HTMLElement;
      expect(popupEl.style.display).toBe("flex");
    });

    it("update does nothing when popup is closed", () => {
      // State is closed by default
      popup.update();
      // Should not throw
    });
  });

  describe("Scroll when not open", () => {
    it("scroll does not close when popup is not open", () => {
      dom.container.dispatchEvent(new Event("scroll", { bubbles: true }));
      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("Click outside when not open", () => {
    it("click outside does not close when popup is not open", () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("Goto when null definitionPos", () => {
    it("goto does nothing when definitionPos is null", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: null,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const gotoBtn = dom.container.querySelector(".footnote-popup-btn-goto") as HTMLElement;
      gotoBtn.click();

      // Should NOT close because goto early-returns when definitionPos is null
      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("AutoFocus timeout when popup closes before focus", () => {
    it("does not focus textarea when popup closes before timeout fires", async () => {
      vi.useFakeTimers();
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
        autoFocus: true,
      });
      await vi.advanceTimersByTimeAsync(0); // rAF

      // Close popup before focus timeout fires
      emitStateChange({ isOpen: false, anchorRect: null });

      // Advance past the AUTOFOCUS_DELAY_MS (50ms in mock)
      vi.advanceTimersByTime(100);

      // Should not throw and popup should be hidden
      const popupEl = dom.container.querySelector(".footnote-popup") as HTMLElement;
      expect(popupEl.style.display).toBe("none");
      vi.useRealTimers();
    });
  });

  describe("Re-show without re-mount", () => {
    it("does not re-append container when already mounted to same host", async () => {
      emitStateChange({ isOpen: true, label: "1", content: "First", anchorRect, definitionPos: 100 });
      await new Promise((r) => requestAnimationFrame(r));

      // Trigger label change (re-show on same host)
      emitStateChange({ label: "2", content: "Second" });
      await new Promise((r) => requestAnimationFrame(r));

      // Should still be in same container
      const popupEls = dom.container.querySelectorAll(".footnote-popup");
      expect(popupEls.length).toBe(1);
    });
  });

  describe("AutoFocus re-trigger", () => {
    it("re-shows with autoFocus when autoFocus becomes true", async () => {
      emitStateChange({
        isOpen: true,
        label: "1",
        content: "Test",
        anchorRect,
        definitionPos: 500,
        autoFocus: false,
      });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".footnote-popup") as HTMLElement;
      expect(popupEl.classList.contains("editing")).toBe(false);

      // Now set autoFocus to true
      emitStateChange({ autoFocus: true });
      await new Promise((r) => requestAnimationFrame(r));

      expect(popupEl.classList.contains("editing")).toBe(true);
    });
  });

  describe("Initial state open on construction", () => {
    it("shows popup when store is already open at construction", async () => {
      // Clean up existing popup
      popup.destroy();
      dom.cleanup();

      // Set state to open before constructing
      storeState = {
        ...storeState,
        isOpen: true,
        label: "1",
        content: "Already open",
        anchorRect,
        definitionPos: 100,
      };

      dom = createEditorContainer();
      view = createMockView(dom.editorDom);
      popup = new FootnotePopupView(view as unknown as ConstructorParameters<typeof FootnotePopupView>[0]);

      await new Promise((r) => requestAnimationFrame(r));

      const textarea = dom.container.querySelector(".footnote-popup-textarea") as HTMLTextAreaElement;
      expect(textarea.value).toBe("Already open");
    });
  });
});
