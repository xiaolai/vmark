/**
 * Tests for WysiwygPopupView base class.
 *
 * Uses a concrete subclass to test the abstract base class behavior:
 * store subscription, show/hide lifecycle, positioning, click-outside,
 * keyboard handling, scroll handling, Tab navigation, and destroy cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AnchorRect } from "@/utils/popupPosition";

vi.mock("@/utils/popupPosition", () => ({
  calculatePopupPosition: () => ({ top: 100, left: 200 }),
  getBoundaryRects: () => ({
    horizontal: { left: 0, right: 800 },
    vertical: { top: 0, bottom: 600 },
  }),
  getViewportBounds: () => ({
    horizontal: { left: 0, right: 800 },
    vertical: { top: 0, bottom: 600 },
  }),
}));

vi.mock("@/utils/popupComponents", () => ({
  handlePopupTabNavigation: vi.fn(),
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: vi.fn(() => false),
}));

vi.mock("@/plugins/sourcePopup", () => ({
  getPopupHostForDom: () => null,
  toHostCoordsForDom: (_host: HTMLElement, pos: { top: number; left: number }) => pos,
}));

import { WysiwygPopupView } from "./WysiwygPopupView";
import type { PopupStoreBase, StoreApi, EditorViewLike } from "./types";

// Concrete test subclass
interface TestState extends PopupStoreBase {
  text: string;
}

class TestPopupView extends WysiwygPopupView<TestState> {
  showCalled = false;
  hideCalled = false;

  protected buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "test-popup";

    const input = document.createElement("input");
    input.type = "text";
    container.appendChild(input);

    const btn = document.createElement("button");
    btn.textContent = "Action";
    container.appendChild(btn);

    return container;
  }

  protected onShow(_state: TestState): void {
    this.showCalled = true;
  }

  protected onHide(): void {
    this.hideCalled = true;
  }
}

function createMockView(): EditorViewLike {
  const dom = document.createElement("div");
  dom.className = "cm-editor";
  document.body.appendChild(dom);

  return {
    dom,
    state: {} as never,
    dispatch: vi.fn(),
    focus: vi.fn(),
  };
}

function createMockStore(): {
  store: StoreApi<TestState>;
  emit: (state: Partial<TestState>) => void;
  state: TestState;
} {
  const listeners: Array<(state: TestState) => void> = [];
  const mockClosePopup = vi.fn();
  let currentState: TestState = {
    isOpen: false,
    anchorRect: null,
    closePopup: mockClosePopup,
    text: "",
  };

  const store: StoreApi<TestState> = {
    getState: () => currentState,
    subscribe: (fn) => {
      listeners.push(fn);
      return () => {
        const idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };

  const emit = (partial: Partial<TestState>) => {
    currentState = { ...currentState, ...partial };
    listeners.forEach((fn) => fn(currentState));
  };

  return { store, emit, state: currentState };
}

describe("WysiwygPopupView", () => {
  let view: EditorViewLike;
  let storeApi: ReturnType<typeof createMockStore>;
  let popup: TestPopupView;
  const anchorRect: AnchorRect = { top: 100, left: 200, bottom: 120, right: 300 };

  beforeEach(() => {
    document.body.innerHTML = "";
    view = createMockView();
    storeApi = createMockStore();
    popup = new TestPopupView(view, storeApi.store);
  });

  afterEach(() => {
    popup.destroy();
  });

  describe("Construction", () => {
    it("creates hidden container", () => {
      const container = document.querySelector(".test-popup") as HTMLElement;
      // Container exists but is hidden (not appended until show)
      expect(container).toBeNull(); // Not yet in DOM
    });
  });

  describe("Show/hide lifecycle", () => {
    it("shows popup when store emits isOpen=true with anchorRect", () => {
      storeApi.emit({ isOpen: true, anchorRect });

      const container = document.querySelector(".test-popup") as HTMLElement;
      expect(container).not.toBeNull();
      expect(container.style.display).toBe("flex");
      expect(popup.showCalled).toBe(true);
    });

    it("hides popup when store emits isOpen=false", () => {
      storeApi.emit({ isOpen: true, anchorRect });
      storeApi.emit({ isOpen: false, anchorRect: null });

      const container = document.querySelector(".test-popup") as HTMLElement;
      expect(container.style.display).toBe("none");
      expect(popup.hideCalled).toBe(true);
    });

    it("does not show when anchorRect is null", () => {
      storeApi.emit({ isOpen: true, anchorRect: null });
      expect(popup.showCalled).toBe(false);
    });

    it("does not re-show when already open (wasOpen guard)", () => {
      storeApi.emit({ isOpen: true, anchorRect });
      popup.showCalled = false;

      // Emit again with isOpen=true — should not call onShow again
      storeApi.emit({ isOpen: true, anchorRect, text: "changed" });
      expect(popup.showCalled).toBe(false);
    });

    it("does not call onHide when was not open", () => {
      // Emit isOpen=false when it was never open
      storeApi.emit({ isOpen: false, anchorRect: null });
      expect(popup.hideCalled).toBe(false);
    });
  });

  describe("Click outside", () => {
    it("closes popup on click outside container", () => {
      storeApi.emit({ isOpen: true, anchorRect });

      // Clear justOpened
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 0;
      });
      storeApi.emit({ isOpen: false, anchorRect: null });
      storeApi.emit({ isOpen: true, anchorRect });

      const outsideEl = document.createElement("div");
      document.body.appendChild(outsideEl);

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outsideEl });
      document.dispatchEvent(mousedownEvent);

      expect(storeApi.store.getState().closePopup).toHaveBeenCalled();
    });

    it("does not close on click inside container", () => {
      storeApi.emit({ isOpen: true, anchorRect });

      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 0;
      });
      storeApi.emit({ isOpen: false, anchorRect: null });
      storeApi.emit({ isOpen: true, anchorRect });

      const container = document.querySelector(".test-popup") as HTMLElement;
      const closePopup = storeApi.store.getState().closePopup as ReturnType<typeof vi.fn>;
      const callCountBefore = closePopup.mock.calls.length;

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: container });
      document.dispatchEvent(mousedownEvent);

      expect(closePopup.mock.calls.length).toBe(callCountBefore);
    });

    it("does not close when justOpened is true", () => {
      const rAFCallbacks: FrameRequestCallback[] = [];
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        rAFCallbacks.push(cb);
        return rAFCallbacks.length;
      });

      storeApi.emit({ isOpen: true, anchorRect });

      const outsideEl = document.createElement("div");
      document.body.appendChild(outsideEl);

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outsideEl });
      document.dispatchEvent(mousedownEvent);

      const closePopup = storeApi.store.getState().closePopup as ReturnType<typeof vi.fn>;
      expect(closePopup).not.toHaveBeenCalled();
    });

    it("does not close when store says isOpen is false", () => {
      storeApi.emit({ isOpen: true, anchorRect });
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 0;
      });
      storeApi.emit({ isOpen: false, anchorRect: null });

      const closePopup = storeApi.store.getState().closePopup as ReturnType<typeof vi.fn>;
      closePopup.mockClear();

      const outsideEl = document.createElement("div");
      document.body.appendChild(outsideEl);

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outsideEl });
      document.dispatchEvent(mousedownEvent);

      expect(closePopup).not.toHaveBeenCalled();
    });
  });

  describe("Keyboard handling", () => {
    it("closes popup on Escape key", () => {
      storeApi.emit({ isOpen: true, anchorRect });

      const escapeEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      document.dispatchEvent(escapeEvent);

      expect(storeApi.store.getState().closePopup).toHaveBeenCalled();
      expect(view.focus).toHaveBeenCalled();
    });

    it("does not close on non-Escape key", () => {
      storeApi.emit({ isOpen: true, anchorRect });

      const closePopup = storeApi.store.getState().closePopup as ReturnType<typeof vi.fn>;
      closePopup.mockClear();

      const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      document.dispatchEvent(enterEvent);

      expect(closePopup).not.toHaveBeenCalled();
    });

    it("skips IME key events", async () => {
      const imeGuard = await import("@/utils/imeGuard");
      vi.mocked(imeGuard.isImeKeyEvent).mockReturnValue(true);

      storeApi.emit({ isOpen: true, anchorRect });

      const closePopup = storeApi.store.getState().closePopup as ReturnType<typeof vi.fn>;
      closePopup.mockClear();

      const escapeEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      document.dispatchEvent(escapeEvent);

      expect(closePopup).not.toHaveBeenCalled();

      vi.mocked(imeGuard.isImeKeyEvent).mockReturnValue(false);
    });
  });

  describe("Scroll handling", () => {
    it("closes popup on scroll", () => {
      const editorContainer = document.createElement("div");
      editorContainer.className = "editor-container";
      document.body.appendChild(editorContainer);
      editorContainer.appendChild(view.dom);

      popup.destroy();
      storeApi = createMockStore();
      popup = new TestPopupView(view, storeApi.store);

      storeApi.emit({ isOpen: true, anchorRect });

      const scrollEvent = new Event("scroll", { bubbles: true });
      editorContainer.dispatchEvent(scrollEvent);

      expect(storeApi.store.getState().closePopup).toHaveBeenCalled();
    });

    it("does not close on scroll when popup is not open", () => {
      const editorContainer = document.createElement("div");
      editorContainer.className = "editor-container";
      document.body.appendChild(editorContainer);
      editorContainer.appendChild(view.dom);

      popup.destroy();
      storeApi = createMockStore();
      popup = new TestPopupView(view, storeApi.store);

      const scrollEvent = new Event("scroll", { bubbles: true });
      editorContainer.dispatchEvent(scrollEvent);

      expect(storeApi.store.getState().closePopup).not.toHaveBeenCalled();
    });
  });

  describe("Tab navigation", () => {
    it("delegates to handlePopupTabNavigation on Tab keydown", async () => {
      const { handlePopupTabNavigation } = await import("@/utils/popupComponents");
      const mockHandler = vi.mocked(handlePopupTabNavigation);
      mockHandler.mockClear();

      storeApi.emit({ isOpen: true, anchorRect });

      const container = document.querySelector(".test-popup") as HTMLElement;
      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
      container.dispatchEvent(tabEvent);

      expect(mockHandler).toHaveBeenCalled();
    });

    it("skips tab navigation on IME key events", async () => {
      const imeGuard = await import("@/utils/imeGuard");
      vi.mocked(imeGuard.isImeKeyEvent).mockReturnValue(true);

      const { handlePopupTabNavigation } = await import("@/utils/popupComponents");
      const mockHandler = vi.mocked(handlePopupTabNavigation);
      mockHandler.mockClear();

      storeApi.emit({ isOpen: true, anchorRect });

      const container = document.querySelector(".test-popup") as HTMLElement;
      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
      container.dispatchEvent(tabEvent);

      expect(mockHandler).not.toHaveBeenCalled();

      vi.mocked(imeGuard.isImeKeyEvent).mockReturnValue(false);
    });
  });

  describe("Positioning", () => {
    it("uses fixed positioning when host is document.body and sets correct top/left", () => {
      storeApi.emit({ isOpen: true, anchorRect });

      const container = document.querySelector(".test-popup") as HTMLElement;
      expect(container.style.position).toBe("fixed");
      // The mock calculatePopupPosition returns { top: 100, left: 200 }
      expect(container.style.top).toBe("100px");
      expect(container.style.left).toBe("200px");
    });

    it("uses absolute positioning and host coords when host is a non-body element", async () => {
      const sourcePopup = await import("@/plugins/sourcePopup");
      const hostEl = document.createElement("div");
      hostEl.style.position = "relative";
      document.body.appendChild(hostEl);

      vi.spyOn(sourcePopup, "getPopupHostForDom" as never).mockReturnValue(hostEl as never);
      // toHostCoordsForDom transforms coords — our mock passes them through
      vi.spyOn(sourcePopup, "toHostCoordsForDom" as never).mockReturnValue({ top: 50, left: 75 } as never);

      popup.destroy();
      storeApi = createMockStore();
      popup = new TestPopupView(view, storeApi.store);

      storeApi.emit({ isOpen: true, anchorRect });

      const container = hostEl.querySelector(".test-popup") as HTMLElement;
      expect(container).not.toBeNull();
      expect(container.style.position).toBe("absolute");
      // Should use transformed coordinates from toHostCoordsForDom
      expect(container.style.top).toBe("50px");
      expect(container.style.left).toBe("75px");

      vi.mocked(sourcePopup.getPopupHostForDom as never).mockRestore?.();
      vi.mocked(sourcePopup.toHostCoordsForDom as never).mockRestore?.();
    });
  });

  describe("closePopup edge cases", () => {
    it("handles state without closePopup function gracefully", () => {
      const listeners: Array<(state: TestState) => void> = [];
      const brokenState: TestState = {
        isOpen: false,
        anchorRect: null,
        closePopup: "not a function" as unknown as () => void,
        text: "",
      };
      const brokenStore: StoreApi<TestState> = {
        getState: () => brokenState,
        subscribe: (fn) => {
          listeners.push(fn);
          return () => {
            const idx = listeners.indexOf(fn);
            if (idx >= 0) listeners.splice(idx, 1);
          };
        },
      };

      popup.destroy();
      popup = new TestPopupView(view, brokenStore);

      brokenState.isOpen = true;
      brokenState.anchorRect = anchorRect;
      listeners.forEach((fn) => fn(brokenState));

      // Pressing Escape should not throw even when closePopup is not a function
      const escapeEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      expect(() => document.dispatchEvent(escapeEvent)).not.toThrow();
    });
  });

  describe("Utility methods", () => {
    it("isVisible returns correct state", () => {
      const isVisible = (popup as unknown as { isVisible: () => boolean }).isVisible;
      expect(isVisible.call(popup)).toBe(false);

      storeApi.emit({ isOpen: true, anchorRect });
      expect(isVisible.call(popup)).toBe(true);

      storeApi.emit({ isOpen: false, anchorRect: null });
      expect(isVisible.call(popup)).toBe(false);
    });

    it("focusEditor calls view.focus()", () => {
      const focusEditor = (popup as unknown as { focusEditor: () => void }).focusEditor;
      focusEditor.call(popup);
      expect(view.focus).toHaveBeenCalled();
    });
  });

  describe("Subscription edge cases", () => {
    it("handles rapid open/close/open cycles correctly", () => {
      storeApi.emit({ isOpen: true, anchorRect });
      expect(popup.showCalled).toBe(true);

      popup.showCalled = false;
      popup.hideCalled = false;

      storeApi.emit({ isOpen: false, anchorRect: null });
      expect(popup.hideCalled).toBe(true);

      popup.hideCalled = false;

      storeApi.emit({ isOpen: true, anchorRect });
      expect(popup.showCalled).toBe(true);
    });

    it("does not hide twice when already closed", () => {
      // Open then close
      storeApi.emit({ isOpen: true, anchorRect });
      storeApi.emit({ isOpen: false, anchorRect: null });
      popup.hideCalled = false;

      // Close again — wasOpen is already false, should not call onHide
      storeApi.emit({ isOpen: false, anchorRect: null });
      expect(popup.hideCalled).toBe(false);
    });
  });

  describe("Reshow hook (shouldReshow)", () => {
    class ReshowPopup extends TestPopupView {
      protected shouldReshow(prev: TestState, state: TestState): boolean {
        return prev.text !== state.text;
      }
    }

    it("re-shows while open when shouldReshow returns true", () => {
      popup.destroy();
      storeApi = createMockStore();
      popup = new ReshowPopup(view, storeApi.store);

      storeApi.emit({ isOpen: true, anchorRect, text: "a" });
      expect(popup.showCalled).toBe(true);
      popup.showCalled = false;

      storeApi.emit({ isOpen: true, anchorRect, text: "b" });
      expect(popup.showCalled).toBe(true);
    });

    it("does not re-show while open when tracked state is unchanged", () => {
      popup.destroy();
      storeApi = createMockStore();
      popup = new ReshowPopup(view, storeApi.store);

      storeApi.emit({ isOpen: true, anchorRect, text: "a" });
      popup.showCalled = false;

      storeApi.emit({ isOpen: true, anchorRect, text: "a" });
      expect(popup.showCalled).toBe(false);
    });
  });

  describe("syncFromStore", () => {
    class SyncPopup extends TestPopupView {
      sync(): void {
        this.syncFromStore();
      }
    }

    it("shows popup when store is already open at sync time", () => {
      popup.destroy();
      storeApi = createMockStore();
      // Store opens before the view exists (no emit — direct state)
      const openState = {
        ...storeApi.store.getState(),
        isOpen: true,
        anchorRect,
      };
      const syncStore: StoreApi<TestState> = {
        getState: () => openState,
        subscribe: storeApi.store.subscribe,
      };

      const syncPopup = new SyncPopup(view, syncStore);
      expect(syncPopup.showCalled).toBe(false);

      syncPopup.sync();
      expect(syncPopup.showCalled).toBe(true);

      syncPopup.destroy();
      popup = new TestPopupView(view, storeApi.store);
    });

    it("is a no-op when store is closed", () => {
      popup.destroy();
      storeApi = createMockStore();
      const syncPopup = new SyncPopup(view, storeApi.store);

      syncPopup.sync();
      expect(syncPopup.showCalled).toBe(false);
      expect(syncPopup.hideCalled).toBe(false);

      syncPopup.destroy();
      popup = new TestPopupView(view, storeApi.store);
    });
  });

  describe("Destroy", () => {
    it("unsubscribes from store and removes container", () => {
      storeApi.emit({ isOpen: true, anchorRect });
      expect(document.querySelector(".test-popup")).not.toBeNull();

      popup.destroy();
      expect(document.querySelector(".test-popup")).toBeNull();
    });

    it("removes event listeners safely", () => {
      storeApi.emit({ isOpen: true, anchorRect });
      popup.destroy();

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      expect(() => document.dispatchEvent(mousedownEvent)).not.toThrow();
    });
  });

  describe("Focus on show — no focusable element (branch 7 false)", () => {
    it("does not throw when container has no focusable elements", () => {
      // Create a subclass whose container has no inputs, buttons, or tabindex elements
      class NoFocusablePopup extends WysiwygPopupView<TestState> {
        showCalled = false;
        hideCalled = false;

        protected buildContainer(): HTMLElement {
          const container = document.createElement("div");
          container.className = "no-focusable-popup";
          // Intentionally no focusable children
          return container;
        }

        protected onShow(): void { this.showCalled = true; }
        protected onHide(): void { this.hideCalled = true; }
      }

      const rAFCallbacks: FrameRequestCallback[] = [];
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        rAFCallbacks.push(cb);
        return rAFCallbacks.length;
      });

      popup.destroy();
      storeApi = createMockStore();
      const noFocusPopup = new NoFocusablePopup(view, storeApi.store);

      // Show popup — triggers requestAnimationFrame with getFirstFocusable()
      storeApi.emit({ isOpen: true, anchorRect });

      // Run all rAF callbacks — getFirstFocusable returns null, so the `if` branch is false
      expect(() => rAFCallbacks.forEach((cb) => cb(0))).not.toThrow();

      noFocusPopup.destroy();
    });
  });

  describe("updatePosition — gap and preferAbove nullish coalescing defaults (branches 17, 18)", () => {
    it("falls back to gap=6 and preferAbove=true when dimensions omit those fields", () => {
      // Create a subclass that overrides getPopupDimensions to omit gap and preferAbove
      class NoDimensionDefaults extends WysiwygPopupView<TestState> {
        showCalled = false;
        hideCalled = false;

        protected buildContainer(): HTMLElement {
          const container = document.createElement("div");
          container.className = "no-dim-popup";
          return container;
        }

        protected getPopupDimensions() {
          // Return object without gap or preferAbove to exercise the ?? fallbacks
          return { width: 300, height: 50 } as never;
        }

        protected onShow(): void { this.showCalled = true; }
        protected onHide(): void { this.hideCalled = true; }
      }

      popup.destroy();
      storeApi = createMockStore();
      const dimPopup = new NoDimensionDefaults(view, storeApi.store);

      // Showing the popup triggers updatePosition which calls calculatePopupPosition
      // with gap ?? 6 and preferAbove ?? true — branches 17 and 18 are now covered
      expect(() => storeApi.emit({ isOpen: true, anchorRect })).not.toThrow();

      dimPopup.destroy();
    });
  });
});
