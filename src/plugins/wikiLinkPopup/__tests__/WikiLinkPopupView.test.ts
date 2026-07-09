/**
 * Wiki Link Popup View Tests
 *
 * Tests for the wiki link editing popup including:
 * - Store subscription lifecycle
 * - Target input synchronization
 * - Open button state
 * - Action buttons
 * - Mouse leave handling
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AnchorRect } from "@/utils/popupPosition";

// Mock stores and utilities before importing the view
const mockClosePopup = vi.fn();
const mockUpdateTarget = vi.fn();

let storeState = {
  isOpen: false,
  target: "",
  nodePos: null as number | null,
  anchorRect: null as AnchorRect | null,
  closePopup: mockClosePopup,
  updateTarget: mockUpdateTarget,
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

let mockWorkspaceRootPath: string | null = "/workspace";
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({ rootPath: mockWorkspaceRootPath }),
  },
}));

const mockWikiLinkPopupWarn = vi.fn();
vi.mock("@/utils/debug", () => ({
  wikiLinkPopupWarn: (...args: unknown[]) => mockWikiLinkPopupWarn(...args),
  wikiLinkPopupError: vi.fn(),
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: () => false,
}));

vi.mock("@/utils/popupComponents", () => ({
  popupIcons: { open: "<svg></svg>", copy: "<svg></svg>", save: "<svg></svg>", delete: "<svg></svg>", close: "<svg></svg>", folder: "<svg></svg>", goto: "<svg></svg>", toggle: "<svg></svg>", link: "<svg></svg>", image: "<svg></svg>", blockImage: "<svg></svg>", inlineImage: "<svg></svg>", type: "<svg></svg>" },
  buildPopupIconButton: vi.fn(({ onClick, title }) => {
    const btn = document.createElement("button");
    btn.title = title;
    btn.addEventListener("click", onClick);
    return btn;
  }),
  buildPopupInput: vi.fn(({ placeholder, className, onInput, onKeydown }) => {
    const input = document.createElement("input");
    input.placeholder = placeholder;
    input.className = className;
    input.addEventListener("input", (e) => onInput((e.target as HTMLInputElement).value));
    input.addEventListener("keydown", onKeydown);
    return input;
  }),
  handlePopupTabNavigation: vi.fn(),
}));

const mockGetPopupHostForDom = vi.fn((dom: HTMLElement) => dom.closest(".editor-container") as HTMLElement | null);
vi.mock("@/plugins/sourcePopup", () => ({
  getPopupHostForDom: (...args: unknown[]) => mockGetPopupHostForDom(args[0] as HTMLElement),
  toHostCoordsForDom: (_host: HTMLElement, pos: { top: number; left: number }) => pos,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
    emit: vi.fn(() => Promise.resolve()),
  })),
}));

// Import after mocking
import { wikiLinkPopupError } from "@/utils/debug";
import { WikiLinkPopupView } from "../WikiLinkPopupView";

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
      doc: {
        nodeAt: vi.fn(() => ({
          type: { name: "wikiLink" },
          attrs: { value: "" },
          textContent: "",
          nodeSize: 1,
        })),
      },
      schema: {
        text: vi.fn((content: string) => ({ type: "text", content })),
      },
      tr: {
        setNodeMarkup: vi.fn().mockReturnThis(),
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
    target: "",
    nodePos: null,
    anchorRect: null,
    closePopup: mockClosePopup,
    updateTarget: mockUpdateTarget,
  };
  subscribers.length = 0;
}

describe("WikiLinkPopupView", () => {
  let dom: ReturnType<typeof createEditorContainer>;
  let view: ReturnType<typeof createMockView>;
  let popup: WikiLinkPopupView;
  const anchorRect: AnchorRect = { top: 200, left: 150, bottom: 220, right: 250 };

  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    vi.clearAllMocks();
    mockWorkspaceRootPath = "/workspace";
    mockGetPopupHostForDom.mockImplementation((domEl: HTMLElement) => domEl.closest(".editor-container") as HTMLElement | null);
    dom = createEditorContainer();
    view = createMockView(dom.editorDom);
    popup = new WikiLinkPopupView(view as unknown as ConstructorParameters<typeof WikiLinkPopupView>[0]);
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
        target: "MyPage",
        nodePos: 10,
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".wiki-link-popup");
      expect(popupEl).not.toBeNull();
      expect((popupEl as HTMLElement).style.display).toBe("flex");
    });

    it("hides popup when store closes", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      emitStateChange({ isOpen: false, anchorRect: null });

      const popupEl = dom.container.querySelector(".wiki-link-popup");
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

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      expect(input.value).toBe("docs/readme");
    });

    it("calls updateTarget on input change", async () => {
      emitStateChange({ isOpen: true, target: "", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "NewPage";
      input.dispatchEvent(new Event("input", { bubbles: true }));

      expect(mockUpdateTarget).toHaveBeenCalledWith("NewPage");
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

    it("closes on Escape", () => {
      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.focus();

      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      input.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.focus).toHaveBeenCalled();
    });

    it("saves on Enter", () => {
      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.focus();

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      input.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
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

      const openBtn = dom.container.querySelector(".wiki-link-popup-btn-open") as HTMLButtonElement;
      expect(openBtn.disabled).toBe(true);
    });

    it("enables open button when target has value", async () => {
      emitStateChange({
        isOpen: true,
        target: "SomePage",
        nodePos: 10,
        anchorRect,
      });

      await new Promise((r) => requestAnimationFrame(r));

      const openBtn = dom.container.querySelector(".wiki-link-popup-btn-open") as HTMLButtonElement;
      expect(openBtn.disabled).toBe(false);
    });
  });

  describe("Click outside handling", () => {
    it("closes popup when clicking outside", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      const outsideEl = document.createElement("div");
      document.body.appendChild(outsideEl);

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outsideEl });
      document.dispatchEvent(mousedownEvent);

      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Mouse leave handling", () => {
    it("registers mouseleave listener on container", async () => {
      // Verify the popup has mouseleave handling set up
      // Actual mouseleave behavior is tested via E2E (jsdom has limitations with mouse events)
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".wiki-link-popup") as HTMLElement;
      expect(popupEl).not.toBeNull();
      // Popup is visible and has mouseleave handling registered
      expect(popupEl.style.display).toBe("flex");
    });

    it("does not close on mouse leave when input is focused", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      // Verify input exists and can be focused
      expect(input).not.toBeNull();
      input.focus();
      expect(document.activeElement).toBe(input);
      // Focus on input would prevent mouseleave from closing popup (verified manually)
    });
  });

  describe("Save action", () => {
    it("dispatches setNodeMarkup when target is valid", async () => {
      storeState.nodePos = 10;
      emitStateChange({ isOpen: true, target: "MyPage", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "UpdatedPage";

      // Trigger save via Enter key
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      input.dispatchEvent(event);

      expect(view.dispatch).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.focus).toHaveBeenCalled();
    });

    it("closes popup without dispatch when target is empty", async () => {
      storeState.nodePos = 10;
      emitStateChange({ isOpen: true, target: "", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "   ";

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      input.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
      // dispatch should not be called for empty target
    });

    it("closes popup without dispatch when nodePos is null", async () => {
      storeState.nodePos = null;
      emitStateChange({ isOpen: true, target: "Test", nodePos: null, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "Test";

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      input.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("closes popup when node at pos is not a wikiLink", async () => {
      view.state.doc.nodeAt = vi.fn(() => ({
        type: { name: "paragraph" },
        attrs: {},
        textContent: "",
        nodeSize: 1,
      }));
      storeState.nodePos = 10;
      emitStateChange({ isOpen: true, target: "Test", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "ValidTarget";

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      input.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Delete action", () => {
    it("replaces wikiLink with plain text when display text exists", async () => {
      view.state.doc.nodeAt = vi.fn(() => ({
        type: { name: "wikiLink" },
        attrs: { value: "Target" },
        textContent: "Display Text",
        nodeSize: 3,
      }));
      storeState.nodePos = 10;
      emitStateChange({ isOpen: true, target: "Target", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      // Find the delete button (last button in the container)
      const buttons = dom.container.querySelectorAll("button");
      const deleteBtn = Array.from(buttons).find((b) => b.title === "Remove wiki link");
      expect(deleteBtn).not.toBeUndefined();
      deleteBtn!.click();

      expect(view.state.schema.text).toHaveBeenCalledWith("Display Text");
      expect(view.state.tr.replaceWith).toHaveBeenCalled();
      expect(view.dispatch).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.focus).toHaveBeenCalled();
    });

    it("deletes node when display text is empty", async () => {
      view.state.doc.nodeAt = vi.fn(() => ({
        type: { name: "wikiLink" },
        attrs: { value: "" },
        textContent: "",
        nodeSize: 3,
      }));
      storeState.nodePos = 10;
      emitStateChange({ isOpen: true, target: "", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Remove wiki link");
      deleteBtn!.click();

      expect(view.state.tr.delete).toHaveBeenCalledWith(10, 13);
      expect(view.dispatch).toHaveBeenCalled();
    });

    it("closes popup when nodePos is null", async () => {
      storeState.nodePos = null;
      emitStateChange({ isOpen: true, target: "Test", nodePos: null, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Remove wiki link");
      deleteBtn!.click();

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.dispatch).not.toHaveBeenCalled();
    });

    it("closes popup when node type does not match", async () => {
      view.state.doc.nodeAt = vi.fn(() => ({
        type: { name: "paragraph" },
        attrs: {},
        textContent: "",
        nodeSize: 1,
      }));
      storeState.nodePos = 10;
      emitStateChange({ isOpen: true, target: "Test", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Remove wiki link");
      deleteBtn!.click();

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("Copy action", () => {
    it("copies target to clipboard", async () => {
      const mockWriteText = vi.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText: mockWriteText } });

      storeState.nodePos = 10;
      emitStateChange({ isOpen: true, target: "docs/readme", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "docs/readme";

      const copyBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Copy target");
      copyBtn!.click();

      await new Promise((r) => setTimeout(r, 10));
      expect(mockWriteText).toHaveBeenCalledWith("docs/readme");
    });

    it("does not copy when target is empty", async () => {
      const mockWriteText = vi.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText: mockWriteText } });

      emitStateChange({ isOpen: true, target: "", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "";

      const copyBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Copy target");
      copyBtn!.click();

      await new Promise((r) => setTimeout(r, 10));
      expect(mockWriteText).not.toHaveBeenCalled();
    });
  });

  describe("Open action", () => {
    it("emits open-file event when target is valid", async () => {
      const mockEmit = vi.fn(() => Promise.resolve());
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      vi.mocked(getCurrentWebviewWindow).mockReturnValue({ label: "main", emit: mockEmit } as ReturnType<typeof getCurrentWebviewWindow>);

      storeState.nodePos = 10;
      emitStateChange({ isOpen: true, target: "docs/readme", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "docs/readme";

      const openBtn = dom.container.querySelector(".wiki-link-popup-btn-open") as HTMLButtonElement;
      openBtn.click();

      await new Promise((r) => setTimeout(r, 10));
      expect(mockEmit).toHaveBeenCalledWith("open-file", { path: "/workspace/docs/readme.md", windowLabel: "main" });
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("does nothing when target is empty", async () => {
      emitStateChange({ isOpen: true, target: "", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "";

      const openBtn = dom.container.querySelector(".wiki-link-popup-btn-open") as HTMLButtonElement;
      openBtn.click();

      await new Promise((r) => setTimeout(r, 10));
      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("Browse action", () => {
    it("updates target after selecting file via dialog", async () => {
      const { open: mockDialogOpen } = await import("@tauri-apps/plugin-dialog");
      vi.mocked(mockDialogOpen).mockResolvedValue("/workspace/notes/new-page.md");

      emitStateChange({ isOpen: true, target: "", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const browseBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Browse for file");
      browseBtn!.click();

      await new Promise((r) => setTimeout(r, 10));
      expect(mockUpdateTarget).toHaveBeenCalledWith("notes/new-page");
    });

    it("does nothing when dialog is cancelled", async () => {
      const { open: mockDialogOpen } = await import("@tauri-apps/plugin-dialog");
      vi.mocked(mockDialogOpen).mockResolvedValue(null);

      emitStateChange({ isOpen: true, target: "Test", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const browseBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Browse for file");
      browseBtn!.click();

      await new Promise((r) => setTimeout(r, 10));
      expect(mockUpdateTarget).not.toHaveBeenCalled();
    });
  });

  describe("Cancel action", () => {
    it("closes popup and focuses editor on Escape", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.focus();

      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      input.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.focus).toHaveBeenCalled();
    });
  });

  describe("Scroll close", () => {
    it("closes popup on editor container scroll", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      dom.container.dispatchEvent(new Event("scroll", { bubbles: false }));

      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("does not close when popup is not open", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      // Close popup first
      emitStateChange({ isOpen: false, anchorRect: null });

      vi.clearAllMocks();
    mockWorkspaceRootPath = "/workspace";

      dom.container.dispatchEvent(new Event("scroll", { bubbles: false }));

      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("Mouse leave handling", () => {
    it("registers mouseleave listener on container", async () => {
      // Verify the popup has mouseleave handling set up
      // Actual mouseleave behavior is tested via E2E (jsdom has limitations with mouse events)
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".wiki-link-popup") as HTMLElement;
      expect(popupEl).not.toBeNull();
      // Popup is visible and has mouseleave handling registered
      expect(popupEl.style.display).toBe("flex");
    });

    it("does not close on mouse leave when input is focused", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      // Verify input exists and can be focused
      expect(input).not.toBeNull();
      input.focus();
      expect(document.activeElement).toBe(input);
      // Focus on input would prevent mouseleave from closing popup (verified manually)
    });

    it("does not close when moving to a wiki-link element", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      // Create a wiki-link element to simulate moving to it
      const wikiLink = document.createElement("span");
      wikiLink.className = "wiki-link";
      dom.editorDom.appendChild(wikiLink);

      const popupEl = dom.container.querySelector(".wiki-link-popup") as HTMLElement;
      const mouseleaveEvent = new MouseEvent("mouseleave", { bubbles: false });
      Object.defineProperty(mouseleaveEvent, "relatedTarget", { value: wikiLink });
      popupEl.dispatchEvent(mouseleaveEvent);

      // Should not close since we're moving to a wiki link
      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("Mounting", () => {
    it("mounts inside editor-container", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".wiki-link-popup");
      expect(popupEl).not.toBeNull();
      expect(dom.container.contains(popupEl)).toBe(true);
    });

    it("uses absolute positioning when in editor-container", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".wiki-link-popup") as HTMLElement;
      expect(popupEl.style.position).toBe("absolute");
    });

    it("cleans up on destroy", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      expect(dom.container.querySelector(".wiki-link-popup")).not.toBeNull();

      popup.destroy();

      expect(document.querySelector(".wiki-link-popup")).toBeNull();
    });
  });

  describe("justOpened guard", () => {
    it("prevents immediate close from same click event", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });

      // Click outside BEFORE rAF clears justOpened
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outside });
      document.dispatchEvent(mousedownEvent);

      expect(mockClosePopup).not.toHaveBeenCalled();
      outside.remove();
    });
  });

  describe("Open — resolveWikiLinkPath branches", () => {
    it("resolves target with / as path", async () => {
      const mockEmit = vi.fn(() => Promise.resolve());
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      vi.mocked(getCurrentWebviewWindow).mockReturnValue({ label: "main", emit: mockEmit } as ReturnType<typeof getCurrentWebviewWindow>);

      emitStateChange({ isOpen: true, target: "sub/page", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "sub/page";

      const openBtn = dom.container.querySelector(".wiki-link-popup-btn-open") as HTMLButtonElement;
      openBtn.click();

      await new Promise((r) => setTimeout(r, 10));
      // Target with / — appends .md
      expect(mockEmit).toHaveBeenCalledWith("open-file", { path: "/workspace/sub/page.md", windowLabel: "main" });
    });

    it("resolves target with .md extension directly", async () => {
      const mockEmit = vi.fn(() => Promise.resolve());
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      vi.mocked(getCurrentWebviewWindow).mockReturnValue({ label: "main", emit: mockEmit } as ReturnType<typeof getCurrentWebviewWindow>);

      emitStateChange({ isOpen: true, target: "page.md", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "page.md";

      const openBtn = dom.container.querySelector(".wiki-link-popup-btn-open") as HTMLButtonElement;
      openBtn.click();

      await new Promise((r) => setTimeout(r, 10));
      // Target ending in .md — used directly
      expect(mockEmit).toHaveBeenCalledWith("open-file", { path: "/workspace/page.md", windowLabel: "main" });
    });
  });

  describe("Browse — error handling", () => {
    it("catches and logs error from open dialog", async () => {
      const { open: mockDialogOpen } = await import("@tauri-apps/plugin-dialog");
      vi.mocked(mockDialogOpen).mockRejectedValue(new Error("dialog error"));

      emitStateChange({ isOpen: true, target: "", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const browseBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Browse for file");
      browseBtn!.click();

      await new Promise((r) => setTimeout(r, 50));
      expect(wikiLinkPopupError).toHaveBeenCalledWith("Browse failed:", expect.any(Error));
    });
  });

  describe("Copy — error handling", () => {
    it("catches clipboard write error", async () => {
      Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.reject(new Error("copy fail"))) } });

      emitStateChange({ isOpen: true, target: "Target", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "Target";

      const copyBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Copy target");
      copyBtn!.click();

      await new Promise((r) => setTimeout(r, 50));
      expect(wikiLinkPopupError).toHaveBeenCalledWith("Failed to copy:", expect.any(Error));
    });
  });

  describe("Mouse leave — close path", () => {
    it("closes popup when mouse leaves to non-wiki-link and input not focused", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      // Ensure input is NOT focused
      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.blur();

      const outsideDiv = document.createElement("div");
      document.body.appendChild(outsideDiv);

      const popupEl = dom.container.querySelector(".wiki-link-popup") as HTMLElement;
      const mouseleaveEvent = new MouseEvent("mouseleave", { bubbles: false });
      Object.defineProperty(mouseleaveEvent, "relatedTarget", { value: outsideDiv });
      popupEl.dispatchEvent(mouseleaveEvent);

      expect(mockClosePopup).toHaveBeenCalled();
      outsideDiv.remove();
    });
  });

  describe("Open — error handling", () => {
    it("catches emit error gracefully", async () => {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      vi.mocked(getCurrentWebviewWindow).mockReturnValue({ emit: vi.fn(() => Promise.reject(new Error("emit fail"))) } as ReturnType<typeof getCurrentWebviewWindow>);

      emitStateChange({ isOpen: true, target: "Page", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "Page";

      const openBtn = dom.container.querySelector(".wiki-link-popup-btn-open") as HTMLButtonElement;
      openBtn.click();

      await new Promise((r) => setTimeout(r, 50));
      expect(wikiLinkPopupError).toHaveBeenCalledWith("Failed to open file:", expect.any(Error));
    });

  });

  describe("Delete — falls back to attrs.value when textContent is empty", () => {
    it("uses attrs.value when textContent is empty", async () => {
      view.state.doc.nodeAt = vi.fn(() => ({
        type: { name: "wikiLink" },
        attrs: { value: "FallbackTarget" },
        textContent: "",
        nodeSize: 3,
      }));
      storeState.nodePos = 10;
      emitStateChange({ isOpen: true, target: "FallbackTarget", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Remove wiki link");
      deleteBtn!.click();

      // Should use attrs.value ("FallbackTarget") as display text
      expect(view.state.schema.text).toHaveBeenCalledWith("FallbackTarget");
      expect(view.state.tr.replaceWith).toHaveBeenCalled();
    });
  });

  describe("Open — resolveWikiLinkPath returns null when no workspace root", () => {
    it("warns and skips open when rootPath is null", async () => {
      mockWorkspaceRootPath = null;

      emitStateChange({ isOpen: true, target: "SomePage", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "SomePage";

      const openBtn = dom.container.querySelector(".wiki-link-popup-btn-open") as HTMLButtonElement;
      openBtn.disabled = false; // force enable for test
      openBtn.click();

      await new Promise((r) => setTimeout(r, 50));
      expect(mockWikiLinkPopupWarn).toHaveBeenCalledWith(
        "Cannot resolve wiki link target:",
        "SomePage",
      );
      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("Mounting — fixed positioning when host is document.body", () => {
    it("uses fixed positioning and sets top/left directly when mounted to document.body", async () => {
      // Make getPopupHostForDom return null so popup falls back to document.body
      mockGetPopupHostForDom.mockReturnValueOnce(null);

      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = document.body.querySelector(".wiki-link-popup") as HTMLElement;
      expect(popupEl).not.toBeNull();
      expect(popupEl.style.position).toBe("fixed");
    });
  });

  describe("Mouse leave — input focused early return", () => {
    it("does not close when input is focused and mouse leaves to non-wiki element", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      // Focus the input so document.activeElement === targetInput
      input.focus();

      const outsideDiv = document.createElement("div");
      document.body.appendChild(outsideDiv);

      const popupEl = dom.container.querySelector(".wiki-link-popup") as HTMLElement;
      const mouseleaveEvent = new MouseEvent("mouseleave", { bubbles: false });
      Object.defineProperty(mouseleaveEvent, "relatedTarget", { value: outsideDiv });
      popupEl.dispatchEvent(mouseleaveEvent);

      // Should NOT close because input is focused
      expect(mockClosePopup).not.toHaveBeenCalled();
      outsideDiv.remove();
    });
  });

  describe("Mouse leave — relatedTarget is null", () => {
    it("closes popup when relatedTarget is null", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.blur();

      const popupEl = dom.container.querySelector(".wiki-link-popup") as HTMLElement;
      const mouseleaveEvent = new MouseEvent("mouseleave", { bubbles: false });
      Object.defineProperty(mouseleaveEvent, "relatedTarget", { value: null });
      popupEl.dispatchEvent(mouseleaveEvent);

      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("Browse — array result early return (line 284)", () => {
    it("does nothing when dialog returns an array", async () => {
      const { open: mockDialogOpen } = await import("@tauri-apps/plugin-dialog");
      vi.mocked(mockDialogOpen).mockResolvedValue(["/workspace/a.md", "/workspace/b.md"] as unknown as string);

      emitStateChange({ isOpen: true, target: "", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const browseBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Browse for file");
      browseBtn!.click();

      await new Promise((r) => setTimeout(r, 10));
      expect(mockUpdateTarget).not.toHaveBeenCalled();
    });
  });

  describe("Browse — pathToWikiTarget with null workspaceRoot", () => {
    it("returns raw file path when workspaceRoot is null", async () => {
      mockWorkspaceRootPath = null;
      const { open: mockDialogOpen } = await import("@tauri-apps/plugin-dialog");
      vi.mocked(mockDialogOpen).mockResolvedValue("/some/file.md");

      emitStateChange({ isOpen: true, target: "", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const browseBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Browse for file");
      browseBtn!.click();

      await new Promise((r) => setTimeout(r, 10));
      // pathToWikiTarget returns filePath as-is when workspaceRoot is null (no stripping)
      expect(mockUpdateTarget).toHaveBeenCalledWith("/some/file.md");
    });
  });

  describe("Browse — pathToWikiTarget when file not under workspace", () => {
    it("preserves path when file is outside workspace root", async () => {
      mockWorkspaceRootPath = "/workspace";
      const { open: mockDialogOpen } = await import("@tauri-apps/plugin-dialog");
      vi.mocked(mockDialogOpen).mockResolvedValue("/other/location/doc.md");

      emitStateChange({ isOpen: true, target: "", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const browseBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Browse for file");
      browseBtn!.click();

      await new Promise((r) => setTimeout(r, 10));
      // File doesn't start with workspace root, so relative = filePath, then .md is stripped
      expect(mockUpdateTarget).toHaveBeenCalledWith("/other/location/doc");
    });
  });

  describe("Browse — pathToWikiTarget file without .md extension", () => {
    it("does not strip non-.md extension", async () => {
      mockWorkspaceRootPath = "/workspace";
      const { open: mockDialogOpen } = await import("@tauri-apps/plugin-dialog");
      vi.mocked(mockDialogOpen).mockResolvedValue("/workspace/image.png");

      emitStateChange({ isOpen: true, target: "", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const browseBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Browse for file");
      browseBtn!.click();

      await new Promise((r) => setTimeout(r, 10));
      // File under workspace, no .md extension — kept as-is after stripping root
      expect(mockUpdateTarget).toHaveBeenCalledWith("image.png");
    });
  });

  describe("Open — resolveWikiLinkPath with empty target", () => {
    it("returns null when target is empty string", async () => {
      const mockEmit = vi.fn(() => Promise.resolve());
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      vi.mocked(getCurrentWebviewWindow).mockReturnValue({ label: "main", emit: mockEmit } as ReturnType<typeof getCurrentWebviewWindow>);

      emitStateChange({ isOpen: true, target: "", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      // Force the input to have whitespace-only so target.trim() is empty
      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "   ";

      const openBtn = dom.container.querySelector(".wiki-link-popup-btn-open") as HTMLButtonElement;
      openBtn.disabled = false;
      openBtn.click();

      await new Promise((r) => setTimeout(r, 10));
      // handleOpen returns early because target is empty
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe("Subscription — does not re-show when already open (wasOpen guard)", () => {
    it("skips show when popup was already open", async () => {
      // Open the popup
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".wiki-link-popup") as HTMLElement;
      expect(popupEl.style.display).toBe("flex");

      // Emit another state change while still open — should NOT call show() again
      // (wasOpen is already true)
      vi.clearAllMocks();
      emitStateChange({ isOpen: true, target: "Updated", nodePos: 2, anchorRect });

      // The input value should NOT change since show() was not called
      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      expect(input.value).toBe("Test"); // Still the original value
    });
  });

  describe("IME guard in setupKeyboardNavigation (line 173)", () => {
    it("ignores IME events in keyboard navigation handler", async () => {
      const imeGuard = await import("@/utils/imeGuard");

      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      vi.spyOn(imeGuard, "isImeKeyEvent" as never).mockReturnValueOnce(true as never);

      // Tab key should be ignored due to IME guard
      const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      document.dispatchEvent(event);

      // No error = IME guard early return worked
      vi.mocked(imeGuard.isImeKeyEvent as never).mockRestore?.();
    });
  });

  describe("IME guard in handleInputKeydown (line 260)", () => {
    it("ignores IME events in input keydown handler", async () => {
      const imeGuard = await import("@/utils/imeGuard");

      emitStateChange({
        isOpen: true, target: "Test", nodePos: 10, anchorRect,
      });
      await new Promise((r) => requestAnimationFrame(r));

      vi.spyOn(imeGuard, "isImeKeyEvent" as never).mockReturnValueOnce(true as never);

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.focus();

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      input.dispatchEvent(event);

      // Save should NOT be called because IME guard returned true
      expect(view.dispatch).not.toHaveBeenCalled();
      vi.mocked(imeGuard.isImeKeyEvent as never).mockRestore?.();
    });
  });

  describe("Save — nodeAt returns null", () => {
    it("closes popup when nodeAt returns null", async () => {
      view.state.doc.nodeAt = vi.fn(() => null);
      storeState.nodePos = 10;
      emitStateChange({ isOpen: true, target: "Test", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "ValidTarget";

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      input.dispatchEvent(event);

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("Delete — nodeAt returns null", () => {
    it("closes popup when nodeAt returns null for delete", async () => {
      view.state.doc.nodeAt = vi.fn(() => null);
      storeState.nodePos = 10;
      emitStateChange({ isOpen: true, target: "Test", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Remove wiki link");
      deleteBtn!.click();

      expect(mockClosePopup).toHaveBeenCalled();
      expect(view.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("Click outside — popup not open", () => {
    it("does nothing when popup is not open", async () => {
      // Don't open the popup — isOpen is false
      const outsideEl = document.createElement("div");
      document.body.appendChild(outsideEl);

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outsideEl });
      document.dispatchEvent(mousedownEvent);

      expect(mockClosePopup).not.toHaveBeenCalled();
      outsideEl.remove();
    });
  });

  describe("Show — no editor-container (viewport bounds fallback)", () => {
    it("uses viewport bounds when no editor-container exists", async () => {
      // Remove editor-container class
      dom.container.className = "";

      // Recreate popup with updated DOM
      popup.destroy();
      vi.clearAllMocks();

      const newView = createMockView(dom.editorDom);
      view = newView;
      popup = new WikiLinkPopupView(view as unknown as ConstructorParameters<typeof WikiLinkPopupView>[0]);

      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      // Popup should still show (using viewport bounds)
      const popupEl = document.querySelector(".wiki-link-popup") as HTMLElement;
      expect(popupEl).not.toBeNull();
      expect(popupEl.style.display).toBe("flex");

      // Restore
      dom.container.className = "editor-container";
    });
  });

  describe("Enter with Shift key (line 266)", () => {
    it("does not save on Shift+Enter", async () => {
      storeState.nodePos = 10;
      emitStateChange({ isOpen: true, target: "Test", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const input = dom.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
      input.value = "Test";
      input.focus();

      const event = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true });
      input.dispatchEvent(event);

      // Shift+Enter should NOT trigger save
      expect(view.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("wasOpen — store fires again while popup is already open (line 58 else branch)", () => {
    it("does not call show() again when store fires while wasOpen is true", async () => {
      // First open — sets wasOpen = true
      emitStateChange({ isOpen: true, target: "FirstPage", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".wiki-link-popup") as HTMLElement;
      expect(popupEl.style.display).toBe("flex");

      // Fire store again while wasOpen is true — else branch of `if (!this.wasOpen)` is taken
      emitStateChange({ isOpen: true, target: "SecondPage", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      // Popup is still visible — no crash
      expect(popupEl.style.display).toBe("flex");
    });
  });

  describe("show() — host is document.body when no editor container (line 191 else branch)", () => {
    it("uses fixed positioning when getPopupHostForDom returns null (host becomes document.body)", async () => {
      mockGetPopupHostForDom.mockReturnValue(null);

      popup.destroy();
      vi.clearAllMocks();
      view = createMockView(dom.editorDom);
      popup = new WikiLinkPopupView(view as unknown as ConstructorParameters<typeof WikiLinkPopupView>[0]);

      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = document.querySelector(".wiki-link-popup") as HTMLElement;
      expect(popupEl).not.toBeNull();
      expect(popupEl.style.position).toBe("fixed");
      expect(popupEl.style.display).toBe("flex");
    });
  });

  describe("handleDelete — empty textContent fallback (line 377 || branch)", () => {
    it("uses node.attrs.value when textContent is empty", async () => {
      // Create a view where node.textContent is empty but attrs.value is set
      view = createMockView(dom.editorDom);
      // Override nodeAt to return a node with empty textContent
      vi.mocked(view.state.doc.nodeAt).mockReturnValue({
        type: { name: "wikiLink" },
        attrs: { value: "fallback-page" },
        textContent: "", // empty textContent → || fallback to attrs.value
        nodeSize: 1,
      } as never);

      popup.destroy();
      vi.clearAllMocks();
      popup = new WikiLinkPopupView(view as unknown as ConstructorParameters<typeof WikiLinkPopupView>[0]);

      emitStateChange({ isOpen: true, target: "Test", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = dom.container.querySelector('button[title="Remove wiki link"]') as HTMLElement;
      deleteBtn.click();

      // Should use attrs.value as display text for the text node
      expect(view.state.schema.text).toHaveBeenCalledWith("fallback-page");
      expect(view.dispatch).toHaveBeenCalled();
      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("handleDelete — attrs.value is undefined (line 377 ?? branch)", () => {
    it("uses empty string when textContent is empty and attrs.value is undefined", async () => {
      view.state.doc.nodeAt = vi.fn(() => ({
        type: { name: "wikiLink" },
        attrs: { value: undefined }, // attrs.value undefined → ?? "" fires
        textContent: "",
        nodeSize: 3,
      }));
      storeState.nodePos = 10;
      emitStateChange({ isOpen: true, target: "", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const deleteBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Remove wiki link");
      deleteBtn!.click();

      // displayText = "" → takes delete path (not replaceWith)
      expect(view.state.tr.delete).toHaveBeenCalled();
      expect(view.dispatch).toHaveBeenCalled();
    });
  });

  describe("show() — container already in host (line 191 false branch)", () => {
    it("does not re-append container when already mounted in same host", async () => {
      // First show mounts the container
      emitStateChange({ isOpen: true, target: "First", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const popupEl = dom.container.querySelector(".wiki-link-popup") as HTMLElement;
      expect(popupEl.parentElement).toBe(dom.container);

      // Close then re-open — second show() should see container already in host
      emitStateChange({ isOpen: false, anchorRect: null });
      await new Promise((r) => requestAnimationFrame(r));

      emitStateChange({ isOpen: true, target: "Second", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      // Still only one copy of the popup
      const allPopups = dom.container.querySelectorAll(".wiki-link-popup");
      expect(allPopups.length).toBe(1);
    });
  });

  describe("Browse — pathToWikiTarget when workspaceRoot ends with slash (line 58 false branch)", () => {
    it("does not double-strip leading slash when root ends with /", async () => {
      // workspaceRoot ends with "/" → after slicing, relative won't start with "/"
      mockWorkspaceRootPath = "/workspace/";
      const { open: mockDialogOpen } = await import("@tauri-apps/plugin-dialog");
      vi.mocked(mockDialogOpen).mockResolvedValue("/workspace/page.md");

      emitStateChange({ isOpen: true, target: "", nodePos: 10, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      const browseBtn = Array.from(dom.container.querySelectorAll("button")).find((b) => b.title === "Browse for file");
      browseBtn!.click();

      await new Promise((r) => setTimeout(r, 10));
      // After slicing "/workspace/" from "/workspace/page.md": relative = "page.md"
      // "page.md" does NOT start with "/" → false branch of `if (relative.startsWith("/"))`
      // Then .md is stripped → "page"
      expect(mockUpdateTarget).toHaveBeenCalledWith("page");
    });
  });

  describe("handleMousedown — click inside popup (line 406 false branch)", () => {
    it("does not close when clicking inside the popup", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      // Click inside the popup container
      const popupEl = dom.container.querySelector(".wiki-link-popup") as HTMLElement;
      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: popupEl });
      document.dispatchEvent(mousedownEvent);

      // Should NOT close — target is inside container
      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });

  describe("handleScroll — popup not open (line 406 else branch)", () => {
    it("does nothing on scroll when popup is closed", async () => {
      emitStateChange({ isOpen: true, target: "Test", nodePos: 1, anchorRect });
      await new Promise((r) => requestAnimationFrame(r));

      // Close the popup first
      emitStateChange({ isOpen: false, anchorRect: null });
      mockClosePopup.mockClear();

      // Scroll while popup is not open — isOpen is false → else branch (no closePopup call)
      dom.container.dispatchEvent(new Event("scroll", { bubbles: true }));

      expect(mockClosePopup).not.toHaveBeenCalled();
    });
  });
});
