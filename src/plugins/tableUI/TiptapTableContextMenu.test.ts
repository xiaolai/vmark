/**
 * Tests for TiptapTableContextMenu — imperative DOM context menu for tables.
 *
 * Covers:
 *   - Constructor: container creation, event listener setup
 *   - show(): menu building, host mounting, position calculation
 *   - hide(): visibility reset
 *   - handleClickOutside / handleKeydown
 *   - destroy(): listener cleanup
 *   - Fit-to-width toggle visibility based on global setting
 */

import { bindHostSettings } from "@/plugins/shared/hostSettings";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock table actions
const mockAddRowAbove = vi.fn();
const mockAddRowBelow = vi.fn();
const mockAddColLeft = vi.fn();
const mockAddColRight = vi.fn();
const mockDeleteCurrentRow = vi.fn();
const mockDeleteCurrentColumn = vi.fn();
const mockDeleteCurrentTable = vi.fn();
const mockAlignColumn = vi.fn();
const mockFormatTable = vi.fn();
const mockIsCurrentTableFitToWidth = vi.fn(() => false);
const mockToggleFitToWidth = vi.fn();

vi.mock("./tableActions.tiptap", () => ({
  addRowAbove: (...args: unknown[]) => mockAddRowAbove(...args),
  addRowBelow: (...args: unknown[]) => mockAddRowBelow(...args),
  addColLeft: (...args: unknown[]) => mockAddColLeft(...args),
  addColRight: (...args: unknown[]) => mockAddColRight(...args),
  deleteCurrentRow: (...args: unknown[]) => mockDeleteCurrentRow(...args),
  deleteCurrentColumn: (...args: unknown[]) => mockDeleteCurrentColumn(...args),
  deleteCurrentTable: (...args: unknown[]) => mockDeleteCurrentTable(...args),
  alignColumn: (...args: unknown[]) => mockAlignColumn(...args),
  formatTable: (...args: unknown[]) => mockFormatTable(...args),
  isCurrentTableFitToWidth: (...args: unknown[]) => mockIsCurrentTableFitToWidth(...args),
  toggleFitToWidth: (...args: unknown[]) => mockToggleFitToWidth(...args),
}));

vi.mock("@/utils/icons", () => ({
  icons: new Proxy({}, { get: () => "<svg></svg>" }),
}));

vi.mock("@/plugins/shared/popupHostDom", () => ({
  getPopupHostForDom: vi.fn(() => null),
  toHostCoordsForDom: vi.fn((_host: unknown, pos: { top: number; left: number }) => pos),
}));

let mockTableFitToWidth = false;
// The setting arrives through the plugins' host seam now (ADR-015). Bound to
// the SAME mutable flag the removed store mock read, so the cases that flip it
// keep working unchanged.
bindHostSettings({ tableFitToWidth: () => mockTableFitToWidth });

import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/shared/popupHostDom";
import { TiptapTableContextMenu } from "./TiptapTableContextMenu";

function createMockView() {
  return {
    dom: {
      isConnected: true,
      closest: vi.fn(() => null),
    },
    focus: vi.fn(),
  } as unknown;
}

describe("TiptapTableContextMenu", () => {
  let menu: TiptapTableContextMenu;
  let view: ReturnType<typeof createMockView>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTableFitToWidth = false;
    view = createMockView();
    menu = new TiptapTableContextMenu(view as never);
  });

  afterEach(() => {
    menu.destroy();
  });

  it("creates a container element on construction", () => {
    // Container exists but is hidden
    expect(menu).toBeDefined();
  });

  it("shows the menu at specified coordinates", () => {
    menu.show(100, 200);
    // After show, the container should be visible (display: flex)
  });

  it("hides the menu", () => {
    menu.show(100, 200);
    menu.hide();
    // After hide, menu is not visible
  });

  it("hides on click outside", () => {
    menu.show(100, 200);
    // Simulate click outside
    const event = new MouseEvent("mousedown", { bubbles: true });
    document.dispatchEvent(event);
    // Menu should be hidden
  });

  it("hides on Escape key and refocuses editor", () => {
    menu.show(100, 200);
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    document.dispatchEvent(event);
    expect((view as { focus: ReturnType<typeof vi.fn> }).focus).toHaveBeenCalled();
  });

  it("does not react to Escape when not visible", () => {
    // Menu not shown - Escape should not call focus
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    document.dispatchEvent(event);
    expect((view as { focus: ReturnType<typeof vi.fn> }).focus).not.toHaveBeenCalled();
  });

  it("does not react to non-Escape keys", () => {
    menu.show(100, 200);
    const event = new KeyboardEvent("keydown", { key: "a" });
    document.dispatchEvent(event);
    // Should not hide
  });

  it("builds menu items including fit-to-width when global setting is OFF", () => {
    mockTableFitToWidth = false;
    menu.show(100, 200);
    // Fit to width item should be in the menu
  });

  it("hides fit-to-width item when global setting is ON", () => {
    mockTableFitToWidth = true;
    menu.show(100, 200);
    // Menu built without fit-to-width
  });

  it("updateView updates the editor view reference", () => {
    const newView = createMockView();
    menu.updateView(newView as never);
    // Should use new view for actions
  });

  it("removes event listeners on destroy", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    menu.destroy();
    expect(removeSpy).toHaveBeenCalledWith("mousedown", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    removeSpy.mockRestore();
  });

  it("clicking a menu item calls the action and hides", () => {
    menu.show(100, 200);
    // Find the first button (Insert Row Above) and click it
    const container = (menu as unknown as { container: HTMLElement }).container;
    const firstButton = container.querySelector("button");
    expect(firstButton).not.toBeNull();
    firstButton!.click();
    expect(mockAddRowAbove).toHaveBeenCalled();
  });

  it("clicking each action button triggers the correct handler", () => {
    mockTableFitToWidth = false;
    mockIsCurrentTableFitToWidth.mockReturnValue(false);
    menu.show(100, 200);
    const container = (menu as unknown as { container: HTMLElement }).container;
    const buttons = container.querySelectorAll("button");

    // Expected order from buildMenu:
    // 0: Insert Row Above, 1: Insert Row Below, 2: Insert Col Left, 3: Insert Col Right
    // 4: Delete Row, 5: Delete Column, 6: Delete Table
    // 7: Align Column Left, 8: Align Column Center, 9: Align Column Right
    // 10: Align All Left, 11: Align All Center, 12: Align All Right
    // 13: Format Table, 14: Fit to Width
    buttons[1].click();
    expect(mockAddRowBelow).toHaveBeenCalled();

    buttons[2].click();
    expect(mockAddColLeft).toHaveBeenCalled();

    buttons[3].click();
    expect(mockAddColRight).toHaveBeenCalled();

    buttons[4].click();
    expect(mockDeleteCurrentRow).toHaveBeenCalled();

    buttons[5].click();
    expect(mockDeleteCurrentColumn).toHaveBeenCalled();

    buttons[6].click();
    expect(mockDeleteCurrentTable).toHaveBeenCalled();

    // Alignment buttons (column)
    buttons[7].click();
    expect(mockAlignColumn).toHaveBeenCalledWith(expect.anything(), "left", false);

    buttons[8].click();
    expect(mockAlignColumn).toHaveBeenCalledWith(expect.anything(), "center", false);

    buttons[9].click();
    expect(mockAlignColumn).toHaveBeenCalledWith(expect.anything(), "right", false);

    // Alignment buttons (all columns)
    buttons[10].click();
    expect(mockAlignColumn).toHaveBeenCalledWith(expect.anything(), "left", true);

    buttons[11].click();
    expect(mockAlignColumn).toHaveBeenCalledWith(expect.anything(), "center", true);

    buttons[12].click();
    expect(mockAlignColumn).toHaveBeenCalledWith(expect.anything(), "right", true);

    // Format table
    buttons[13].click();
    expect(mockFormatTable).toHaveBeenCalled();

    // Fit to width
    buttons[14].click();
    expect(mockToggleFitToWidth).toHaveBeenCalled();
  });

  it("does not hide on mousedown inside the menu container", () => {
    menu.show(100, 200);
    const container = (menu as unknown as { container: HTMLElement }).container;
    const event = new MouseEvent("mousedown", { bubbles: true });
    container.dispatchEvent(event);
    // Should still be visible (click inside does not trigger hide)
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: show() with popup host (lines 128-143)
// When getPopupHostForDom returns a real host element (not null/document.body)
// ---------------------------------------------------------------------------

describe("TiptapTableContextMenu — popup host mounting", () => {
  let menu3: TiptapTableContextMenu;
  let view3: ReturnType<typeof createMockView>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTableFitToWidth = false;
    // Restore default mock implementations
    vi.mocked(getPopupHostForDom).mockReturnValue(null);
    vi.mocked(toHostCoordsForDom).mockImplementation((_host: unknown, pos: { top: number; left: number }) => pos);
    view3 = createMockView();
    menu3 = new TiptapTableContextMenu(view3 as never);
  });

  afterEach(() => {
    menu3.destroy();
  });

  it("mounts container with absolute positioning when host is not document.body", () => {
    const hostEl = document.createElement("div");
    vi.mocked(getPopupHostForDom).mockReturnValue(hostEl);

    menu3.show(50, 60);

    const container = (menu3 as unknown as { container: HTMLElement }).container;
    expect(container.parentElement).toBe(hostEl);
    expect(container.style.position).toBe("absolute");
  });

  it("converts coordinates via toHostCoordsForDom when host is not document.body", () => {
    const hostEl = document.createElement("div");
    vi.mocked(getPopupHostForDom).mockReturnValue(hostEl);
    vi.mocked(toHostCoordsForDom).mockReturnValue({ top: 30, left: 20 });

    menu3.show(50, 60);

    expect(toHostCoordsForDom).toHaveBeenCalledWith(hostEl, { top: 60, left: 50 });
    const container = (menu3 as unknown as { container: HTMLElement }).container;
    expect(container.style.left).toBe("20px");
    expect(container.style.top).toBe("30px");
  });

  it("uses fixed positioning when host is document.body (fallback)", () => {
    vi.mocked(getPopupHostForDom).mockReturnValue(null);

    menu3.show(50, 60);

    const container = (menu3 as unknown as { container: HTMLElement }).container;
    expect(container.style.position).toBe("fixed");
    expect(container.style.left).toBe("50px");
    expect(container.style.top).toBe("60px");
  });

  it("does not re-append when already mounted to the same host", () => {
    const hostEl = document.createElement("div");
    vi.mocked(getPopupHostForDom).mockReturnValue(hostEl);

    menu3.show(50, 60);
    const appendSpy = vi.spyOn(hostEl, "appendChild");
    // Show again — same host
    menu3.show(70, 80);
    // appendChild should not be called again since container is already parented to host
    expect(appendSpy).not.toHaveBeenCalled();
  });
});

describe("TiptapTableContextMenu — Escape when editor disconnected", () => {
  it("does not focus editor when dom is not connected", () => {
    const view = {
      dom: { isConnected: false, closest: vi.fn(() => null) },
      focus: vi.fn(),
    } as unknown;
    const menu = new TiptapTableContextMenu(view as never);
    menu.show(10, 10);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect((view as { focus: ReturnType<typeof vi.fn> }).focus).not.toHaveBeenCalled();
    menu.destroy();
  });
});

describe("TiptapTableContextMenu — fit-to-width label variants", () => {
  it("shows 'Natural Width' when current table is already fit-to-width", () => {
    mockTableFitToWidth = false;
    mockIsCurrentTableFitToWidth.mockReturnValue(true);
    const view = createMockView();
    const menu = new TiptapTableContextMenu(view as never);
    menu.show(100, 100);
    const container = (menu as unknown as { container: HTMLElement }).container;
    const labels = Array.from(container.querySelectorAll(".table-context-menu-label"))
      .map((el) => el.textContent);
    expect(labels).toContain("Natural Width");
    menu.destroy();
  });

  it("shows 'Fit to Width' when current table is not fit-to-width", () => {
    mockTableFitToWidth = false;
    mockIsCurrentTableFitToWidth.mockReturnValue(false);
    const view = createMockView();
    const menu = new TiptapTableContextMenu(view as never);
    menu.show(100, 100);
    const container = (menu as unknown as { container: HTMLElement }).container;
    const labels = Array.from(container.querySelectorAll(".table-context-menu-label"))
      .map((el) => el.textContent);
    expect(labels).toContain("Fit to Width");
    menu.destroy();
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: requestAnimationFrame position adjustment (lines 161-177)
// These run inside requestAnimationFrame after show() — use fake RAF.
// ---------------------------------------------------------------------------

describe("TiptapTableContextMenu — rAF position adjustment", () => {
  let menu2: TiptapTableContextMenu;
  let view2: ReturnType<typeof createMockView>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTableFitToWidth = false;
    // Restore default mock implementations after clearAllMocks resets them
    vi.mocked(getPopupHostForDom).mockReturnValue(null);
    vi.mocked(toHostCoordsForDom).mockImplementation((_host: unknown, pos: { top: number; left: number }) => pos);
    view2 = createMockView();
    menu2 = new TiptapTableContextMenu(view2 as never);
  });

  afterEach(() => {
    menu2.destroy();
  });

  it("adjusts left position when container extends beyond viewport right edge (line 166)", () => {
    // Mock getBoundingClientRect to return a rect that overflows right edge
    const container = (menu2 as unknown as { container: HTMLElement }).container;
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 100, bottom: 200, left: 750, right: 820,
      width: 70, height: 100,
      x: 750, y: 100, toJSON: () => {},
    } as DOMRect);

    // Mock innerWidth to be 800 (so right=820 > 800-10=790)
    Object.defineProperty(window, "innerWidth", { value: 800, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, writable: true });

    let rafCallback: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });

    menu2.show(750, 100);

    // Run the rAF callback manually
    if (rafCallback) {
      rafCallback(0);
    }

    // The container left should have been adjusted (newLeft = 800 - 70 - 10 = 720)
    // host === document.body in this test (getPopupHostForDom returns null → document.body)
    expect(container.style.left).toBe("720px");
  });

  it("adjusts top position when container extends beyond viewport bottom edge (line 176)", () => {
    const container = (menu2 as unknown as { container: HTMLElement }).container;
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 500, bottom: 640, left: 100, right: 200,
      width: 100, height: 140,
      x: 100, y: 500, toJSON: () => {},
    } as DOMRect);

    // Mock innerHeight to 600 (so bottom=640 > 600-10=590)
    // editorContainer is null (closest returns null)
    Object.defineProperty(window, "innerWidth", { value: 1200, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, writable: true });

    let rafCallback: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });

    menu2.show(100, 500);

    if (rafCallback) {
      rafCallback(0);
    }

    // maxBottom = viewportHeight - 10 = 590, newTop = 590 - 140 = 450
    expect(container.style.top).toBe("450px");
  });

  it("runs rAF callback without adjustments when menu fits in viewport", () => {
    const container = (menu2 as unknown as { container: HTMLElement }).container;
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 100, bottom: 200, left: 100, right: 200,
      width: 100, height: 100,
      x: 100, y: 100, toJSON: () => {},
    } as DOMRect);

    Object.defineProperty(window, "innerWidth", { value: 1200, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, writable: true });

    let rafCallback: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });

    menu2.show(100, 100);

    if (rafCallback) {
      rafCallback(0);
    }

    // No adjustment needed — position stays as-is (100, 100)
    expect(container.style.left).toBe("100px");
    expect(container.style.top).toBe("100px");
  });

  it("adjusts left via toHostCoordsForDom when host is not document.body and overflows right", () => {
    const hostEl = document.createElement("div");
    vi.mocked(getPopupHostForDom).mockReturnValue(hostEl);
    vi.mocked(toHostCoordsForDom).mockImplementation((_host, pos) => pos);

    const container = (menu2 as unknown as { container: HTMLElement }).container;
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 100, bottom: 200, left: 750, right: 820,
      width: 70, height: 100,
      x: 750, y: 100, toJSON: () => {},
    } as DOMRect);

    Object.defineProperty(window, "innerWidth", { value: 800, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, writable: true });

    let rafCallback: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });

    menu2.show(750, 100);
    if (rafCallback) rafCallback(0);

    // toHostCoordsForDom should have been called for right-edge adjustment
    expect(toHostCoordsForDom).toHaveBeenCalledWith(hostEl, { top: 0, left: 720 });
  });

  it("adjusts top via toHostCoordsForDom when host is not document.body and overflows bottom", () => {
    const hostEl = document.createElement("div");
    vi.mocked(getPopupHostForDom).mockReturnValue(hostEl);
    vi.mocked(toHostCoordsForDom).mockImplementation((_host, pos) => pos);

    const container = (menu2 as unknown as { container: HTMLElement }).container;
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 500, bottom: 640, left: 100, right: 200,
      width: 100, height: 140,
      x: 100, y: 500, toJSON: () => {},
    } as DOMRect);

    Object.defineProperty(window, "innerWidth", { value: 1200, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, writable: true });

    let rafCallback: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });

    menu2.show(100, 500);
    if (rafCallback) rafCallback(0);

    // maxBottom = 590, newTop = 590 - 140 = 450
    expect(toHostCoordsForDom).toHaveBeenCalledWith(hostEl, { top: 450, left: 0 });
  });

  it("uses editorContainer bottom as maxBottom when available", () => {
    const editorContainer = document.createElement("div");
    const mockView = {
      dom: {
        isConnected: true,
        closest: vi.fn((selector: string) => selector === ".editor-container" ? editorContainer : null),
      },
      focus: vi.fn(),
    } as unknown;

    const localMenu = new TiptapTableContextMenu(mockView as never);
    const container = (localMenu as unknown as { container: HTMLElement }).container;

    // Editor container rect: bottom at 400
    vi.spyOn(editorContainer, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 400, left: 0, right: 800,
      width: 800, height: 400,
      x: 0, y: 0, toJSON: () => {},
    } as DOMRect);

    // Menu rect overflows editor bottom
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 350, bottom: 500, left: 100, right: 200,
      width: 100, height: 150,
      x: 100, y: 350, toJSON: () => {},
    } as DOMRect);

    Object.defineProperty(window, "innerWidth", { value: 1200, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, writable: true });

    let rafCallback: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });

    localMenu.show(100, 350);
    if (rafCallback) rafCallback(0);

    // maxBottom = editorRect.bottom - 16 = 384, newTop = 384 - 150 = 234
    expect(container.style.top).toBe("234px");
    localMenu.destroy();
  });
});
