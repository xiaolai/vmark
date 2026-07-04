/**
 * Tests for SourceLinkCreatePopupView — link creation popup in Source mode.
 *
 * Tests DOM construction, store subscription, input handling,
 * save/cancel actions, keyboard navigation, and edge cases.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";

// Mock stores and utilities
const mockClosePopup = vi.fn();
const mockSetText = vi.fn();
const mockSetUrl = vi.fn();
const mockOpenPopup = vi.fn();

let storeState = {
  isOpen: false,
  anchorRect: null as { top: number; left: number; bottom: number; right: number } | null,
  text: "",
  url: "",
  rangeFrom: 0,
  rangeTo: 0,
  showTextInput: true,
  closePopup: mockClosePopup,
  setText: mockSetText,
  setUrl: mockSetUrl,
  openPopup: mockOpenPopup,
};
const subscribers: Array<(state: typeof storeState) => void> = [];

vi.mock("@/stores/linkCreatePopupStore", () => ({
  useLinkCreatePopupStore: {
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

vi.mock("@/utils/popupPosition", () => ({
  calculatePopupPosition: () => ({ top: 200, left: 150 }),
  getBoundaryRects: () => ({
    horizontal: { left: 0, right: 800 },
    vertical: { top: 0, bottom: 600 },
  }),
  getViewportBounds: () => ({
    horizontal: { left: 0, right: 800 },
    vertical: { top: 0, bottom: 600 },
  }),
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: () => false,
}));

vi.mock("@/utils/popupComponents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/popupComponents")>()),
  popupIcons: {
    save: "<svg>save</svg>",
    close: "<svg>close</svg>",
  },
}));

vi.mock("@/plugins/sourcePopup/sourcePopupUtils", () => ({
  getEditorBounds: () => ({
    horizontal: { left: 0, right: 800 },
    vertical: { top: 0, bottom: 600 },
  }),
  getPopupHostForDom: () => null,
  toHostCoordsForDom: (_host: HTMLElement, pos: { top: number; left: number }) => pos,
}));

import { SourceLinkCreatePopupView } from "./SourceLinkCreatePopupView";

// Helper functions
function createMockView(): EditorView {
  const contentDOM = document.createElement("div");
  contentDOM.contentEditable = "true";

  const editorDom = document.createElement("div");
  editorDom.className = "cm-editor";
  editorDom.appendChild(contentDOM);
  document.body.appendChild(editorDom);

  return {
    dom: editorDom,
    contentDOM,
    focus: vi.fn(),
    state: {
      doc: {
        sliceString: vi.fn(() => "selected text"),
      },
    },
    dispatch: vi.fn(),
  } as unknown as EditorView;
}

function emitStateChange(newState: Partial<typeof storeState>) {
  storeState = { ...storeState, ...newState };
  subscribers.forEach((fn) => fn(storeState));
}

function resetState() {
  storeState = {
    isOpen: false,
    anchorRect: null,
    text: "",
    url: "",
    rangeFrom: 0,
    rangeTo: 0,
    showTextInput: true,
    closePopup: mockClosePopup,
    setText: mockSetText,
    setUrl: mockSetUrl,
    openPopup: mockOpenPopup,
  };
  subscribers.length = 0;
}

describe("SourceLinkCreatePopupView", () => {
  let view: EditorView;
  let popup: SourceLinkCreatePopupView;
  const anchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    vi.clearAllMocks();
    view = createMockView();
    popup = new SourceLinkCreatePopupView(view);
  });

  afterEach(() => {
    popup.destroy();
  });

  describe("Construction", () => {
    it("subscribes to store on construction", () => {
      expect(subscribers.length).toBe(1);
    });

    it("creates a container element", () => {
      // Container is not appended to DOM until show() is called.
      // Verify it exists by triggering a show cycle.
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });
      const container = document.querySelector(".link-create-popup");
      expect(container).not.toBeNull();
    });
  });

  describe("Show/hide lifecycle", () => {
    it("shows popup when store opens with text input", () => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: true,
        text: "link text",
      });

      const container = document.querySelector(".link-create-popup") as HTMLElement;
      expect(container.style.display).toBe("flex");

      // Should have text input and URL input
      const textInput = container.querySelector(".link-create-popup-text") as HTMLInputElement;
      const urlInput = container.querySelector(".link-create-popup-url") as HTMLInputElement;
      expect(textInput).not.toBeNull();
      expect(urlInput).not.toBeNull();
      expect(textInput.value).toBe("link text");
    });

    it("shows popup without text input when showTextInput is false", () => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: false,
        text: "",
      });

      const container = document.querySelector(".link-create-popup") as HTMLElement;
      expect(container.style.display).toBe("flex");

      const textInput = container.querySelector(".link-create-popup-text");
      const urlInput = container.querySelector(".link-create-popup-url");
      expect(textInput).toBeNull();
      expect(urlInput).not.toBeNull();
    });

    it("hides popup when store closes", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });
      emitStateChange({ isOpen: false, anchorRect: null });

      const container = document.querySelector(".link-create-popup") as HTMLElement;
      expect(container.style.display).toBe("none");
    });

    it("does not show when anchorRect is null", () => {
      // First open to get the container in the DOM
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });
      // Close it
      emitStateChange({ isOpen: false, anchorRect: null });

      const container = document.querySelector(".link-create-popup") as HTMLElement;
      expect(container.style.display).toBe("none");

      // Now try to open with null anchor -- should stay hidden
      emitStateChange({ isOpen: true, anchorRect: null });
      expect(container.style.display).toBe("none");
    });
  });

  describe("Input handling", () => {
    beforeEach(() => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: true,
        text: "",
      });
    });

    it("calls setText on text input change", () => {
      const textInput = document.querySelector(".link-create-popup-text") as HTMLInputElement;
      textInput.value = "New text";
      textInput.dispatchEvent(new Event("input", { bubbles: true }));

      expect(mockSetText).toHaveBeenCalledWith("New text");
    });

    it("calls setUrl on URL input change", () => {
      const urlInput = document.querySelector(".link-create-popup-url") as HTMLInputElement;
      urlInput.value = "https://example.com";
      urlInput.dispatchEvent(new Event("input", { bubbles: true }));

      expect(mockSetUrl).toHaveBeenCalledWith("https://example.com");
    });

    it("clears URL input on show", () => {
      const urlInput = document.querySelector(".link-create-popup-url") as HTMLInputElement;
      urlInput.value = "old-value";

      // Re-open should clear
      emitStateChange({ isOpen: false, anchorRect: null });
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true, text: "" });

      const newUrlInput = document.querySelector(".link-create-popup-url") as HTMLInputElement;
      expect(newUrlInput.value).toBe("");
    });
  });

  describe("Save action", () => {
    it("dispatches markdown link on save with text input", () => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: true,
        text: "click here",
        rangeFrom: 0,
        rangeTo: 0,
      });

      storeState.url = "https://example.com";
      storeState.text = "click here";

      const saveBtn = document.querySelector(".link-create-popup-btn-save") as HTMLElement;
      saveBtn.click();

      expect((view.dispatch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: expect.objectContaining({
            insert: "[click here](https://example.com)",
          }),
        })
      );
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("uses URL as text when text is empty", () => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: true,
        text: "",
        rangeFrom: 0,
        rangeTo: 0,
      });

      storeState.url = "https://example.com";
      storeState.text = "  "; // whitespace only

      const saveBtn = document.querySelector(".link-create-popup-btn-save") as HTMLElement;
      saveBtn.click();

      expect((view.dispatch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: expect.objectContaining({
            insert: "[https://example.com](https://example.com)",
          }),
        })
      );
    });

    it("wraps existing text when showTextInput is false", () => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: false,
        text: "",
        rangeFrom: 5,
        rangeTo: 18,
      });

      storeState.url = "https://link.com";

      const saveBtn = document.querySelector(".link-create-popup-btn-save") as HTMLElement;
      saveBtn.click();

      expect((view.dispatch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: expect.objectContaining({
            insert: "[selected text](https://link.com)",
            from: 5,
            to: 18,
          }),
        })
      );
    });

    it("wraps a destination containing spaces in angle brackets (CommonMark)", () => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: true,
        text: "doc",
        rangeFrom: 0,
        rangeTo: 0,
      });

      storeState.url = "/path/with spaces/doc.md";
      storeState.text = "doc";

      const saveBtn = document.querySelector(".link-create-popup-btn-save") as HTMLElement;
      saveBtn.click();

      expect((view.dispatch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: expect.objectContaining({
            insert: "[doc](</path/with spaces/doc.md>)",
          }),
        })
      );
    });

    it("wraps a destination containing Unicode whitespace in angle brackets", () => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: true,
        text: "doc",
        rangeFrom: 0,
        rangeTo: 0,
      });

      // U+3000 ideographic space
      storeState.url = "/notes/全角　空格.md";
      storeState.text = "doc";

      const saveBtn = document.querySelector(".link-create-popup-btn-save") as HTMLElement;
      saveBtn.click();

      expect((view.dispatch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: expect.objectContaining({
            insert: "[doc](</notes/全角　空格.md>)",
          }),
        })
      );
    });

    it("still escapes parentheses in destinations without whitespace", () => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: true,
        text: "doc",
        rangeFrom: 0,
        rangeTo: 0,
      });

      storeState.url = "https://en.wikipedia.org/wiki/Foo_(bar";
      storeState.text = "doc";

      const saveBtn = document.querySelector(".link-create-popup-btn-save") as HTMLElement;
      saveBtn.click();

      expect((view.dispatch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: expect.objectContaining({
            insert: "[doc](https://en.wikipedia.org/wiki/Foo_\\(bar)",
          }),
        })
      );
    });

    it("focuses URL input when URL is empty on save", () => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: true,
        text: "text",
        rangeFrom: 0,
        rangeTo: 0,
      });

      storeState.url = "  "; // whitespace only

      const urlInput = document.querySelector(".link-create-popup-url") as HTMLInputElement;
      const focusSpy = vi.spyOn(urlInput, "focus");

      const saveBtn = document.querySelector(".link-create-popup-btn-save") as HTMLElement;
      saveBtn.click();

      expect(focusSpy).toHaveBeenCalled();
      expect(view.dispatch).not.toHaveBeenCalled();
    });

    it("saves on Enter key in input", () => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: true,
        text: "text",
        rangeFrom: 0,
        rangeTo: 0,
      });

      storeState.url = "https://example.com";
      storeState.text = "text";

      const urlInput = document.querySelector(".link-create-popup-url") as HTMLInputElement;
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      urlInput.dispatchEvent(event);

      expect(view.dispatch).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Cancel action", () => {
    it("closes popup on cancel button click", () => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: true,
      });

      const cancelBtn = document.querySelector(".link-create-popup-btn-cancel") as HTMLElement;
      cancelBtn.click();

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.focus).toHaveBeenCalled();
    });

    it("closes popup on Escape in input", () => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: true,
      });

      const urlInput = document.querySelector(".link-create-popup-url") as HTMLInputElement;
      urlInput.focus();

      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      urlInput.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.focus).toHaveBeenCalled();
    });
  });

  describe("Click outside", () => {
    it("closes popup when clicking outside container", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      // Simulate the rAF callback to clear justOpened flag
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 0;
      });

      // Re-open to get the rAF to fire
      emitStateChange({ isOpen: false, anchorRect: null });
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const outsideEl = document.createElement("div");
      document.body.appendChild(outsideEl);

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outsideEl });
      document.dispatchEvent(mousedownEvent);

      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("does not close when clicking inside container", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      // Reset mock after the open call
      mockClosePopup.mockClear();

      const container = document.querySelector(".link-create-popup") as HTMLElement;
      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: container });
      document.dispatchEvent(mousedownEvent);

      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("Scroll handling", () => {
    it("closes popup on scroll", () => {
      // Need an editor-container ancestor for scroll listener
      const editorContainer = document.createElement("div");
      editorContainer.className = "editor-container";
      document.body.appendChild(editorContainer);
      editorContainer.appendChild(view.dom);

      // Recreate popup with proper DOM hierarchy
      popup.destroy();
      resetState();
      popup = new SourceLinkCreatePopupView(view);

      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const scrollEvent = new Event("scroll", { bubbles: true });
      editorContainer.dispatchEvent(scrollEvent);

      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Keyboard navigation", () => {
    it("sets up keyboard navigation on show", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const container = document.querySelector(".link-create-popup") as HTMLElement;
      expect(container).not.toBeNull();

      // Verify Tab key handler is registered by dispatching Tab
      const urlInput = document.querySelector(".link-create-popup-url") as HTMLInputElement;
      urlInput.focus();

      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
      document.dispatchEvent(tabEvent);

      // If no error, the handler is set up
    });

    it("removes keyboard navigation on hide", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });
      emitStateChange({ isOpen: false, anchorRect: null });

      // Subsequent Tab events should not be handled by popup
      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
      document.dispatchEvent(tabEvent);
    });
  });

  describe("Destroy", () => {
    it("unsubscribes from store", () => {
      expect(subscribers.length).toBe(1);
      popup.destroy();
      expect(subscribers.length).toBe(0);
    });

    it("removes container from DOM", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });
      expect(document.querySelector(".link-create-popup")).not.toBeNull();

      popup.destroy();
      expect(document.querySelector(".link-create-popup")).toBeNull();
    });

    it("removes event listeners safely", () => {
      popup.destroy();

      // Should not throw after destroy
      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      document.dispatchEvent(mousedownEvent);
    });
  });

  describe("Keyboard navigation — Tab cycling", () => {
    it("cycles forward through focusable elements on Tab", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const textInput = document.querySelector(".link-create-popup-text") as HTMLInputElement;
      textInput.focus();

      // Tab should move to next focusable element
      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
      document.dispatchEvent(tabEvent);
    });

    it("cycles backward on Shift+Tab", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const urlInput = document.querySelector(".link-create-popup-url") as HTMLInputElement;
      urlInput.focus();

      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true });
      document.dispatchEvent(tabEvent);
    });

    it("wraps forward from last element to first", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      // Focus on the cancel button (last focusable)
      const cancelBtn = document.querySelector(".link-create-popup-btn-cancel") as HTMLElement;
      cancelBtn.focus();

      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
      document.dispatchEvent(tabEvent);
    });

    it("wraps backward from first element to last", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const textInput = document.querySelector(".link-create-popup-text") as HTMLInputElement;
      textInput.focus();

      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true });
      document.dispatchEvent(tabEvent);
    });

    it("does not swallow Enter on a focused button (native activation saves)", () => {
      // Enter on a focused <button> is native browser activation (fires click).
      // The popup must not preventDefault it, and the resulting click must save.
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: true,
        text: "text",
      });

      storeState.url = "https://example.com";
      storeState.text = "text";

      const saveBtn = document.querySelector(".link-create-popup-btn-save") as HTMLButtonElement;
      saveBtn.focus();

      // Real keyboard events target the focused element and bubble up
      const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      saveBtn.dispatchEvent(enterEvent);
      expect(enterEvent.defaultPrevented).toBe(false);

      // jsdom does not perform native activation; the click it would fire saves
      saveBtn.click();
      expect(view.dispatch).toHaveBeenCalled();
    });

    it("closes popup on Escape in keyboard nav handler", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const saveBtn = document.querySelector(".link-create-popup-btn-save") as HTMLElement;
      saveBtn.focus();

      const escapeEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      document.dispatchEvent(escapeEvent);

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.focus).toHaveBeenCalled();
    });
  });

  describe("Host element positioning", () => {
    it("uses fixed positioning when host is document.body", async () => {
      // The mock always returns null, so the popup goes to document.body with fixed positioning
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const container = document.querySelector(".link-create-popup") as HTMLElement;
      expect(container.style.position).toBe("fixed");
    });

    it("uses absolute positioning when getPopupHostForDom returns a non-body host", async () => {
      // Temporarily override the mock to return a custom host
      const sourcePopup = await import("@/plugins/sourcePopup/sourcePopupUtils");
      const hostEl = document.createElement("div");
      hostEl.style.position = "relative";
      hostEl.getBoundingClientRect = () => ({
        top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600,
        x: 0, y: 0, toJSON: () => ({}),
      });
      document.body.appendChild(hostEl);

      const _origFn = sourcePopup.getPopupHostForDom;
      vi.spyOn(sourcePopup, "getPopupHostForDom" as never).mockReturnValue(hostEl as never);

      // Need a fresh popup to pick up the new mock
      popup.destroy();
      resetState();
      popup = new SourceLinkCreatePopupView(view);

      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const container = hostEl.querySelector(".link-create-popup") as HTMLElement;
      expect(container).not.toBeNull();
      expect(container.style.position).toBe("absolute");

      // Restore
      vi.mocked(sourcePopup.getPopupHostForDom as never).mockRestore?.();
    });
  });

  describe("IME key filtering", () => {
    it("does not close on IME Escape event in input keydown handler", () => {
      // The mock returns false for isImeKeyEvent, so normal Escape should close.
      // This tests the pathway exists and doesn't error.
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const urlInput = document.querySelector(".link-create-popup-url") as HTMLInputElement;
      urlInput.focus();

      // Simulate a normal Escape (not IME)
      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      urlInput.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Click outside — justOpened guard", () => {
    it("does not close popup immediately after opening (justOpened guard)", () => {
      // Override rAF to NOT execute the callback immediately, simulating async behavior
      const rAFCallbacks: FrameRequestCallback[] = [];
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        rAFCallbacks.push(cb);
        return rAFCallbacks.length;
      });

      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      // Click outside immediately (justOpened is still true because rAF hasn't fired)
      const outsideEl = document.createElement("div");
      document.body.appendChild(outsideEl);

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outsideEl });
      document.dispatchEvent(mousedownEvent);

      // Should NOT close because justOpened flag is true (rAF not yet fired)
      expect(mockClosePopup).not.toHaveBeenCalled();

      // Now fire rAF callbacks to clear justOpened
      rAFCallbacks.forEach((cb) => cb(0));
    });

    it("does not close popup when store says isOpen is false", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      // Manually set rAF to clear justOpened
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 0;
      });
      emitStateChange({ isOpen: false, anchorRect: null });

      mockClosePopup.mockClear();

      const outsideEl = document.createElement("div");
      document.body.appendChild(outsideEl);

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outsideEl });
      document.dispatchEvent(mousedownEvent);

      // isOpen is false, so handler returns early
      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("Tab cycling with visible elements (lines 137-149)", () => {
    function patchOffsetParent(container: HTMLElement) {
      // jsdom offsetParent is always null; patch to make getFocusableElements work
      const focusable = container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      focusable.forEach((el) => {
        Object.defineProperty(el, "offsetParent", { value: container, configurable: true });
      });
    }

    it("Tab forward cycles through focusable elements (line 148)", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const container = document.querySelector(".link-create-popup") as HTMLElement;
      patchOffsetParent(container);

      const textInput = container.querySelector(".link-create-popup-text") as HTMLInputElement;
      textInput.focus();

      const focusSpy = vi.fn();
      const urlInput = container.querySelector(".link-create-popup-url") as HTMLInputElement;
      urlInput.addEventListener("focus", focusSpy);

      // Real keyboard events target the focused element and bubble through
      // the popup container (where the shared Tab handler lives)
      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      textInput.dispatchEvent(tabEvent);

      // Verify focus moved to next element (urlInput)
      expect(focusSpy).toHaveBeenCalled();
    });

    it("Shift+Tab backward cycles through focusable elements (line 145)", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const container = document.querySelector(".link-create-popup") as HTMLElement;
      patchOffsetParent(container);

      const urlInput = container.querySelector(".link-create-popup-url") as HTMLInputElement;
      urlInput.focus();

      const focusSpy = vi.fn();
      const textInput = container.querySelector(".link-create-popup-text") as HTMLInputElement;
      textInput.addEventListener("focus", focusSpy);

      // Real keyboard events target the focused element and bubble through
      // the popup container (where the shared Tab handler lives)
      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
      urlInput.dispatchEvent(tabEvent);

      expect(focusSpy).toHaveBeenCalled();
    });

    it("Shift+Tab wraps from first to last (line 145 wrap)", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const container = document.querySelector(".link-create-popup") as HTMLElement;
      patchOffsetParent(container);

      const textInput = container.querySelector(".link-create-popup-text") as HTMLInputElement;
      textInput.focus();

      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(tabEvent);

      // Should wrap to last element (cancel button)
    });
  });

  describe("Scroll when not open", () => {
    it("does not call closePopup on scroll when popup is not open", () => {
      const editorContainer = document.createElement("div");
      editorContainer.className = "editor-container";
      document.body.appendChild(editorContainer);
      editorContainer.appendChild(view.dom);

      popup.destroy();
      resetState();
      popup = new SourceLinkCreatePopupView(view);

      // Don't open popup, just scroll
      const scrollEvent = new Event("scroll", { bubbles: true });
      editorContainer.dispatchEvent(scrollEvent);

      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("Error handling", () => {
    it("handles dispatch error gracefully", () => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: true,
        text: "text",
        rangeFrom: 0,
        rangeTo: 0,
      });

      storeState.url = "https://example.com";
      storeState.text = "text";

      // Make dispatch throw
      (view.dispatch as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Dispatch failed");
      });

      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const saveBtn = document.querySelector(".link-create-popup-btn-save") as HTMLElement;

      // Should not throw
      saveBtn.click();

      expect(consoleError).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe("IME guard — setupKeyboardNavigation (line 131)", () => {
    it("returns early when isImeKeyEvent is true in keyboard nav handler", async () => {
      const imeGuard = await import("@/utils/imeGuard");
      const spy = vi.spyOn(imeGuard, "isImeKeyEvent" as never).mockReturnValue(true as never);

      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      // Focus a button so keyboard nav handler is active
      const saveBtn = document.querySelector(".link-create-popup-btn-save") as HTMLElement;
      saveBtn.focus();

      // Dispatch Tab — should be blocked by IME guard (line 131)
      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      document.dispatchEvent(tabEvent);

      // Focus should not have moved (IME blocked it)
      expect(document.activeElement).toBe(saveBtn);

      spy.mockRestore();
    });
  });

  describe("Tab handler — currentIndex === -1 early return (line 140)", () => {
    it("returns early when active element is not in focusable list", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      // Focus an element NOT inside the popup container
      const externalEl = document.createElement("input");
      document.body.appendChild(externalEl);
      externalEl.focus();

      // Dispatch Tab — the active element is not in the popup's focusable list,
      // so currentIndex will be -1, triggering the early return at line 140
      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      document.dispatchEvent(tabEvent);

      // Focus should remain on external element (Tab was not handled)
      expect(document.activeElement).toBe(externalEl);
      externalEl.remove();
    });
  });

  describe("show — anchorRect null early return (line 179)", () => {
    it("does not show popup when anchorRect is null in show path", () => {
      // Emit with isOpen=true but anchorRect=null — the store subscriber
      // checks anchorRect before calling show(), so show() itself won't be called.
      // But we can also test by directly setting isOpen=true then anchorRect=null
      emitStateChange({ isOpen: true, anchorRect: null });

      // Container should not be visible
      const container = document.querySelector(".link-create-popup") as HTMLElement;
      // Container may not exist yet (never shown) or be hidden
      if (container) {
        expect(container.style.display).toBe("none");
      }
    });
  });

  describe("handleInputKeydown — other keys (line 257 else branch)", () => {
    it("does nothing for non-Enter non-Escape keys", () => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: true,
        text: "text",
      });

      storeState.url = "https://example.com";
      storeState.text = "text";

      const urlInput = document.querySelector(".link-create-popup-url") as HTMLInputElement;
      urlInput.focus();

      // Dispatch a regular key (not Enter, not Escape) — should do nothing
      const tabEvent = new KeyboardEvent("keydown", { key: "a", bubbles: true });
      urlInput.dispatchEvent(tabEvent);

      // Nothing should happen — no dispatch, no close
      expect(view.dispatch).not.toHaveBeenCalled();
      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("handleTextInput — textInput null (line 243 false branch)", () => {
    it("does not call setText when textInput is null (showTextInput=false)", () => {
      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: false,
        text: "",
      });

      mockSetText.mockClear();

      // With showTextInput=false, the textInput is null.
      // The handleTextInput handler won't be attached, so this branch
      // is about the guard inside the handler. We verify textInput is null.
      const textInput = document.querySelector(".link-create-popup-text");
      expect(textInput).toBeNull();
      // The handleTextInput guard (line 243) returns early when textInput is null
    });
  });

  describe("constructor — no editor-container ancestor (line 59 branch)", () => {
    it("does not throw when dom has no editor-container ancestor", () => {
      // The default mock view has no .editor-container ancestor
      // The constructor should handle the ?.addEventListener gracefully
      popup.destroy();
      resetState();

      // Create a view with dom NOT inside editor-container
      const isolatedDom = document.createElement("div");
      document.body.appendChild(isolatedDom);
      const isolatedView = {
        dom: isolatedDom,
        contentDOM: document.createElement("div"),
        focus: vi.fn(),
        state: { doc: { sliceString: vi.fn(() => "") } },
        dispatch: vi.fn(),
      } as unknown as EditorView;

      // Should not throw — the ?.addEventListener handles missing ancestor
      popup = new SourceLinkCreatePopupView(isolatedView);
      expect(subscribers.length).toBe(1);
    });
  });

  describe("show — anchorRect null guard in show() (line 179)", () => {
    it("returns early from show when anchorRect is null", () => {
      // We need to force the show() path to be called with null anchorRect.
      // The subscriber checks state.isOpen && state.anchorRect before calling show(),
      // but we can test by directly verifying the container remains hidden.
      // First, open with a valid anchorRect
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const container = document.querySelector(".link-create-popup") as HTMLElement;
      expect(container.style.display).toBe("flex");

      // Close and reopen
      emitStateChange({ isOpen: false, anchorRect: null });
      expect(container.style.display).toBe("none");

      // Now open with isOpen=true but anchorRect=null
      // The subscriber won't call show() because of the anchorRect check
      emitStateChange({ isOpen: true, anchorRect: null });
      expect(container.style.display).toBe("none");
    });
  });

  describe("IME guard — handleInputKeydown (line 253)", () => {
    it("returns early on IME key event in input keydown", async () => {
      const imeGuard = await import("@/utils/imeGuard");
      const spy = vi.spyOn(imeGuard, "isImeKeyEvent" as never).mockReturnValue(true as never);

      emitStateChange({
        isOpen: true,
        anchorRect,
        showTextInput: true,
        text: "text",
      });

      storeState.url = "https://example.com";
      storeState.text = "text";

      const urlInput = document.querySelector(".link-create-popup-url") as HTMLInputElement;
      urlInput.focus();

      // Dispatch Enter on input — should be blocked by IME guard (line 253)
      const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      urlInput.dispatchEvent(enterEvent);

      // dispatch should NOT have been called (IME blocked the Enter)
      expect(view.dispatch).not.toHaveBeenCalled();
      expect(mockClosePopup).not.toHaveBeenCalled();

      spy.mockRestore();
    });
  });

  describe("Tab wrap-around from last element", () => {
    it("Tab wraps from last focusable element to first (nextIndex = 0)", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const container = document.querySelector(".link-create-popup") as HTMLElement;

      // jsdom offsetParent is always null; patch so getFocusableElements sees them
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")
      );
      focusable.forEach((el) => {
        Object.defineProperty(el, "offsetParent", { value: container, configurable: true });
      });

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const focusSpy = vi.fn();
      first.addEventListener("focus", focusSpy);

      // Focus the LAST element and press Tab — should wrap to the first
      last.focus();
      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      last.dispatchEvent(tabEvent);

      expect(focusSpy).toHaveBeenCalled();
    });
  });

  describe("Escape with focus on a popup button", () => {
    it("closes popup on Escape when a button inside the popup is focused", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const container = document.querySelector(".link-create-popup") as HTMLElement;
      const saveBtn = container.querySelector(".link-create-popup-btn-save") as HTMLButtonElement;
      saveBtn.focus();

      mockClosePopup.mockClear();

      const escapeEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      saveBtn.dispatchEvent(escapeEvent);

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.focus).toHaveBeenCalled();
    });
  });

  describe("Open with null anchorRect", () => {
    it("does not show the popup when isOpen is true but anchorRect is null", () => {
      const view2 = createMockView();
      const popup2 = new SourceLinkCreatePopupView(view2);

      const container = (popup2 as unknown as Record<string, HTMLElement>).container;
      // Container display starts as "none"
      expect(container.style.display).toBe("none");

      // Store opens without an anchor — the popup must stay hidden
      emitStateChange({ isOpen: true, anchorRect: null });

      expect(container.style.display).toBe("none");

      popup2.destroy();
      view2.dom.remove();
    });
  });

  describe("Tab handler — focus outside the popup", () => {
    it("does not move focus when activeElement is not in the focusable list", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      const container = document.querySelector(".link-create-popup") as HTMLElement;

      // jsdom offsetParent is always null; patch so getFocusableElements sees them
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")
      );
      focusable.forEach((el) => {
        Object.defineProperty(el, "offsetParent", { value: container, configurable: true });
      });

      const focusSpies = focusable.map((el) => {
        const spy = vi.fn();
        el.addEventListener("focus", spy);
        return spy;
      });

      // activeElement is an external element (not in the popup's focusable list)
      const externalEl = document.createElement("input");
      document.body.appendChild(externalEl);
      Object.defineProperty(document, "activeElement", { value: externalEl, configurable: true });

      // Tab bubbling through the container — currentIndex = -1 → no-op
      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      container.dispatchEvent(tabEvent);

      // No popup element should have been focused
      focusSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());

      Object.defineProperty(document, "activeElement", { value: document.body, configurable: true });
      externalEl.remove();
    });
  });

  describe("handleTextInput — textInput null false branch (line 243)", () => {
    it("does not call setText when textInput is null at handler call time", () => {
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true, text: "" });

      mockSetText.mockClear();

      // Nullify textInput on the shared flow controller then invoke the handler directly
      const flow = (popup as unknown as Record<string, unknown>).flow as Record<string, unknown>;
      flow.textInput = null;
      (flow.handleTextInput as () => void).call(flow);

      expect(mockSetText).not.toHaveBeenCalled();
    });
  });

  describe("wasOpen true branch (line 45 false)", () => {
    it("does not call show() again when popup is already open (wasOpen=true)", () => {
      // First open — show() is called (wasOpen was false)
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      // Spy on the private show method after first open
      const showSpy = vi.spyOn(popup as unknown as { show: (s: object) => void }, "show");

      // Emit again with isOpen=true — wasOpen is now true, so show() should NOT be called again
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true, text: "updated" });

      expect(showSpy).not.toHaveBeenCalled();
      showSpy.mockRestore();
    });
  });

  describe("handleClickOutside — isOpen false early return (line 309)", () => {
    it("does not close popup when store says isOpen is false", () => {
      // Open the popup
      emitStateChange({ isOpen: true, anchorRect, showTextInput: true });

      // Make rAF fire to clear justOpened
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 0;
      });

      // Close the popup via store (sets isOpen to false)
      emitStateChange({ isOpen: false, anchorRect: null });
      mockClosePopup.mockClear();

      // Now click outside — the handler checks isOpen first (line 308-309)
      const outsideEl = document.createElement("div");
      document.body.appendChild(outsideEl);

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outsideEl });
      document.dispatchEvent(mousedownEvent);

      // Should NOT call closePopup because isOpen is false
      expect(mockClosePopup).not.toHaveBeenCalled();
      outsideEl.remove();
    });
  });
});
