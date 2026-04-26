/**
 * Source Table Context Menu Tests
 *
 * Tests the real SourceTableContextMenuView class via the ViewPlugin by creating
 * a CodeMirror EditorView with the plugin extension and dispatching contextmenu
 * events. posAtCoords is monkey-patched because jsdom has no layout engine.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// ── Mocks ────────────────────────────────────────────────────────

const mockGetSourceTableInfo = vi.fn();
vi.mock("@/plugins/sourceContextDetection/tableDetection", () => ({
  getSourceTableInfo: (...args: unknown[]) => mockGetSourceTableInfo(...args),
}));

const mockInsertRowAbove = vi.fn();
const mockInsertRowBelow = vi.fn();
const mockInsertColumnLeft = vi.fn();
const mockInsertColumnRight = vi.fn();
const mockDeleteRow = vi.fn();
const mockDeleteColumn = vi.fn();
const mockDeleteTable = vi.fn();
const mockSetColumnAlignment = vi.fn();
const mockSetAllColumnsAlignment = vi.fn();
const mockFormatTable = vi.fn();

vi.mock("@/plugins/sourceContextDetection/tableActions", () => ({
  insertRowAbove: (...args: unknown[]) => mockInsertRowAbove(...args),
  insertRowBelow: (...args: unknown[]) => mockInsertRowBelow(...args),
  insertColumnLeft: (...args: unknown[]) => mockInsertColumnLeft(...args),
  insertColumnRight: (...args: unknown[]) => mockInsertColumnRight(...args),
  deleteRow: (...args: unknown[]) => mockDeleteRow(...args),
  deleteColumn: (...args: unknown[]) => mockDeleteColumn(...args),
  deleteTable: (...args: unknown[]) => mockDeleteTable(...args),
  setColumnAlignment: (...args: unknown[]) => mockSetColumnAlignment(...args),
  setAllColumnsAlignment: (...args: unknown[]) => mockSetAllColumnsAlignment(...args),
  formatTable: (...args: unknown[]) => mockFormatTable(...args),
}));

vi.mock("@/utils/icons", () => ({
  icons: {
    rowAbove: "RA", rowBelow: "RB", colLeft: "CL", colRight: "CR",
    deleteRow: "DR", deleteCol: "DC", deleteTable: "DT",
    alignLeft: "AL", alignCenter: "AC", alignRight: "AR",
    alignAllLeft: "AAL", alignAllCenter: "AAC", alignAllRight: "AAR",
    formatTable: "FT",
  },
}));

const mockToastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

let mockPopupHost: HTMLElement | null = null;
vi.mock("@/plugins/sourcePopup", () => ({
  getPopupHost: () => mockPopupHost,
  toHostCoords: (_h: HTMLElement, pos: { top: number; left: number }) => pos,
}));

import type { SourceTableInfo } from "@/plugins/sourceContextDetection/tableTypes";
import { sourceTableContextMenuExtensions } from "../sourceTableContextMenu";

// ── Test data ────────────────────────────────────────────────────

const mkInfo = (rowIndex = 0): SourceTableInfo => ({
  start: 0, end: 100, startLine: 0, endLine: 3,
  rowIndex, colIndex: 0, colCount: 2,
  lines: ["| A | B |", "|---|---|", "| 1 | 2 |"],
});

// ── Helpers ──────────────────────────────────────────────────────

const views: EditorView[] = [];

function createHost() {
  const host = document.createElement("div");
  host.className = "editor-container";
  Object.defineProperties(host, {
    scrollLeft: { value: 0, writable: true },
    scrollTop: { value: 0, writable: true },
  });
  host.getBoundingClientRect = () => ({
    top: 0, left: 0, bottom: 600, right: 800,
    width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}),
  });
  document.body.appendChild(host);
  return host;
}

function createLiveView(host: HTMLElement) {
  const state = EditorState.create({
    doc: "| A | B |\n|---|---|\n| 1 | 2 |",
    extensions: sourceTableContextMenuExtensions,
  });
  const view = new EditorView({ state, parent: host });
  // Patch posAtCoords — jsdom has no layout engine
  view.posAtCoords = () => 5;
  views.push(view);
  return view;
}

function fireContextMenu(target: HTMLElement, x = 50, y = 20) {
  target.dispatchEvent(
    new MouseEvent("contextmenu", { clientX: x, clientY: y, bubbles: true, cancelable: true })
  );
}

// ── Tests ────────────────────────────────────────────────────────

describe("SourceTableContextMenu", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    host = createHost();
    mockPopupHost = host;
  });

  afterEach(() => {
    views.forEach((v) => { try { v.destroy(); } catch { /* empty */ } });
    views.length = 0;
    document.body.innerHTML = "";
  });

  // ── Module exports ─────────────────────────────────────────────

  it("exports a single-item extension array", () => {
    expect(sourceTableContextMenuExtensions).toHaveLength(1);
    expect(sourceTableContextMenuExtensions[0]).toBeDefined();
  });

  // ── No table ───────────────────────────────────────────────────

  it("does not show menu when not in a table", () => {
    mockGetSourceTableInfo.mockReturnValue(null);
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    expect(host.querySelector(".table-context-menu")).toBeNull();
  });

  // ── Menu creation ──────────────────────────────────────────────

  it("creates menu container on contextmenu inside table", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    expect(host.querySelector(".table-context-menu")).not.toBeNull();
  });

  it("builds 14 menu items", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    expect(host.querySelectorAll(".table-context-menu-item")).toHaveLength(14);
  });

  it("creates icon and label spans for each item", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    expect(host.querySelectorAll(".table-context-menu-icon")).toHaveLength(14);
    expect(host.querySelectorAll(".table-context-menu-label")).toHaveLength(14);
  });

  it("has correct label order", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    const labels = [...host.querySelectorAll(".table-context-menu-label")]
      .map((el) => el.textContent);
    expect(labels).toEqual([
      "Insert Row Above", "Insert Row Below",
      "Insert Column Left", "Insert Column Right",
      "Delete Row", "Delete Column", "Delete Table",
      "Align Column Left", "Align Column Center", "Align Column Right",
      "Align All Left", "Align All Center", "Align All Right",
      "Format Table",
    ]);
  });

  it("marks 3 items as danger", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    expect(host.querySelectorAll(".table-context-menu-item-danger")).toHaveLength(3);
  });

  it("creates 4 dividers", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    expect(host.querySelectorAll(".table-context-menu-divider")).toHaveLength(4);
  });

  it("no items disabled on non-separator row", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo(0));
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    expect(host.querySelectorAll(".table-context-menu-item-disabled")).toHaveLength(0);
  });

  // ── Separator row ──────────────────────────────────────────────

  it("disables 7 items on separator row (rowIndex=1)", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo(1));
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    expect(host.querySelectorAll(".table-context-menu-item-disabled")).toHaveLength(7);
    expect(host.querySelectorAll("button[disabled]")).toHaveLength(7);
  });

  // ── Actions ────────────────────────────────────────────────────

  const actionTests: Array<{ idx: number; label: string; fn: () => ReturnType<typeof vi.fn>; extraArgs?: unknown[] }> = [
    { idx: 0, label: "Insert Row Above", fn: () => mockInsertRowAbove },
    { idx: 1, label: "Insert Row Below", fn: () => mockInsertRowBelow },
    { idx: 2, label: "Insert Column Left", fn: () => mockInsertColumnLeft },
    { idx: 3, label: "Insert Column Right", fn: () => mockInsertColumnRight },
    { idx: 4, label: "Delete Row", fn: () => mockDeleteRow },
    { idx: 5, label: "Delete Column", fn: () => mockDeleteColumn },
    { idx: 6, label: "Delete Table", fn: () => mockDeleteTable },
    { idx: 7, label: "Align Column Left", fn: () => mockSetColumnAlignment, extraArgs: ["left"] },
    { idx: 8, label: "Align Column Center", fn: () => mockSetColumnAlignment, extraArgs: ["center"] },
    { idx: 9, label: "Align Column Right", fn: () => mockSetColumnAlignment, extraArgs: ["right"] },
    { idx: 10, label: "Align All Left", fn: () => mockSetAllColumnsAlignment, extraArgs: ["left"] },
    { idx: 11, label: "Align All Center", fn: () => mockSetAllColumnsAlignment, extraArgs: ["center"] },
    { idx: 12, label: "Align All Right", fn: () => mockSetAllColumnsAlignment, extraArgs: ["right"] },
  ];

  for (const { idx, label, fn, extraArgs } of actionTests) {
    it(`clicking "${label}" calls the correct action`, () => {
      const info = mkInfo();
      mockGetSourceTableInfo.mockReturnValue(info);
      const view = createLiveView(host);

      fireContextMenu(view.contentDOM);
      const items = host.querySelectorAll(".table-context-menu-item");
      (items[idx] as HTMLButtonElement).click();

      const mock = fn();
      if (extraArgs) {
        expect(mock).toHaveBeenCalledWith(view, info, ...extraArgs);
      } else {
        expect(mock).toHaveBeenCalledWith(view, info);
      }
    });
  }

  it("clicking action hides the menu", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    const items = host.querySelectorAll(".table-context-menu-item");
    (items[0] as HTMLButtonElement).click();

    const menu = host.querySelector(".table-context-menu") as HTMLElement;
    expect(menu.style.display).toBe("none");
  });

  it("Format Table shows toast on success", () => {
    mockFormatTable.mockReturnValue(true);
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    const items = host.querySelectorAll(".table-context-menu-item");
    (items[13] as HTMLButtonElement).click();
    expect(mockFormatTable).toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalledWith("Table formatted");
  });

  it("Format Table does NOT show toast when returns false", () => {
    mockFormatTable.mockReturnValue(false);
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    const items = host.querySelectorAll(".table-context-menu-item");
    (items[13] as HTMLButtonElement).click();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("disabled items do not fire action", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo(1));
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    const disabled = host.querySelectorAll("button[disabled]");
    (disabled[0] as HTMLButtonElement).click();
    expect(mockDeleteRow).not.toHaveBeenCalled();
  });

  it("mousedown on item calls preventDefault", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    const items = host.querySelectorAll(".table-context-menu-item");
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    const spy = vi.spyOn(ev, "preventDefault");
    items[0].dispatchEvent(ev);
    expect(spy).toHaveBeenCalled();
  });

  // ── Show / Hide / Escape / Click outside ───────────────────────

  it("menu is visible after show", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    const menu = host.querySelector(".table-context-menu") as HTMLElement;
    expect(menu.style.display).toBe("flex");
  });

  it("Escape hides menu", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    const menu = host.querySelector(".table-context-menu") as HTMLElement;
    expect(menu.style.display).toBe("none");
  });

  it("Escape when not visible does nothing", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    const menu = host.querySelector(".table-context-menu") as HTMLElement;
    expect(menu.style.display).toBe("none");
  });

  it("non-Escape key does not hide", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    const menu = host.querySelector(".table-context-menu") as HTMLElement;
    expect(menu.style.display).toBe("flex");
  });

  it("click outside hides menu", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const menu = host.querySelector(".table-context-menu") as HTMLElement;
    expect(menu.style.display).toBe("none");
  });

  it("click inside menu does not hide it", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    const menu = host.querySelector(".table-context-menu") as HTMLElement;
    const item = menu.querySelector(".table-context-menu-item")!;
    item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu.style.display).toBe("flex");
  });

  it("click outside when hidden is a no-op", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const menu = host.querySelector(".table-context-menu") as HTMLElement;
    expect(menu.style.display).toBe("none");
  });

  // ── Reuse / Rebuild ────────────────────────────────────────────

  it("reuses same menu container on second contextmenu", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM, 50, 20);
    fireContextMenu(view.contentDOM, 100, 100);
    expect(host.querySelectorAll(".table-context-menu")).toHaveLength(1);
  });

  it("rebuilds items when called with different table info", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo(0));
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    expect(host.querySelectorAll(".table-context-menu-item-disabled")).toHaveLength(0);

    mockGetSourceTableInfo.mockReturnValue(mkInfo(1));
    fireContextMenu(view.contentDOM);
    expect(host.querySelectorAll(".table-context-menu-item-disabled")).toHaveLength(7);
  });

  // ── Positioning ────────────────────────────────────────────────

  it("sets absolute position on container", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    const menu = host.querySelector(".table-context-menu") as HTMLElement;
    expect(menu.style.position).toBe("absolute");
  });

  it("sets left and top from mouse coords", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM, 123, 456);
    const menu = host.querySelector(".table-context-menu") as HTMLElement;
    expect(menu.style.left).toBe("123px");
    expect(menu.style.top).toBe("456px");
  });

  it("adjusts left when overflowing right edge (rAF)", async () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM, 750, 50);
    const menu = host.querySelector(".table-context-menu") as HTMLElement;
    menu.getBoundingClientRect = () => ({
      top: 50, left: 750, bottom: 250, right: 950,
      width: 200, height: 200, x: 750, y: 50, toJSON: () => ({}),
    });

    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(parseFloat(menu.style.left)).toBeLessThan(750);
  });

  it("adjusts top when overflowing bottom edge (rAF)", async () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM, 50, 500);
    const menu = host.querySelector(".table-context-menu") as HTMLElement;
    menu.getBoundingClientRect = () => ({
      top: 500, left: 50, bottom: 800, right: 250,
      width: 200, height: 300, x: 50, y: 500, toJSON: () => ({}),
    });

    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(parseFloat(menu.style.top)).toBeLessThan(500);
  });

  it("does not adjust when menu fits", async () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM, 50, 50);
    const menu = host.querySelector(".table-context-menu") as HTMLElement;
    menu.getBoundingClientRect = () => ({
      top: 50, left: 50, bottom: 200, right: 250,
      width: 200, height: 150, x: 50, y: 50, toJSON: () => ({}),
    });

    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(menu.style.left).toBe("50px");
    expect(menu.style.top).toBe("50px");
  });

  // ── Destroy ────────────────────────────────────────────────────

  it("destroy removes menu from DOM", () => {
    mockGetSourceTableInfo.mockReturnValue(mkInfo());
    const view = createLiveView(host);

    fireContextMenu(view.contentDOM);
    expect(host.querySelector(".table-context-menu")).not.toBeNull();
    view.destroy();
    expect(host.querySelector(".table-context-menu")).toBeNull();
  });

  it("destroy with no menu is safe", () => {
    const view = createLiveView(host);
    expect(() => view.destroy()).not.toThrow();
  });

  // ── Popup host fallback ────────────────────────────────────────

  it("falls back to view.dom when getPopupHost returns null", () => {
    mockPopupHost = null;
    mockGetSourceTableInfo.mockReturnValue(mkInfo());

    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const state = EditorState.create({
      doc: "| A | B |",
      extensions: sourceTableContextMenuExtensions,
    });
    const view = new EditorView({ state, parent });
    view.posAtCoords = () => 3;
    views.push(view);

    fireContextMenu(view.contentDOM);

    const menu = view.dom.querySelector(".table-context-menu");
    expect(menu).not.toBeNull();

    mockPopupHost = host; // restore
  });
});
