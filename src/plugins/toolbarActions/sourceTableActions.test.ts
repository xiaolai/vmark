import { vi, describe, it, expect, beforeEach } from "vitest";

const mockInsertRowAbove = vi.fn();
const mockInsertRowBelow = vi.fn();
const mockInsertColumnLeft = vi.fn();
const mockInsertColumnRight = vi.fn();
const mockDeleteRow = vi.fn();
const mockDeleteColumn = vi.fn();
const mockDeleteTable = vi.fn();
const mockSetColumnAlignment = vi.fn();
const mockSetAllColumnsAlignment = vi.fn();
const mockFormatTable = vi.fn(() => true);
const mockGetSourceTableInfo = vi.fn();

vi.mock("@/plugins/sourceContextDetection/tableDetection", () => ({
  getSourceTableInfo: (...args: unknown[]) => mockGetSourceTableInfo(...args),
}));

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

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { handleTableAction } from "./sourceTableActions";
import { toast } from "sonner";

function createView(doc: string, from: number): EditorView {
  const parent = document.createElement("div");
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(from),
  });
  return new EditorView({ state, parent });
}

const fakeTableInfo = {
  rows: 3,
  cols: 2,
  currentRow: 1,
  currentCol: 0,
  from: 0,
  to: 50,
};

describe("handleTableAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSourceTableInfo.mockReturnValue(fakeTableInfo);
  });

  it("returns false when not inside a table", () => {
    mockGetSourceTableInfo.mockReturnValue(null);
    const view = createView("not a table", 0);
    const result = handleTableAction(view, "addRow");
    expect(result).toBe(false);
    view.destroy();
  });

  it("handles addRowAbove action", () => {
    const view = createView("| a | b |\n|---|---|\n| 1 | 2 |", 5);
    const result = handleTableAction(view, "addRowAbove");
    expect(result).toBe(true);
    expect(mockInsertRowAbove).toHaveBeenCalledWith(view, fakeTableInfo);
    view.destroy();
  });

  it("handles addRow action", () => {
    const view = createView("| a | b |", 5);
    const result = handleTableAction(view, "addRow");
    expect(result).toBe(true);
    expect(mockInsertRowBelow).toHaveBeenCalledWith(view, fakeTableInfo);
    view.destroy();
  });

  it("handles addColLeft action", () => {
    const view = createView("| a | b |", 5);
    const result = handleTableAction(view, "addColLeft");
    expect(result).toBe(true);
    expect(mockInsertColumnLeft).toHaveBeenCalledWith(view, fakeTableInfo);
    view.destroy();
  });

  it("handles addCol action", () => {
    const view = createView("| a | b |", 5);
    const result = handleTableAction(view, "addCol");
    expect(result).toBe(true);
    expect(mockInsertColumnRight).toHaveBeenCalledWith(view, fakeTableInfo);
    view.destroy();
  });

  it("handles deleteRow action", () => {
    const view = createView("| a | b |", 5);
    const result = handleTableAction(view, "deleteRow");
    expect(result).toBe(true);
    expect(mockDeleteRow).toHaveBeenCalledWith(view, fakeTableInfo);
    view.destroy();
  });

  it("handles deleteCol action", () => {
    const view = createView("| a | b |", 5);
    const result = handleTableAction(view, "deleteCol");
    expect(result).toBe(true);
    expect(mockDeleteColumn).toHaveBeenCalledWith(view, fakeTableInfo);
    view.destroy();
  });

  it("handles deleteTable action", () => {
    const view = createView("| a | b |", 5);
    const result = handleTableAction(view, "deleteTable");
    expect(result).toBe(true);
    expect(mockDeleteTable).toHaveBeenCalledWith(view, fakeTableInfo);
    view.destroy();
  });

  it("handles alignLeft action", () => {
    const view = createView("| a | b |", 5);
    const result = handleTableAction(view, "alignLeft");
    expect(result).toBe(true);
    expect(mockSetColumnAlignment).toHaveBeenCalledWith(view, fakeTableInfo, "left");
    view.destroy();
  });

  it("handles alignCenter action", () => {
    const view = createView("| a | b |", 5);
    const result = handleTableAction(view, "alignCenter");
    expect(result).toBe(true);
    expect(mockSetColumnAlignment).toHaveBeenCalledWith(view, fakeTableInfo, "center");
    view.destroy();
  });

  it("handles alignRight action", () => {
    const view = createView("| a | b |", 5);
    const result = handleTableAction(view, "alignRight");
    expect(result).toBe(true);
    expect(mockSetColumnAlignment).toHaveBeenCalledWith(view, fakeTableInfo, "right");
    view.destroy();
  });

  it("handles alignAllLeft action", () => {
    const view = createView("| a | b |", 5);
    const result = handleTableAction(view, "alignAllLeft");
    expect(result).toBe(true);
    expect(mockSetAllColumnsAlignment).toHaveBeenCalledWith(view, fakeTableInfo, "left");
    view.destroy();
  });

  it("handles alignAllCenter action", () => {
    const view = createView("| a | b |", 5);
    const result = handleTableAction(view, "alignAllCenter");
    expect(result).toBe(true);
    expect(mockSetAllColumnsAlignment).toHaveBeenCalledWith(view, fakeTableInfo, "center");
    view.destroy();
  });

  it("handles alignAllRight action", () => {
    const view = createView("| a | b |", 5);
    const result = handleTableAction(view, "alignAllRight");
    expect(result).toBe(true);
    expect(mockSetAllColumnsAlignment).toHaveBeenCalledWith(view, fakeTableInfo, "right");
    view.destroy();
  });

  it("handles formatTable action and shows toast on success", () => {
    mockFormatTable.mockReturnValue(true);
    const view = createView("| a | b |", 5);
    const result = handleTableAction(view, "formatTable");
    expect(result).toBe(true);
    expect(mockFormatTable).toHaveBeenCalledWith(view, fakeTableInfo);
    expect(toast.success).toHaveBeenCalledWith("Table formatted");
    view.destroy();
  });

  it("handles formatTable no-op with info toast (E2)", () => {
    mockFormatTable.mockReturnValue(false);
    const view = createView("| a | b |", 5);
    const result = handleTableAction(view, "formatTable");
    expect(result).toBe(true);
    // Success toast is NOT shown when no changes were made
    expect(toast.success).not.toHaveBeenCalled();
    // Info toast IS shown so the user knows the action was processed
    expect(toast.info).toHaveBeenCalledWith("Table is already formatted");
    view.destroy();
  });

  it("returns false for unknown action", () => {
    const view = createView("| a | b |", 5);
    const result = handleTableAction(view, "unknownAction");
    expect(result).toBe(false);
    view.destroy();
  });
});
