/**
 * Spell Check Popup View Tests
 *
 * Tests for the spell check suggestions popup including:
 * - Store subscription lifecycle
 * - Suggestions list rendering
 * - Replace action
 * - Add to dictionary action
 * - Click outside handling
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Mock stores and utilities before importing the view
const mockClosePopup = vi.fn();
const mockAddToIgnored = vi.fn();

let storeState = {
  isPopupOpen: false,
  popupPosition: null as { top: number; left: number } | null,
  currentWord: null as { text: string; from: number; to: number } | null,
  suggestions: [] as string[],
  closePopup: mockClosePopup,
  addToIgnored: mockAddToIgnored,
};
const subscribers: Array<(state: typeof storeState) => void> = [];

vi.mock("@/stores/spellCheckStore", () => ({
  useSpellCheckStore: {
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
  runOrQueueProseMirrorAction: vi.fn((_, fn) => fn()),
}));

vi.mock("@/plugins/sourcePopup", () => ({
  getPopupHostForDom: (dom: HTMLElement) => dom.closest(".editor-container"),
  toHostCoordsForDom: (_host: HTMLElement, pos: { top: number; left: number }) => pos,
}));

// Import after mocking
import { SpellCheckPopupView } from "../SpellCheckPopupView";

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
      schema: {
        text: vi.fn((content: string) => ({ type: "text", content })),
      },
      tr: {
        replaceWith: vi.fn().mockReturnThis(),
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
    isPopupOpen: false,
    popupPosition: null,
    currentWord: null,
    suggestions: [],
    closePopup: mockClosePopup,
    addToIgnored: mockAddToIgnored,
  };
  subscribers.length = 0;
}

describe("SpellCheckPopupView", () => {
  let dom: ReturnType<typeof createEditorContainer>;
  let view: ReturnType<typeof createMockView>;
  let popup: SpellCheckPopupView;

  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    vi.clearAllMocks();
    dom = createEditorContainer();
    view = createMockView(dom.editorDom);
    popup = new SpellCheckPopupView(view as unknown as ConstructorParameters<typeof SpellCheckPopupView>[0]);
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
        isPopupOpen: true,
        popupPosition: { top: 200, left: 150 },
        currentWord: { text: "tset", from: 10, to: 14 },
        suggestions: ["test", "set"],
      });

      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".spell-check-popup");
      expect(popupEl).not.toBeNull();
      expect((popupEl as HTMLElement).style.display).toBe("block");
    });

    it("hides popup when store closes", async () => {
      emitStateChange({
        isPopupOpen: true,
        popupPosition: { top: 200, left: 150 },
        currentWord: { text: "tset", from: 10, to: 14 },
        suggestions: ["test"],
      });
      await new Promise((r) => requestAnimationFrame(r));

      emitStateChange({ isPopupOpen: false, popupPosition: null, currentWord: null });

      const popupEl = dom.container.querySelector(".spell-check-popup");
      expect((popupEl as HTMLElement).style.display).toBe("none");
    });

    it("unsubscribes on destroy", () => {
      expect(subscribers.length).toBe(1);
      popup.destroy();
      expect(subscribers.length).toBe(0);
    });
  });

  describe("Suggestions rendering", () => {
    it("renders suggestion items", async () => {
      emitStateChange({
        isPopupOpen: true,
        popupPosition: { top: 200, left: 150 },
        currentWord: { text: "tset", from: 10, to: 14 },
        suggestions: ["test", "set", "best"],
      });

      await new Promise((r) => requestAnimationFrame(r));

      const suggestions = dom.container.querySelectorAll(".spell-check-popup-suggestion");
      expect(suggestions.length).toBe(3);
      expect(suggestions[0].textContent).toBe("test");
      expect(suggestions[1].textContent).toBe("set");
      expect(suggestions[2].textContent).toBe("best");
    });

    it("shows 'No suggestions' when list is empty", async () => {
      emitStateChange({
        isPopupOpen: true,
        popupPosition: { top: 200, left: 150 },
        currentWord: { text: "xyzzy", from: 10, to: 15 },
        suggestions: [],
      });

      await new Promise((r) => requestAnimationFrame(r));

      const emptyMsg = dom.container.querySelector(".spell-check-popup-empty");
      expect(emptyMsg).not.toBeNull();
      expect(emptyMsg?.textContent).toBe("No suggestions");
    });

    it("shows Add to Dictionary action", async () => {
      emitStateChange({
        isPopupOpen: true,
        popupPosition: { top: 200, left: 150 },
        currentWord: { text: "customword", from: 10, to: 20 },
        suggestions: [],
      });

      await new Promise((r) => requestAnimationFrame(r));

      const addAction = dom.container.querySelector(".spell-check-popup-action");
      expect(addAction).not.toBeNull();
      expect(addAction?.textContent).toBe("Add to Dictionary");
    });
  });

  describe("Replace action", () => {
    it("replaces word and closes popup when suggestion clicked", async () => {
      emitStateChange({
        isPopupOpen: true,
        popupPosition: { top: 200, left: 150 },
        currentWord: { text: "tset", from: 10, to: 14 },
        suggestions: ["test", "set"],
      });

      await new Promise((r) => requestAnimationFrame(r));

      const suggestions = dom.container.querySelectorAll(".spell-check-popup-suggestion");
      (suggestions[0] as HTMLElement).click();

      expect(view.dispatch).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Add to Dictionary action", () => {
    it("adds word to ignored list and closes popup", async () => {
      emitStateChange({
        isPopupOpen: true,
        popupPosition: { top: 200, left: 150 },
        currentWord: { text: "customword", from: 10, to: 20 },
        suggestions: [],
      });

      await new Promise((r) => requestAnimationFrame(r));

      const addAction = dom.container.querySelector(".spell-check-popup-action") as HTMLElement;
      addAction.click();

      expect(mockAddToIgnored).toHaveBeenCalledWith("customword");
      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Click outside handling", () => {
    it("closes popup when clicking outside", async () => {
      emitStateChange({
        isPopupOpen: true,
        popupPosition: { top: 200, left: 150 },
        currentWord: { text: "tset", from: 10, to: 14 },
        suggestions: ["test"],
      });

      await new Promise((r) => requestAnimationFrame(r));

      const outsideEl = document.createElement("div");
      document.body.appendChild(outsideEl);

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outsideEl });
      document.dispatchEvent(mousedownEvent);

      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("does not close when clicking inside popup", async () => {
      emitStateChange({
        isPopupOpen: true,
        popupPosition: { top: 200, left: 150 },
        currentWord: { text: "tset", from: 10, to: 14 },
        suggestions: ["test"],
      });

      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".spell-check-popup") as HTMLElement;
      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: popupEl });
      document.dispatchEvent(mousedownEvent);

      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("Mounting", () => {
    it("mounts inside editor-container", async () => {
      emitStateChange({
        isPopupOpen: true,
        popupPosition: { top: 200, left: 150 },
        currentWord: { text: "tset", from: 10, to: 14 },
        suggestions: ["test"],
      });

      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".spell-check-popup");
      expect(popupEl).not.toBeNull();
      expect(dom.container.contains(popupEl)).toBe(true);
    });

    it("cleans up on destroy", async () => {
      emitStateChange({
        isPopupOpen: true,
        popupPosition: { top: 200, left: 150 },
        currentWord: { text: "tset", from: 10, to: 14 },
        suggestions: ["test"],
      });

      await new Promise((r) => requestAnimationFrame(r));

      expect(dom.container.querySelector(".spell-check-popup")).not.toBeNull();

      popup.destroy();

      expect(document.querySelector(".spell-check-popup")).toBeNull();
    });
  });
});
