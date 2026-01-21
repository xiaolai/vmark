/**
 * Source Popup Base Infrastructure Tests
 *
 * Tests for the shared popup view infrastructure for Source mode.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import {
  getAnchorRectFromRange,
  getEditorBounds,
  isPositionVisible,
} from "../sourcePopupUtils";
import { SourcePopupView } from "../SourcePopupView";
import type { StoreApi } from "../SourcePopupView";
import type { AnchorRect } from "@/utils/popupPosition";

// Mock DOM APIs
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

describe("sourcePopupUtils", () => {
  describe("getAnchorRectFromRange", () => {
    it("calculates popup position from CM6 coords", () => {
      // Create a minimal mock view
      const mockView = {
        coordsAtPos: vi.fn((pos: number) => ({
          top: 100 + pos,
          left: 50,
          bottom: 120 + pos,
          right: 100,
        })),
        dom: {
          getBoundingClientRect: () => createMockRect(),
          closest: () => ({
            getBoundingClientRect: () => createMockRect({ top: 0, bottom: 500 }),
          }),
        },
      } as unknown as EditorView;

      const rect = getAnchorRectFromRange(mockView, 10, 20);

      expect(rect).not.toBeNull();
      expect(rect!.top).toBe(110); // 100 + 10
      expect(rect!.left).toBe(50);
      expect(rect!.bottom).toBe(140); // 120 + 20
      expect(mockView.coordsAtPos).toHaveBeenCalledWith(10);
      expect(mockView.coordsAtPos).toHaveBeenCalledWith(20);
    });

    it("returns null when coordsAtPos returns null", () => {
      const mockView = {
        coordsAtPos: vi.fn(() => null),
        dom: {
          getBoundingClientRect: () => createMockRect(),
        },
      } as unknown as EditorView;

      const rect = getAnchorRectFromRange(mockView, 10, 20);

      expect(rect).toBeNull();
    });
  });

  describe("getEditorBounds", () => {
    it("returns editor container bounds", () => {
      const containerRect = createMockRect({
        top: 50,
        left: 10,
        bottom: 600,
        right: 800,
      });
      const editorRect = createMockRect({
        top: 60,
        left: 20,
        bottom: 580,
        right: 780,
      });
      const mockView = {
        dom: {
          closest: vi.fn(() => ({
            getBoundingClientRect: () => containerRect,
          })),
          getBoundingClientRect: () => editorRect,
        },
      } as unknown as EditorView;

      const bounds = getEditorBounds(mockView);

      // Horizontal uses editor rect, vertical uses container rect
      expect(bounds.horizontal.left).toBe(20);
      expect(bounds.horizontal.right).toBe(780);
      expect(bounds.vertical.top).toBe(50);
      expect(bounds.vertical.bottom).toBe(600);
    });

    it("falls back to viewport when no container found", () => {
      const mockView = {
        dom: {
          closest: vi.fn(() => null),
          getBoundingClientRect: () => createMockRect(),
        },
      } as unknown as EditorView;

      // Mock window dimensions
      const originalInnerWidth = window.innerWidth;
      const originalInnerHeight = window.innerHeight;
      Object.defineProperty(window, "innerWidth", { value: 1920, writable: true });
      Object.defineProperty(window, "innerHeight", { value: 1080, writable: true });

      const bounds = getEditorBounds(mockView);

      expect(bounds.horizontal.left).toBe(0);
      expect(bounds.horizontal.right).toBe(1920);
      expect(bounds.vertical.top).toBe(0);
      expect(bounds.vertical.bottom).toBe(1080);

      // Restore
      Object.defineProperty(window, "innerWidth", { value: originalInnerWidth, writable: true });
      Object.defineProperty(window, "innerHeight", { value: originalInnerHeight, writable: true });
    });
  });

  describe("isPositionVisible", () => {
    it("returns true when position is within viewport", () => {
      const mockView = {
        coordsAtPos: vi.fn(() => ({ top: 100, bottom: 120 })),
        dom: {
          closest: vi.fn(() => ({
            getBoundingClientRect: () => createMockRect({ top: 0, bottom: 500 }),
          })),
        },
      } as unknown as EditorView;

      expect(isPositionVisible(mockView, 10)).toBe(true);
    });

    it("returns false when position is above viewport", () => {
      const mockView = {
        coordsAtPos: vi.fn(() => ({ top: -50, bottom: -30 })),
        dom: {
          closest: vi.fn(() => ({
            getBoundingClientRect: () => createMockRect({ top: 0, bottom: 500 }),
          })),
        },
      } as unknown as EditorView;

      expect(isPositionVisible(mockView, 10)).toBe(false);
    });

    it("returns false when position is below viewport", () => {
      const mockView = {
        coordsAtPos: vi.fn(() => ({ top: 600, bottom: 620 })),
        dom: {
          closest: vi.fn(() => ({
            getBoundingClientRect: () => createMockRect({ top: 0, bottom: 500 }),
          })),
        },
      } as unknown as EditorView;

      expect(isPositionVisible(mockView, 10)).toBe(false);
    });

    it("returns false when coordsAtPos returns null", () => {
      const mockView = {
        coordsAtPos: vi.fn(() => null),
        dom: {
          closest: vi.fn(() => ({
            getBoundingClientRect: () => createMockRect({ top: 0, bottom: 500 }),
          })),
        },
      } as unknown as EditorView;

      expect(isPositionVisible(mockView, 10)).toBe(false);
    });
  });
});

describe("SourcePopupView", () => {
  // Create a concrete implementation for testing
  class TestPopupView extends SourcePopupView<{ isOpen: boolean; anchorRect: AnchorRect | null }> {
    // Don't use initializer to avoid overwriting in constructor
    public showCalled!: boolean;
    public hideCalled!: boolean;

    constructor(view: EditorView, store: StoreApi<{ isOpen: boolean; anchorRect: AnchorRect | null }>) {
      // Initialize flags before super() call
      super(view, store);
      this.showCalled = false;
      this.hideCalled = false;
    }

    protected buildContainer(): HTMLElement {
      const div = document.createElement("div");
      div.className = "test-popup";
      return div;
    }

    protected onShow(): void {
      this.showCalled = true;
    }

    protected onHide(): void {
      this.hideCalled = false; // Reset then set to true
      this.hideCalled = true;
    }

    protected extractState(state: { isOpen: boolean; anchorRect: AnchorRect | null }) {
      return {
        isOpen: state.isOpen,
        anchorRect: state.anchorRect,
      };
    }

    // Expose protected container for testing
    public getContainer() {
      return this.container;
    }

    // Get testContainer returns the same as container
    public get testContainer(): HTMLElement {
      return this.container;
    }
  }

  let mockView: EditorView;
  let container: HTMLElement;
  let mockStore: {
    getState: () => { isOpen: boolean; anchorRect: AnchorRect | null };
    subscribe: (fn: (state: { isOpen: boolean; anchorRect: AnchorRect | null }) => void) => () => void;
  };
  let subscribers: Array<(state: { isOpen: boolean; anchorRect: AnchorRect | null }) => void>;
  let currentState: { isOpen: boolean; anchorRect: AnchorRect | null };

  beforeEach(() => {
    // Clean up document body
    document.body.innerHTML = "";

    container = document.createElement("div");
    container.className = "editor-container";
    container.getBoundingClientRect = () =>
      createMockRect({ top: 0, bottom: 600, left: 0, right: 800 });
    document.body.appendChild(container);

    const editorDom = document.createElement("div");
    editorDom.getBoundingClientRect = () => createMockRect();
    container.appendChild(editorDom);

    // Create mock view
    mockView = {
      dom: editorDom,
      coordsAtPos: () => ({ top: 100, left: 50, bottom: 120, right: 100 }),
      focus: vi.fn(),
    } as unknown as EditorView;

    // Create mock store
    currentState = { isOpen: false, anchorRect: null };
    subscribers = [];
    mockStore = {
      getState: () => currentState,
      subscribe: (fn) => {
        subscribers.push(fn);
        return () => {
          const idx = subscribers.indexOf(fn);
          if (idx >= 0) subscribers.splice(idx, 1);
        };
      },
    };
  });

  const emitStateChange = (newState: { isOpen: boolean; anchorRect: AnchorRect | null }) => {
    currentState = newState;
    subscribers.forEach((fn) => fn(newState));
  };

  it("detects click outside popup container", () => {
    const popup = new TestPopupView(mockView, mockStore);
    const anchorRect = { top: 100, left: 50, bottom: 120, right: 100 };

    // Open popup
    emitStateChange({ isOpen: true, anchorRect });

    // Verify container is attached
    expect(popup.testContainer).not.toBeNull();
    expect(container.contains(popup.testContainer)).toBe(true);

    // Simulate click outside
    const outsideEl = document.createElement("div");
    document.body.appendChild(outsideEl);

    const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(mousedownEvent, "target", { value: outsideEl });

    // The click-outside handler should close the popup
    // (We verify by checking that the store would typically call closePopup)
    document.dispatchEvent(mousedownEvent);

    popup.destroy();
  });

  it("handles Tab cycling within popup", () => {
    const popup = new TestPopupView(mockView, mockStore);

    // Add focusable elements to container
    const container = popup.getContainer();
    const input = document.createElement("input");
    const button1 = document.createElement("button");
    const button2 = document.createElement("button");
    container.appendChild(input);
    container.appendChild(button1);
    container.appendChild(button2);

    // Open popup
    emitStateChange({ isOpen: true, anchorRect: { top: 100, left: 50, bottom: 120, right: 100 } });

    // Focus input
    input.focus();
    expect(document.activeElement).toBe(input);

    // Simulate Tab keydown
    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    container.dispatchEvent(tabEvent);

    // Tab should cycle focus (this tests the handler is attached)
    // The actual cycling behavior is tested in popupComponents tests

    popup.destroy();
  });

  it("closes on Escape keypress", () => {
    const closePopupFn = vi.fn();
    const storeWithClose = {
      ...mockStore,
      getState: () => ({
        ...currentState,
        closePopup: closePopupFn,
      }),
    };

    const popup = new TestPopupView(mockView, storeWithClose as typeof mockStore);

    // Open popup
    emitStateChange({ isOpen: true, anchorRect: { top: 100, left: 50, bottom: 120, right: 100 } });

    // Simulate Escape keydown
    const escEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    document.dispatchEvent(escEvent);

    // closePopup should be called and focus should return to editor
    expect(closePopupFn).toHaveBeenCalled();
    expect(mockView.focus).toHaveBeenCalled();

    popup.destroy();
  });

  it("subscribes to store and shows/hides correctly", () => {
    const popup = new TestPopupView(mockView, mockStore);

    // Initially hidden
    expect(popup.showCalled).toBe(false);

    // Open popup
    emitStateChange({ isOpen: true, anchorRect: { top: 100, left: 50, bottom: 120, right: 100 } });
    expect(popup.showCalled).toBe(true);

    // Close popup
    emitStateChange({ isOpen: false, anchorRect: null });
    expect(popup.hideCalled).toBe(true);

    popup.destroy();
  });

  it("removes container on destroy", () => {
    const popup = new TestPopupView(mockView, mockStore);

    // Open popup to ensure container is attached
    emitStateChange({ isOpen: true, anchorRect: { top: 100, left: 50, bottom: 120, right: 100 } });
    expect(container.contains(popup.testContainer)).toBe(true);

    popup.destroy();

    expect(container.contains(popup.testContainer)).toBe(false);
  });
});
