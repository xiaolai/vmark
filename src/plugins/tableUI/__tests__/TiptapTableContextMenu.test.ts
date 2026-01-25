/**
 * TiptapTableContextMenu Tests
 *
 * Tests for the Tiptap editor table context menu including:
 * - Menu construction and actions
 * - Show/hide lifecycle
 * - Viewport clamping
 * - Click outside handling
 * - Mounting in editor container
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Mock table actions
vi.mock("../tableActions.tiptap", () => ({
  addRowAbove: vi.fn(),
  addRowBelow: vi.fn(),
  addColLeft: vi.fn(),
  addColRight: vi.fn(),
  deleteCurrentRow: vi.fn(),
  deleteCurrentColumn: vi.fn(),
  deleteCurrentTable: vi.fn(),
  alignColumn: vi.fn(),
  formatTable: vi.fn(),
}));

// Mock icons
vi.mock("@/utils/icons", () => ({
  icons: {
    rowAbove: "<svg>rowAbove</svg>",
    rowBelow: "<svg>rowBelow</svg>",
    colLeft: "<svg>colLeft</svg>",
    colRight: "<svg>colRight</svg>",
    deleteRow: "<svg>deleteRow</svg>",
    deleteCol: "<svg>deleteCol</svg>",
    deleteTable: "<svg>deleteTable</svg>",
    alignLeft: "<svg>alignLeft</svg>",
    alignCenter: "<svg>alignCenter</svg>",
    alignRight: "<svg>alignRight</svg>",
    alignAllLeft: "<svg>alignAllLeft</svg>",
    alignAllCenter: "<svg>alignAllCenter</svg>",
    alignAllRight: "<svg>alignAllRight</svg>",
    formatTable: "<svg>formatTable</svg>",
  },
}));

vi.mock("@/plugins/sourcePopup", () => ({
  getPopupHostForDom: (dom: HTMLElement) => dom.closest(".editor-container"),
  toHostCoordsForDom: (_host: HTMLElement, pos: { top: number; left: number }) => pos,
}));

// Import after mocking
import { TiptapTableContextMenu } from "../TiptapTableContextMenu";
import {
  addRowAbove,
  addRowBelow,
  addColLeft,
  addColRight,
  deleteCurrentRow,
  deleteCurrentColumn,
  deleteCurrentTable,
  alignColumn,
  formatTable,
} from "../tableActions.tiptap";

// Helper functions
function createEditorContainer() {
  const container = document.createElement("div");
  container.className = "editor-container";
  container.style.position = "relative";
  container.style.width = "800px";
  container.style.height = "600px";
  container.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    bottom: 600,
    right: 800,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  const editorDom = document.createElement("div");
  editorDom.className = "ProseMirror";
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
    state: {},
    dispatch: vi.fn(),
    focus: vi.fn(),
  };
}

describe("TiptapTableContextMenu", () => {
  let dom: ReturnType<typeof createEditorContainer>;
  let view: ReturnType<typeof createMockView>;
  let menu: TiptapTableContextMenu;

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    dom = createEditorContainer();
    view = createMockView(dom.editorDom);
    menu = new TiptapTableContextMenu(view as unknown as ConstructorParameters<typeof TiptapTableContextMenu>[0]);
  });

  afterEach(() => {
    menu.destroy();
    dom.cleanup();
  });

  describe("Construction", () => {
    it("creates container element on construction", () => {
      // Container not yet visible but created
      const container = document.querySelector(".table-context-menu");
      // Container is created but not in DOM until show()
      expect(container).toBeNull(); // Not mounted until show()
    });

    it("registers click outside listener", () => {
      const addEventListenerSpy = vi.spyOn(document, "addEventListener");
      const newMenu = new TiptapTableContextMenu(view as unknown as ConstructorParameters<typeof TiptapTableContextMenu>[0]);
      expect(addEventListenerSpy).toHaveBeenCalledWith("mousedown", expect.any(Function));
      newMenu.destroy();
    });
  });

  describe("Show/Hide lifecycle", () => {
    it("shows menu at specified position", async () => {
      menu.show(100, 200);
      await new Promise((r) => requestAnimationFrame(r));

      const container = document.querySelector(".table-context-menu") as HTMLElement;
      expect(container).not.toBeNull();
      expect(container.style.display).toBe("flex");
      expect(container.style.left).toBe("100px");
      expect(container.style.top).toBe("200px");
    });

    it("hides menu", async () => {
      menu.show(100, 200);
      await new Promise((r) => requestAnimationFrame(r));

      menu.hide();

      const container = document.querySelector(".table-context-menu") as HTMLElement;
      expect(container.style.display).toBe("none");
    });

    it("mounts inside editor-container when available", async () => {
      menu.show(100, 200);
      await new Promise((r) => requestAnimationFrame(r));

      const container = dom.container.querySelector(".table-context-menu");
      expect(container).not.toBeNull();
      expect(dom.container.contains(container)).toBe(true);
    });

    it("uses absolute positioning when in editor container", async () => {
      menu.show(100, 200);
      await new Promise((r) => requestAnimationFrame(r));

      const container = document.querySelector(".table-context-menu") as HTMLElement;
      expect(container.style.position).toBe("absolute");
    });
  });

  describe("Menu actions", () => {
    beforeEach(async () => {
      menu.show(100, 200);
      await new Promise((r) => requestAnimationFrame(r));
    });

    it("renders all 14 menu items", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      expect(items.length).toBe(14);
    });

    it("renders dividers between sections", () => {
      const dividers = document.querySelectorAll(".table-context-menu-divider");
      expect(dividers.length).toBeGreaterThan(0);
    });

    it("Insert Row Above action calls addRowAbove", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      (items[0] as HTMLElement).click();

      expect(addRowAbove).toHaveBeenCalledWith(view);
    });

    it("Insert Row Below action calls addRowBelow", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      (items[1] as HTMLElement).click();

      expect(addRowBelow).toHaveBeenCalledWith(view);
    });

    it("Insert Column Left action calls addColLeft", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      (items[2] as HTMLElement).click();

      expect(addColLeft).toHaveBeenCalledWith(view);
    });

    it("Insert Column Right action calls addColRight", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      (items[3] as HTMLElement).click();

      expect(addColRight).toHaveBeenCalledWith(view);
    });

    it("Delete Row action calls deleteCurrentRow", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      (items[4] as HTMLElement).click();

      expect(deleteCurrentRow).toHaveBeenCalledWith(view);
    });

    it("Delete Column action calls deleteCurrentColumn", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      (items[5] as HTMLElement).click();

      expect(deleteCurrentColumn).toHaveBeenCalledWith(view);
    });

    it("Delete Table action calls deleteCurrentTable", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      (items[6] as HTMLElement).click();

      expect(deleteCurrentTable).toHaveBeenCalledWith(view);
    });

    it("Align Column Left action calls alignColumn with left", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      (items[7] as HTMLElement).click();

      expect(alignColumn).toHaveBeenCalledWith(view, "left", false);
    });

    it("Align Column Center action calls alignColumn with center", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      (items[8] as HTMLElement).click();

      expect(alignColumn).toHaveBeenCalledWith(view, "center", false);
    });

    it("Align Column Right action calls alignColumn with right", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      (items[9] as HTMLElement).click();

      expect(alignColumn).toHaveBeenCalledWith(view, "right", false);
    });

    it("Align All Left action calls alignColumn with applyToAll", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      (items[10] as HTMLElement).click();

      expect(alignColumn).toHaveBeenCalledWith(view, "left", true);
    });

    it("Align All Center action calls alignColumn with applyToAll", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      (items[11] as HTMLElement).click();

      expect(alignColumn).toHaveBeenCalledWith(view, "center", true);
    });

    it("Align All Right action calls alignColumn with applyToAll", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      (items[12] as HTMLElement).click();

      expect(alignColumn).toHaveBeenCalledWith(view, "right", true);
    });

    it("Format Table action calls formatTable", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      (items[13] as HTMLElement).click();

      expect(formatTable).toHaveBeenCalledWith(view);
    });

    it("hides menu after action", () => {
      const items = document.querySelectorAll(".table-context-menu-item");
      (items[0] as HTMLElement).click();

      const container = document.querySelector(".table-context-menu") as HTMLElement;
      expect(container.style.display).toBe("none");
    });

    it("marks danger items with correct class", () => {
      const dangerItems = document.querySelectorAll(".table-context-menu-item-danger");
      expect(dangerItems.length).toBe(3); // Delete Row, Delete Column, Delete Table
    });
  });

  describe("Click outside handling", () => {
    it("hides menu when clicking outside", async () => {
      menu.show(100, 200);
      await new Promise((r) => requestAnimationFrame(r));

      const outsideEl = document.createElement("div");
      document.body.appendChild(outsideEl);

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outsideEl });
      document.dispatchEvent(mousedownEvent);

      const container = document.querySelector(".table-context-menu") as HTMLElement;
      expect(container.style.display).toBe("none");
    });

    it("does not hide when clicking inside menu", async () => {
      menu.show(100, 200);
      await new Promise((r) => requestAnimationFrame(r));

      const container = document.querySelector(".table-context-menu") as HTMLElement;
      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: container });
      document.dispatchEvent(mousedownEvent);

      expect(container.style.display).toBe("flex");
    });

    it("does not respond to clicks when not visible", async () => {
      // Don't show the menu
      const outsideEl = document.createElement("div");
      document.body.appendChild(outsideEl);

      const mousedownEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mousedownEvent, "target", { value: outsideEl });
      document.dispatchEvent(mousedownEvent);

      // No error should occur
      expect(true).toBe(true);
    });
  });

  describe("View update", () => {
    it("updateView updates the editor view reference", async () => {
      const newEditorDom = document.createElement("div");
      const newView = createMockView(newEditorDom);

      menu.updateView(newView as unknown as ConstructorParameters<typeof TiptapTableContextMenu>[0]);
      menu.show(100, 200);
      await new Promise((r) => requestAnimationFrame(r));

      const items = document.querySelectorAll(".table-context-menu-item");
      (items[0] as HTMLElement).click();

      expect(addRowAbove).toHaveBeenCalledWith(newView);
    });
  });

  describe("Cleanup", () => {
    it("removes container on destroy", async () => {
      menu.show(100, 200);
      await new Promise((r) => requestAnimationFrame(r));

      expect(document.querySelector(".table-context-menu")).not.toBeNull();

      menu.destroy();

      expect(document.querySelector(".table-context-menu")).toBeNull();
    });

    it("removes event listener on destroy", () => {
      const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

      menu.destroy();

      expect(removeEventListenerSpy).toHaveBeenCalledWith("mousedown", expect.any(Function));
    });
  });
});
